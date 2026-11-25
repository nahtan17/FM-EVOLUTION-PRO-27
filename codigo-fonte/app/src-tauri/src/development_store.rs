//! Settings and observations for a career selected explicitly by the user.
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::{Connection, Failure, FmDate, PlayerSummary, now_ms};

pub(super) const FAVORITES: &str = "Favoritos";
const MAX_SNAPSHOTS: usize = 50_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub(super) struct PlayerRef {
    pub uid: u32,
    pub born: FmDate,
}

impl PlayerRef {
    pub fn from_summary(player: &PlayerSummary) -> Option<Self> {
        Some(Self { uid: player.uid, born: player.date_of_birth? })
    }

    pub fn matches(self, player: &PlayerSummary) -> bool {
        Self::from_summary(player) == Some(self)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum Frequency {
    Daily,
    #[default]
    Weekly,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct Rules {
    pub multiplier: Option<u8>,
    pub ceiling: Option<u16>,
    pub weekly_limit: Option<u16>,
    pub frequency: Option<Frequency>,
    pub paused: Option<bool>,
    pub focus: Option<String>,
}

impl Rules {
    fn inherit(&self, parent: &Self) -> Self {
        Self {
            multiplier: self.multiplier.or(parent.multiplier),
            ceiling: self.ceiling.or(parent.ceiling),
            weekly_limit: self.weekly_limit.or(parent.weekly_limit),
            frequency: self.frequency.or(parent.frequency),
            paused: self.paused.or(parent.paused),
            focus: self.focus.clone().or_else(|| parent.focus.clone()),
        }
    }

    fn valid(&self) -> bool {
        self.multiplier.is_none_or(|value| (1..=100).contains(&value))
            && self.ceiling.is_none_or(|value| (1..=200).contains(&value))
            && self.weekly_limit.is_none_or(|value| (1..=200).contains(&value))
            && self.focus.as_ref().is_none_or(|focus| {
                matches!(
                    focus.as_str(),
                    "auto" | "goalkeeper" | "defender" | "midfielder" | "striker" | "winger" | "none"
                ) || focus.strip_prefix("custom:").is_some_and(|keys| {
                    keys.len() <= 1600
                        && (keys.is_empty()
                            || keys.split(',').all(|key| {
                                fmlibre_core::ATTRIBUTE_GROUPS
                                    .iter()
                                    .any(|(group, attributes)| *group != "feet" && attributes.contains(&key))
                            }))
                }) || focus
                    .strip_prefix("role:")
                    .is_some_and(|key| fmlibre_core::ROLES.iter().any(|role| role.key == key))
            })
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct Group {
    pub players: BTreeSet<PlayerRef>,
    pub profile: Option<String>,
    pub rules: Rules,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Individual {
    pub player: PlayerRef,
    pub primary: Option<String>,
    pub profile: Option<String>,
    pub rules: Rules,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct Settings {
    pub lists: BTreeMap<String, BTreeSet<PlayerRef>>,
    pub groups: BTreeMap<String, Group>,
    pub profiles: BTreeMap<String, Rules>,
    pub individuals: BTreeMap<u32, Individual>,
}

pub(super) fn valid_name(name: &str) -> bool {
    !name.trim().is_empty() && name.len() <= 80 && !name.chars().any(char::is_control)
}

impl Settings {
    pub fn validate(&self) -> Result<(), Failure> {
        let valid_group = |group: &Group| {
            group.players.len() <= 2000
                && group.rules.valid()
                && group.profile.as_ref().is_none_or(|name| self.profiles.contains_key(name))
        };
        let valid_individual = |uid: &u32, individual: &Individual| {
            individual.player.uid == *uid
                && individual.rules.valid()
                && individual.primary.as_ref().is_none_or(|name| {
                    self.groups.get(name).is_some_and(|group| group.players.contains(&individual.player))
                })
                && individual.profile.as_ref().is_none_or(|name| self.profiles.contains_key(name))
        };
        if self.groups.len() <= 100
            && self.lists.len() <= 100
            && self.profiles.len() <= 100
            && self.individuals.len() <= 2000
            && self.lists.iter().all(|(name, list)| valid_name(name) && list.len() <= 2000)
            && self.groups.iter().all(|(name, group)| valid_name(name) && valid_group(group))
            && self.profiles.iter().all(|(name, rules)| valid_name(name) && rules.valid())
            && self.individuals.iter().all(|(uid, individual)| valid_individual(uid, individual))
        {
            Ok(())
        } else {
            Err(Failure::new(
                "development.settings",
                "Confira os limites e os vínculos entre jogadores, grupos e perfis.",
            ))
        }
    }

    pub fn rules_for(&self, player: PlayerRef, global: &Rules) -> Result<(Rules, Option<String>), &'static str> {
        let individual = self.individuals.get(&player.uid).filter(|entry| entry.player == player);
        let mut groups = self.groups.iter().filter(|(_, group)| group.players.contains(&player));
        let group = if let Some(primary) = individual.and_then(|entry| entry.primary.as_deref()) {
            self.groups.get_key_value(primary).filter(|(_, group)| group.players.contains(&player))
        } else {
            let first = groups.next();
            if groups.next().is_some() {
                return Err("Escolha um grupo principal para resolver o conflito");
            }
            first
        };
        let profile = |name: &str| self.profiles.get(name);
        let mut rules = global.clone();
        if let Some((_, group)) = group {
            if let Some(profile) = group.profile.as_deref().and_then(profile) {
                rules = profile.inherit(&rules);
            }
            rules = group.rules.inherit(&rules);
        }
        if let Some(individual) = individual {
            if let Some(profile) = individual.profile.as_deref().and_then(profile) {
                rules = profile.inherit(&rules);
            }
            rules = individual.rules.inherit(&rules);
        }
        Ok((rules, group.map(|(name, _)| name.clone())))
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Snapshot {
    pub player: PlayerRef,
    pub name: String,
    pub club: Option<String>,
    pub date: FmDate,
    pub read_at: u64,
    pub ability: u16,
    pub potential: i16,
    pub attributes: BTreeMap<String, u8>,
    pub source: String,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub(super) struct Period {
    pub player: PlayerRef,
    pub day: FmDate,
    pub week: FmDate,
    pub granted: u16,
    #[serde(default, alias = "minimum_credit")]
    pub guaranteed: bool,
}

impl Period {
    pub fn already_processed(self, date: FmDate, frequency: Frequency, guaranteed: bool) -> bool {
        self.day >= date
            || ((guaranteed || self.guaranteed || frequency == Frequency::Weekly) && self.week >= date.week_start())
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FinanceSnapshot {
    pub club: u32,
    pub date: FmDate,
    pub read_at: u64,
    pub balance: i32,
    pub transfer_budget: i32,
    pub wage_budget: i32,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub(super) struct Document {
    pub settings: Settings,
    pub revision: u64,
    pub selections: BTreeMap<String, Vec<PlayerRef>>,
    pub periods: BTreeMap<u32, Period>,
    pub snapshots: Vec<Snapshot>,
    pub finances: Vec<FinanceSnapshot>,
}

#[derive(Default)]
pub(super) struct Store {
    pub label: Option<String>,
    pub document: Document,
    path: Option<PathBuf>,
}

fn io_failure(error: impl std::fmt::Display) -> Failure {
    Failure::new("development.storage", format!("Erro nos dados da carreira. {error}"))
}

impl Store {
    pub fn open(connection: &Connection, name: &str) -> Result<Self, Failure> {
        let name = name.trim();
        if !valid_name(name) {
            return Err(Failure::new("development.workspace", "Informe um nome para distinguir esta partida."));
        }
        let root = connection.history.path.as_deref().and_then(Path::parent).ok_or_else(|| {
            Failure::new("development.workspace", "Associe a uma carreira identificada para salvar os dados.")
        })?;
        let career = connection
            .save
            .as_deref()
            .ok_or_else(|| Failure::new("development.workspace", "Carreira indisponível."))?;
        let component = |value: &str| value.as_bytes().iter().map(|b| format!("{b:02x}")).collect::<String>();
        let path = root.join("development").join(component(career)).join(format!("{}.json", component(name)));
        let document = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice::<Document>(&bytes).map_err(io_failure)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Document::default(),
            Err(error) => return Err(io_failure(error)),
        };
        document.settings.validate()?;
        Ok(Self { label: Some(name.into()), document, path: Some(path) })
    }

    pub fn save(&self) -> Result<(), Failure> {
        self.path.as_deref().map_or(Ok(()), |path| save_json(path, &self.document))
    }

    pub fn observe(&mut self, observations: impl IntoIterator<Item = Snapshot>) {
        self.document.snapshots.extend(observations);
        let excess = self.document.snapshots.len().saturating_sub(MAX_SNAPSHOTS);
        self.document.snapshots.drain(..excess);
    }
}

fn save_json(path: &Path, data: &impl Serialize) -> Result<(), Failure> {
    let Some(folder) = path.parent() else {
        return Ok(());
    };
    std::fs::create_dir_all(folder).map_err(io_failure)?;
    let tmp = path.with_extension(format!("{}.{}.tmp", std::process::id(), now_ms()));
    let result =
        std::fs::write(&tmp, serde_json::to_vec(data).map_err(io_failure)?).and_then(|()| std::fs::rename(&tmp, path));
    if result.is_err() {
        let _ = std::fs::remove_file(tmp);
    }
    result.map_err(io_failure)
}

#[derive(Default)]
pub(super) struct CareerPeriods {
    path: Option<PathBuf>,
    pub(super) players: BTreeMap<u32, Period>,
}

impl CareerPeriods {
    pub fn refresh(&mut self, disk: Self) {
        if disk.path.is_some() {
            *self = disk;
        }
    }

    pub fn open(connection: &Connection) -> Result<Self, Failure> {
        let path = connection.history.path.as_ref().map(|history| history.with_extension("development-periods.json"));
        let players = match path.as_ref().map(std::fs::read) {
            Some(Ok(bytes)) => serde_json::from_slice(&bytes).map_err(io_failure)?,
            Some(Err(error)) if error.kind() != std::io::ErrorKind::NotFound => return Err(io_failure(error)),
            _ => BTreeMap::new(),
        };
        Ok(Self { path, players })
    }

    pub fn save(&self) -> Result<(), Failure> {
        self.path.as_deref().map_or(Ok(()), |path| save_json(path, &self.players))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applies_group_and_individual_rules_only_to_matching_players() {
        let born = FmDate { year: 2006, month: 11, day: 22 };
        let player = PlayerRef { uid: 1, born };
        let grouped = PlayerRef { uid: 2, born };
        let other = PlayerRef { uid: 3, born };
        let group = Group {
            players: [player, grouped].into_iter().collect(),
            rules: Rules { multiplier: Some(10), weekly_limit: Some(8), ..Rules::default() },
            ..Group::default()
        };
        let mut settings = Settings::default();
        settings.groups.insert("Principal".into(), group);
        settings.individuals.insert(
            1,
            Individual {
                player,
                primary: Some("Principal".into()),
                profile: None,
                rules: Rules { multiplier: Some(1), ..Rules::default() },
            },
        );
        let global = Rules { multiplier: Some(5), ..Rules::default() };
        assert!(settings.validate().is_ok());
        assert_eq!(settings.rules_for(player, &global).unwrap().0.multiplier, Some(1));
        let (rules, group) = settings.rules_for(grouped, &global).unwrap();
        assert_eq!((rules.multiplier, rules.weekly_limit, group.as_deref()), (Some(10), Some(8), Some("Principal")));
        assert_eq!(settings.rules_for(other, &global).unwrap().0.multiplier, Some(5));
        let reused = PlayerRef { uid: 1, born: born.plus_days(1) };
        assert_eq!(settings.rules_for(reused, &global).unwrap().0.multiplier, Some(5));
    }

    #[test]
    fn preserves_week_reservation_after_reopening_or_switching_frequency() {
        let day = FmDate { year: 2026, month: 11, day: 23 };
        let player = PlayerRef { uid: 17, born: day.plus_days(-7300) };
        let reserved = Period { player, day, week: day.week_start(), granted: 0, guaranteed: true };
        let reopened: Period = serde_json::from_slice(&serde_json::to_vec(&reserved).unwrap()).unwrap();
        assert!(reopened.already_processed(day.plus_days(1), Frequency::Daily, false));
        assert!(reopened.already_processed(day.plus_days(6), Frequency::Weekly, true));
        assert!(!reopened.already_processed(day.plus_days(7), Frequency::Daily, true));
        let legacy = serde_json::json!({
            "player": player, "day": day, "week": day.week_start(), "granted": 1, "minimum_credit": true
        });
        let legacy: Period = serde_json::from_value(legacy).unwrap();
        assert!(legacy.already_processed(day.plus_days(1), Frequency::Daily, false));
        let daily = Period { guaranteed: false, ..reserved };
        assert!(!daily.already_processed(day.plus_days(1), Frequency::Daily, false));
        assert!(daily.already_processed(day.plus_days(1), Frequency::Daily, true));
    }
}
