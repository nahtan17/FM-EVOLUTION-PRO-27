use std::collections::HashMap;
use std::sync::LazyLock;

use serde::Deserialize;

use crate::clubs::ClubSummary;
use crate::date::FmDate;
use crate::details::{ATTRIBUTE_GROUPS, PERSONALITY, POSITIONS, read_clauses};
use crate::players::nation_continent;
use crate::players::{PLAYABLE_RATING, PlayerSummary};
use crate::scouting::{Phase, role, scout_position};
use crate::staff::{STAFF_ATTRIBUTE_GROUPS, StaffSummary};
use crate::text::fold;
use crate::{Session, Tie};

/// The attribute keys of `groups`, group after group: the order of the summaries' `attributes`.
pub(crate) fn attribute_keys(
    groups: &'static [(&'static str, &'static [&'static str])],
) -> impl Iterator<Item = &'static str> {
    groups.iter().flat_map(|(_, keys)| keys.iter().copied())
}

/// Where each attribute sits in [`PlayerSummary::attributes`] and in [`StaffSummary::attributes`].
static PLAYER_ATTRIBUTES: LazyLock<HashMap<&'static str, usize>> =
    LazyLock::new(|| attribute_keys(ATTRIBUTE_GROUPS).enumerate().map(|(i, key)| (key, i)).collect());
static STAFF_ATTRIBUTES: LazyLock<HashMap<&'static str, usize>> =
    LazyLock::new(|| attribute_keys(STAFF_ATTRIBUTE_GROUPS).enumerate().map(|(i, key)| (key, i)).collect());

/// Where the attribute `key` sits in [`PlayerSummary::attributes`].
pub(crate) fn player_attribute(key: &str) -> Option<usize> {
    PLAYER_ATTRIBUTES.get(key).copied()
}

/// Where the attribute `key` sits in [`StaffSummary::attributes`].
pub(crate) fn staff_attribute(key: &str) -> Option<usize> {
    STAFF_ATTRIBUTES.get(key).copied()
}

/// A bound on one attribute as FM shows it (1–20): at least `min` and at most `max`, either of which may be unset.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AttributeBound {
    /// An attribute key of the list's entity, e.g. "finishing" for players or "tactical" for staff.
    pub key: String,
    pub min: Option<u8>,
    pub max: Option<u8>,
}

impl AttributeBound {
    /// Whether `values`, a summary's attributes, keep to the bound. An attribute the entity does not have, or one the
    /// game's layout does not place (0), keeps to no bound: a mass edit must never widen to everyone over it.
    fn holds(&self, index: &HashMap<&'static str, usize>, values: &[u8]) -> bool {
        match index.get(self.key.as_str()).and_then(|&i| values.get(i)) {
            Some(&value) if value > 0 => {
                self.min.is_none_or(|min| value >= min) && self.max.is_none_or(|max| value <= max)
            }
            _ => false,
        }
    }
}

/// Filters the player list applies on top of a name search. Unset fields match everyone.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PlayerFilter {
    /// A [`POSITIONS`] key; matches players rated [`PLAYABLE_RATING`] or more there.
    pub position: Option<String>,
    pub min_age: Option<u16>,
    pub max_age: Option<u16>,
    pub min_current_ability: Option<u16>,
    pub min_potential_ability: Option<i16>,
    /// Part of the nation's name, accents and case ignored.
    pub nation: Option<String>,
    /// Part of the club's name, accents and case ignored.
    pub club: Option<String>,
    /// Only players of the club with this UID, e.g. those a player can swap with.
    pub club_uid: Option<u32>,
    /// Only players without a club.
    pub free_agents: bool,
    /// Only players whose contract ends on or before this date.
    pub contract_expires_by: Option<FmDate>,
    /// Only players their club has put on the transfer list, and on the loan list.
    pub transfer_listed: bool,
    pub loan_listed: bool,
    /// `Some(true)` for women only, `Some(false)` for men only. Whom the layout cannot tell apart matches neither.
    pub women: Option<bool>,
    /// Bounds on attributes, every one of which must hold.
    pub attributes: Vec<AttributeBound>,
    pub advanced: PlayerAdvancedFilter,
}

impl PlayerFilter {
    pub fn matches(&self, p: &PlayerSummary) -> bool {
        let position = match self.position.as_deref() {
            Some(key) => {
                POSITIONS.iter().position(|&k| k == key).is_some_and(|i| p.position_ratings[i] >= PLAYABLE_RATING)
            }
            None => true,
        };
        position
            && self.advanced.matches_summary(p)
            && self.min_age.is_none_or(|min| p.age.is_some_and(|age| age >= min))
            && self.max_age.is_none_or(|max| p.age.is_some_and(|age| age <= max))
            && self.min_current_ability.is_none_or(|min| p.current_ability >= min)
            && self.min_potential_ability.is_none_or(|min| p.potential_ability >= min)
            && contains(p.nation.as_deref(), self.nation.as_deref())
            && contains(p.club.as_deref(), self.club.as_deref())
            && self.club_uid.is_none_or(|uid| p.club_uid == Some(uid))
            && (!self.free_agents || p.club.is_none())
            && self.contract_expires_by.is_none_or(|by| p.contract_expires.is_some_and(|end| end <= by))
            && (!self.transfer_listed || p.transfer_listed)
            && (!self.loan_listed || p.loan_listed)
            && self.women.is_none_or(|women| p.woman == Some(women))
            && self.attributes.iter().all(|bound| bound.holds(&PLAYER_ATTRIBUTES, &p.attributes))
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PlayerAdvancedFilter {
    pub invalid: bool,
    pub positions: Vec<String>,
    pub all_positions: bool,
    pub position_rating: Option<u8>,
    pub max_current: Option<u16>,
    pub max_potential: Option<i16>,
    pub second_nation: Option<String>,
    pub continent: Option<String>,
    pub country: Option<String>,
    pub league: Option<String>,
    pub min_height: Option<u16>,
    pub max_height: Option<u16>,
    pub min_reputation: Option<u16>,
    pub max_reputation: Option<u16>,
    pub min_wage: Option<i64>,
    pub max_wage: Option<i64>,
    pub min_value: Option<i64>,
    pub max_value: Option<i64>,
    pub min_asking: Option<i64>,
    pub max_asking: Option<i64>,
    pub expires_within_months: Option<u16>,
    pub contract_expires_from: Option<FmDate>,
    pub max_release_fee: Option<i64>,
    pub clause: Option<u16>,
    pub trait_bit: Option<u8>,
    pub personality: Vec<AttributeBound>,
    pub foot: Option<DominantFoot>,
    pub role: Option<RoleFilter>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DominantFoot {
    Left,
    Right,
    Equal,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleFilter {
    pub key: String,
    pub phase: Phase,
    pub min_rating: u8,
}

fn in_range<T: PartialOrd + Copy>(value: Option<T>, min: Option<T>, max: Option<T>) -> bool {
    min.is_none_or(|min| value.is_some_and(|value| value >= min))
        && max.is_none_or(|max| value.is_some_and(|value| value <= max))
}

impl PlayerAdvancedFilter {
    fn matches_summary(&self, player: &PlayerSummary) -> bool {
        let matches_position = |key: &String| {
            POSITIONS.iter().position(|&position| position == key).is_some_and(|index| {
                (self.position_rating.unwrap_or(PLAYABLE_RATING)..=20).contains(&player.position_ratings[index])
            })
        };
        let positions_match = self.positions.is_empty()
            || if self.all_positions {
                self.positions.iter().all(matches_position)
            } else {
                self.positions.iter().any(matches_position)
            };
        let p = &player.search;
        !self.invalid
            && positions_match
            && in_range(Some(player.current_ability), None, self.max_current)
            && in_range((player.potential_ability > 0).then_some(player.potential_ability), None, self.max_potential)
            && in_range(p.height, self.min_height, self.max_height)
            && in_range(p.reputation, self.min_reputation, self.max_reputation)
            && in_range(
                player.transfer_value.filter(|&value| value >= 0).map(i64::from),
                self.min_value,
                self.max_value,
            )
            && in_range(p.asking_price.map(i64::from), self.min_asking, self.max_asking)
            && in_range(player.contract_expires, self.contract_expires_from, None)
            && self.trait_bit.is_none_or(|bit| bit < 64 && (p.traits & (1 << bit)) != 0)
            && self.personality.iter().all(|bound| {
                PERSONALITY.iter().position(|&key| key == bound.key).is_some_and(|index| {
                    let value = p.personality[index];
                    (1..=20).contains(&value) && in_range(Some(value), bound.min, bound.max)
                })
            })
            && self.foot.is_none_or(|foot| {
                let (Some(left), Some(right)) = (player_attribute("left_foot"), player_attribute("right_foot")) else {
                    return false;
                };
                let (Some(&left), Some(&right)) = (player.attributes.get(left), player.attributes.get(right)) else {
                    return false;
                };
                left > 0
                    && right > 0
                    && match foot {
                        DominantFoot::Left => left > right,
                        DominantFoot::Right => right > left,
                        DominantFoot::Equal => right == left,
                    }
            })
            && self.role.as_ref().is_none_or(|filter| self.matches_role(player, filter))
    }

    fn matches_role(&self, player: &PlayerSummary, filter: &RoleFilter) -> bool {
        let Some(role) = role(filter.phase, &filter.key) else {
            return false;
        };
        let has_position = POSITIONS.iter().zip(player.position_ratings).any(|(&position, rating)| {
            (self.position_rating.unwrap_or(PLAYABLE_RATING)..=20).contains(&rating)
                && (self.positions.is_empty() || self.positions.iter().any(|p| p == position))
                && scout_position(position).is_some_and(|spot| spot.lines.contains(&role.line))
        });
        if !has_position {
            return false;
        }
        let keys = role.key_attributes.iter().map(|key| (key, 3));
        let other = role.other_attributes.iter().map(|key| (key, 1));
        let (mut points, mut weights) = (0, 0);
        for (key, weight) in keys.chain(other) {
            let Some(&value) = player_attribute(key).and_then(|i| player.attributes.get(i)) else {
                return false;
            };
            if value == 0 {
                return false;
            }
            points += u16::from(value) * weight;
            weights += weight;
        }
        weights > 0 && points >= u16::from(filter.min_rating) * weights
    }
}

impl Session {
    /// Additional lookups only for players passing the in-memory filters.
    pub fn matches_player_filter(
        &self,
        filter: &PlayerFilter,
        player: &PlayerSummary,
        club: Option<&ClubSummary>,
        today: Option<FmDate>,
    ) -> bool {
        if !filter.matches(player) {
            return false;
        }
        let extra = &filter.advanced;
        contains(club.and_then(|club| club.nation.as_deref()), extra.country.as_deref())
            && contains(club.and_then(|club| club.league.as_deref()), extra.league.as_deref())
            && contains(player.search.continent.as_deref(), extra.continent.as_deref())
            && extra.expires_within_months.is_none_or(|months| {
                today.zip(player.contract_expires).is_some_and(|(today, end)| {
                    today <= end && today.plus_months(months).is_some_and(|limit| end <= limit)
                })
            })
            && self.matches_player_contract(player, extra, today)
            && extra.second_nation.as_deref().filter(|text| !text.trim().is_empty()).is_none_or(|text| {
                self.relations(player).is_ok_and(|ties| {
                    ties.iter().any(|tie| {
                        tie.tie == Tie::Nationality
                            && tie.target_uid != player.nation_uid.unwrap_or(0)
                            && contains(tie.name.as_deref(), Some(text))
                    })
                })
            })
    }

    fn matches_player_contract(
        &self,
        player: &PlayerSummary,
        extra: &PlayerAdvancedFilter,
        today: Option<FmDate>,
    ) -> bool {
        let has_clauses = extra.clause.is_some() || extra.max_release_fee.is_some();
        let has_wage = extra.min_wage.is_some() || extra.max_wage.is_some();
        if !has_clauses && !has_wage {
            return true;
        }
        let layout = &self.layout.player;
        let at = |offset| player.address + layout.at(offset, player.shift);
        if self.process.read_u32(at(layout.uid)).ok() != Some(player.uid) {
            return false;
        }
        let Ok(contract) = self.process.read_u64(at(layout.contract)) else {
            return false;
        };
        if !fmlibre_mem::is_user_pointer(contract) {
            return false;
        }
        if has_wage {
            let wage = self
                .process
                .read_u32(contract + self.layout.contract.wage)
                .ok()
                .map(|raw| raw as i32)
                .filter(|&wage| wage >= 0)
                .map(i64::from);
            if !in_range(wage, extra.min_wage, extra.max_wage) {
                return false;
            }
        }
        if !has_clauses {
            return true;
        }
        let clauses = read_clauses(&self.process, &self.layout, contract);
        extra.clause.is_none_or(|kind| clauses.iter().any(|clause| clause.kind == kind))
            && extra.max_release_fee.is_none_or(|max| {
                let signed = self
                    .process
                    .read_u32(contract + self.layout.contract.signed)
                    .ok()
                    .and_then(|raw| FmDate::from_raw(raw as u16, (raw >> 16) as u16));
                clauses.iter().any(|clause| {
                    crate::RELEASE_CLAUSES.contains(&clause.kind)
                        && clause.amount.is_some_and(|amount| i64::from(amount) <= max)
                        && (clause.condition.is_none()
                            || crate::release_clause_never_expires(clause)
                            || crate::release_clause_expiry(clause, signed)
                                .zip(today)
                                .is_some_and(|(end, day)| day < end))
                })
            })
    }

    pub fn player_continent(&self, nation: u64) -> Option<String> {
        nation_continent(&self.process, &self.plugin, &self.layout, nation)
    }
}

/// Whether `text` contains `needle`, ignoring accents and case; an empty needle matches anything.
fn contains(text: Option<&str>, needle: Option<&str>) -> bool {
    match needle.map(str::trim).filter(|n| !n.is_empty()) {
        Some(needle) => text.is_some_and(|text| fold(text).contains(&fold(needle))),
        None => true,
    }
}

/// Columns the player list can be sorted by.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlayerSort {
    #[default]
    CurrentAbility,
    PotentialAbility,
    Age,
    Name,
    Nation,
    Club,
    ContractExpires,
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PlayerOrder {
    pub by: PlayerSort,
    pub ascending: bool,
}

/// Sorts `players` by `order`; unknown values go last either way. Text compares without
/// accents or case. The sort is stable: equal players keep their order, which after a
/// search is best first.
pub fn sort_players(players: &mut [&PlayerSummary], order: PlayerOrder) {
    sort_rows(players, order.ascending, |p| match order.by {
        PlayerSort::CurrentAbility => Some(SortKey::Number(p.current_ability.into())),
        PlayerSort::PotentialAbility => Some(SortKey::Number(p.potential_ability.into())),
        PlayerSort::Age => p.age.map(|age| SortKey::Number(age.into())),
        PlayerSort::Name => Some(SortKey::Text(&p.name)),
        PlayerSort::Nation => p.nation.as_deref().map(SortKey::Text),
        PlayerSort::Club => p.club.as_deref().map(SortKey::Text),
        PlayerSort::ContractExpires => p.contract_expires.map(|end| SortKey::Number(end.to_number())),
    });
}

/// What a row of a list is sorted by: a number, or a text, which compares without accents or case.
enum SortKey<'a> {
    Number(i64),
    Text(&'a str),
}

/// Sorts `rows` by what `key` gives each, the lowest first when `ascending`; the rows it gives nothing for go last
/// either way. The sort is stable: equal rows keep their order.
fn sort_rows<'a, T>(rows: &mut [&'a T], ascending: bool, key: impl Fn(&'a T) -> Option<SortKey<'a>>) {
    /// A key as it is compared.
    #[derive(PartialEq, Eq, PartialOrd, Ord)]
    enum Compared {
        Number(i64),
        Text(String),
    }
    // Fold each distinct text once rather than on every comparison.
    let mut folded: HashMap<&str, String> = HashMap::new();
    let mut keyed: Vec<(Option<Compared>, &'a T)> = rows
        .iter()
        .map(|&row| {
            let compared = key(row).map(|key| match key {
                SortKey::Number(number) => Compared::Number(number),
                SortKey::Text(text) => Compared::Text(folded.entry(text).or_insert_with(|| fold(text)).clone()),
            });
            (compared, row)
        })
        .collect();
    keyed.sort_by(|(a, _), (b, _)| match (a, b) {
        (Some(a), Some(b)) if ascending => a.cmp(b),
        (Some(a), Some(b)) => b.cmp(a),
        _ => b.is_some().cmp(&a.is_some()),
    });
    for (slot, (_, row)) in rows.iter_mut().zip(keyed) {
        *slot = row;
    }
}

/// Filters for the staff list, the player list's where they apply to staff. Unset fields match everyone.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StaffFilter {
    /// FM job code; a player-coach variant (code + 1) matches too.
    pub job: Option<u8>,
    pub min_age: Option<u16>,
    pub max_age: Option<u16>,
    pub min_current_ability: Option<u16>,
    pub min_potential_ability: Option<i16>,
    /// Part of the nation's name, accents and case ignored.
    pub nation: Option<String>,
    /// Part of the employer's name, accents and case ignored.
    pub club: Option<String>,
    /// Only staff without a contract.
    pub unemployed: bool,
    /// Only contracts ending on or before this date.
    pub contract_expires_by: Option<FmDate>,
    /// `Some(true)` for women only, `Some(false)` for men only. Whom the layout cannot tell apart matches neither.
    pub women: Option<bool>,
    /// Bounds on attributes, every one of which must hold.
    pub attributes: Vec<AttributeBound>,
}

impl StaffFilter {
    pub fn matches(&self, s: &StaffSummary) -> bool {
        self.job.is_none_or(|job| s.job.is_some_and(|code| code == job || code == job + 1))
            && self.min_age.is_none_or(|min| s.age.is_some_and(|age| age >= min))
            && self.max_age.is_none_or(|max| s.age.is_some_and(|age| age <= max))
            && self.min_current_ability.is_none_or(|min| s.current_ability >= min)
            && self.min_potential_ability.is_none_or(|min| s.potential_ability >= min)
            && contains(s.nation.as_deref(), self.nation.as_deref())
            && contains(s.club.as_deref(), self.club.as_deref())
            && (!self.unemployed || s.job.is_none())
            && self.contract_expires_by.is_none_or(|by| s.contract_expires.is_some_and(|end| end <= by))
            && self.women.is_none_or(|women| s.woman == Some(women))
            && self.attributes.iter().all(|bound| bound.holds(&STAFF_ATTRIBUTES, &s.attributes))
    }
}

/// Columns the staff list can be sorted by.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StaffSort {
    #[default]
    CurrentAbility,
    PotentialAbility,
    Age,
    Name,
    Nation,
    Club,
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StaffOrder {
    pub by: StaffSort,
    pub ascending: bool,
}

/// Sorts `staff` by `order` as [`sort_players`] sorts players. Unlike the search's own order, it does not put the
/// human manager first.
pub fn sort_staff(staff: &mut [&StaffSummary], order: StaffOrder) {
    sort_rows(staff, order.ascending, |s| match order.by {
        StaffSort::CurrentAbility => Some(SortKey::Number(s.current_ability.into())),
        StaffSort::PotentialAbility => Some(SortKey::Number(s.potential_ability.into())),
        StaffSort::Age => s.age.map(|age| SortKey::Number(age.into())),
        StaffSort::Name => Some(SortKey::Text(&s.name)),
        StaffSort::Nation => s.nation.as_deref().map(SortKey::Text),
        StaffSort::Club => s.club.as_deref().map(SortKey::Text),
    });
}

/// Filters for the club list. Unset fields match every club; a club whose nation, league or reputation is not known
/// keeps to no filter on it, so that a mass edit never widens to it.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ClubFilter {
    /// `Some(true)` for women's clubs only, `Some(false)` for men's clubs only.
    pub women: Option<bool>,
    /// Part of the name of the nation the club is from, accents and case ignored.
    pub nation: Option<String>,
    /// Only the clubs whose senior team plays in the league with this UID this season.
    pub league_uid: Option<u32>,
    /// Bounds on the reputation, 0–10000 as stored.
    pub min_reputation: Option<u16>,
    pub max_reputation: Option<u16>,
}

impl ClubFilter {
    pub fn matches(&self, c: &ClubSummary) -> bool {
        self.women.is_none_or(|women| c.women == women)
            && contains(c.nation.as_deref(), self.nation.as_deref())
            && self.league_uid.is_none_or(|uid| c.league_uid == Some(uid))
            && self.min_reputation.is_none_or(|min| c.reputation.is_some_and(|rep| rep >= min))
            && self.max_reputation.is_none_or(|max| c.reputation.is_some_and(|rep| rep <= max))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn player(name: &str, age: Option<u16>, ca: u16, club: Option<&str>, st: u8) -> PlayerSummary {
        let mut position_ratings = [1u8; 15];
        position_ratings[12] = st;
        PlayerSummary {
            uid: 1,
            name: name.to_owned(),
            full_name: None,
            date_of_birth: None,
            age,
            nation: Some("Türkiye".to_owned()),
            nation_uid: None,
            club: club.map(str::to_owned),
            club_uid: None,
            positions: Vec::new(),
            contract_expires: Some(FmDate { year: 2027, month: 6, day: 30 }),
            current_ability: ca,
            potential_ability: ca as i16 + 10,
            position_ratings,
            nation_address: 0,
            attributes: vec![10; PLAYER_ATTRIBUTES.len()],
            transfer_listed: false,
            loan_listed: false,
            transfer_value: None,
            search: Default::default(),
            woman: Some(false),
            address: 0,
            shift: 0,
        }
    }

    fn staff(name: &str, age: Option<u16>, ca: u16, club: Option<&str>, job: Option<u8>) -> StaffSummary {
        StaffSummary {
            uid: 1,
            name: name.to_owned(),
            full_name: None,
            date_of_birth: None,
            age,
            nation: Some("Nederland".to_owned()),
            nation_uid: None,
            nation_address: 0,
            club: club.map(str::to_owned),
            club_uid: None,
            job,
            current_ability: ca,
            potential_ability: ca as i16 + 5,
            is_human: false,
            attributes: vec![10; STAFF_ATTRIBUTES.len()],
            contract_expires: club.map(|_| FmDate { year: 2027, month: 7, day: 31 }),
            woman: Some(false),
            address: 0,
            shift: 0,
        }
    }

    fn bound(key: &str, min: Option<u8>, max: Option<u8>) -> AttributeBound {
        AttributeBound { key: key.to_owned(), min, max }
    }

    fn club(name: &str, nation: Option<&str>, league: Option<u32>, reputation: Option<u16>) -> ClubSummary {
        ClubSummary {
            uid: 1,
            name: name.to_owned(),
            short_name: None,
            women: false,
            reputation,
            founded: None,
            nation: nation.map(str::to_owned),
            nation_uid: None,
            league: league.map(|uid| format!("League {uid}")),
            league_uid: league,
            league_nation: None,
            address: 0,
        }
    }

    #[test]
    fn club_filters_combine() {
        let cardiff = club("Cardiff City", Some("Wales"), Some(9), Some(5273));
        let persija = club("Persija Jakarta", Some("Indonésia"), Some(70), Some(3200));
        let unknown = club("Somewhere", None, None, None);
        let by = |filter: ClubFilter| {
            [&cardiff, &persija, &unknown]
                .into_iter()
                .filter(|c| filter.matches(c))
                .map(|c| c.name.as_str())
                .collect::<Vec<_>>()
        };
        assert_eq!(by(ClubFilter::default()), ["Cardiff City", "Persija Jakarta", "Somewhere"]);
        // A nation by part of its name, accents and case ignored.
        assert_eq!(by(ClubFilter { nation: Some("indonesia".into()), ..Default::default() }), ["Persija Jakarta"]);
        assert_eq!(by(ClubFilter { league_uid: Some(9), ..Default::default() }), ["Cardiff City"]);
        assert_eq!(by(ClubFilter { min_reputation: Some(5000), ..Default::default() }), ["Cardiff City"]);
        assert_eq!(by(ClubFilter { max_reputation: Some(5000), ..Default::default() }), ["Persija Jakarta"]);
        // Every filter must hold; a club whose nation, league or reputation is unknown keeps to none of them.
        let both = ClubFilter { nation: Some("wal".into()), max_reputation: Some(5000), ..Default::default() };
        assert!(by(both).is_empty());
        assert_eq!(by(ClubFilter { women: Some(false), ..Default::default() }).len(), 3);
    }

    #[test]
    fn women_and_men() {
        let mut player = player("Bonmatí", Some(28), 170, Some("Barcelona"), 1);
        let women = PlayerFilter { women: Some(true), ..PlayerFilter::default() };
        let men = PlayerFilter { women: Some(false), ..PlayerFilter::default() };
        assert!(men.matches(&player) && !women.matches(&player));
        player.woman = Some(true);
        assert!(women.matches(&player) && !men.matches(&player));
        // Where the layout cannot tell, the player is neither, and only a list without the filter shows him.
        player.woman = None;
        assert!(!women.matches(&player) && !men.matches(&player));
        assert!(PlayerFilter::default().matches(&player));
    }

    #[test]
    fn staff_filters_combine() {
        let mut coach = staff("Wiegman", Some(56), 160, Some("England Women"), Some(16));
        coach.woman = Some(true);
        let filter = StaffFilter {
            job: Some(16),
            min_age: Some(50),
            max_age: Some(60),
            min_current_ability: Some(150),
            min_potential_ability: Some(160),
            nation: Some("nederland".to_owned()),
            club: Some("england".to_owned()),
            contract_expires_by: Some(FmDate { year: 2027, month: 12, day: 31 }),
            women: Some(true),
            ..StaffFilter::default()
        };
        assert!(filter.matches(&coach));
        assert!(!StaffFilter { women: Some(false), ..StaffFilter::default() }.matches(&coach));
        assert!(!StaffFilter { max_age: Some(55), ..StaffFilter::default() }.matches(&coach));
        assert!(!StaffFilter { min_potential_ability: Some(170), ..StaffFilter::default() }.matches(&coach));
        assert!(!StaffFilter { club: Some("arsenal".to_owned()), ..StaffFilter::default() }.matches(&coach));
        assert!(!StaffFilter { unemployed: true, ..StaffFilter::default() }.matches(&coach));
        let by = |year| StaffFilter {
            contract_expires_by: Some(FmDate { year, month: 1, day: 1 }),
            ..StaffFilter::default()
        };
        assert!(!by(2027).matches(&coach) && by(2028).matches(&coach));

        // Without a contract: no club and no end, so only the unemployed filter takes him.
        let free = staff("Ten Hag", None, 150, None, None);
        assert!(StaffFilter { unemployed: true, ..StaffFilter::default() }.matches(&free));
        assert!(!by(2030).matches(&free));
        assert!(!StaffFilter { min_age: Some(30), ..StaffFilter::default() }.matches(&free));
        assert!(!StaffFilter { nation: Some("türk".to_owned()), ..StaffFilter::default() }.matches(&free));
    }

    #[test]
    fn attribute_bounds_and_listings() {
        let mut striker = player("Arda", Some(19), 140, Some("Fenerbahçe"), 18);
        striker.attributes[PLAYER_ATTRIBUTES["finishing"]] = 17;
        striker.attributes[PLAYER_ATTRIBUTES["injury_proneness"]] = 4;
        let with = |attributes| PlayerFilter { attributes, ..PlayerFilter::default() };
        assert!(with(vec![bound("finishing", Some(15), None)]).matches(&striker));
        assert!(
            with(vec![bound("finishing", Some(15), None), bound("injury_proneness", None, Some(5))]).matches(&striker)
        );
        assert!(!with(vec![bound("finishing", Some(18), None)]).matches(&striker));
        assert!(!with(vec![bound("injury_proneness", None, Some(3))]).matches(&striker));
        // A key players do not have, or an attribute the layout does not place, matches no one.
        assert!(!with(vec![bound("tactical", None, None)]).matches(&striker));
        striker.attributes[PLAYER_ATTRIBUTES["flair"]] = 0;
        assert!(!with(vec![bound("flair", None, Some(20))]).matches(&striker));

        assert!(!PlayerFilter { transfer_listed: true, ..PlayerFilter::default() }.matches(&striker));
        striker.transfer_listed = true;
        assert!(PlayerFilter { transfer_listed: true, ..PlayerFilter::default() }.matches(&striker));
        assert!(!PlayerFilter { loan_listed: true, ..PlayerFilter::default() }.matches(&striker));
    }

    #[test]
    fn filters_combine() {
        let striker = player("Arda", Some(19), 140, Some("Fenerbahçe"), 18);
        let filter = PlayerFilter {
            position: Some("st".to_owned()),
            max_age: Some(21),
            min_current_ability: Some(120),
            nation: Some("turkiye".to_owned()),
            club: Some("fenerbahce".to_owned()),
            contract_expires_by: Some(FmDate { year: 2027, month: 12, day: 31 }),
            ..PlayerFilter::default()
        };
        assert!(filter.matches(&striker));
        assert!(!PlayerFilter { position: Some("gk".to_owned()), ..PlayerFilter::default() }.matches(&striker));
        assert!(!PlayerFilter { free_agents: true, ..PlayerFilter::default() }.matches(&striker));
        assert!(!PlayerFilter { min_age: Some(20), ..PlayerFilter::default() }.matches(&striker));
        let no_age = player("Unknown", None, 100, None, 1);
        assert!(!PlayerFilter { max_age: Some(30), ..PlayerFilter::default() }.matches(&no_age));
        assert!(PlayerFilter { free_agents: true, ..PlayerFilter::default() }.matches(&no_age));
    }

    #[test]
    fn advanced_position_modes_combine_with_ability_age_and_attributes() {
        let mut striker = player("Striker", Some(25), 145, Some("Test FC"), 18);
        striker.potential_ability = 175;
        let amc = POSITIONS.iter().position(|&position| position == "amc").unwrap();
        striker.position_ratings[amc] = 15;
        striker.search.height = Some(186);
        striker.search.traits = 1 << 6;
        striker.attributes[PLAYER_ATTRIBUTES["finishing"]] = 17;
        let mut filter = PlayerFilter {
            max_age: Some(25),
            min_current_ability: Some(141),
            min_potential_ability: Some(171),
            attributes: vec![AttributeBound { key: "finishing".into(), min: Some(17), max: None }],
            advanced: PlayerAdvancedFilter {
                positions: vec!["st".into(), "amc".into()],
                position_rating: Some(17),
                max_current: Some(160),
                max_potential: Some(180),
                min_height: Some(180),
                trait_bit: Some(6),
                ..PlayerAdvancedFilter::default()
            },
            ..PlayerFilter::default()
        };
        assert!(filter.matches(&striker));
        filter.advanced.all_positions = true;
        assert!(!filter.matches(&striker));
        striker.position_ratings[amc] = 17;
        assert!(filter.matches(&striker));
        striker.search.height = None;
        assert!(!filter.matches(&striker));
        striker.search.height = Some(186);
        striker.age = Some(26);
        assert!(!filter.matches(&striker));
    }

    #[test]
    fn sorting_puts_unknowns_last() {
        let a = player("A", Some(30), 100, Some("X"), 1);
        let b = player("B", None, 120, Some("Y"), 1);
        let c = player("C", Some(20), 110, None, 1);
        let mut list = vec![&a, &b, &c];
        sort_players(&mut list, PlayerOrder { by: PlayerSort::Age, ascending: true });
        assert_eq!(list.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["C", "A", "B"]);
        sort_players(&mut list, PlayerOrder { by: PlayerSort::Age, ascending: false });
        assert_eq!(list.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["A", "C", "B"]);
        sort_players(&mut list, PlayerOrder { by: PlayerSort::CurrentAbility, ascending: false });
        assert_eq!(list.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["B", "C", "A"]);
    }

    #[test]
    fn staff_sorting() {
        let mut human = staff("Zeki", Some(40), 120, Some("Arsenal"), Some(16));
        human.is_human = true;
        let free = staff("Ünal", None, 160, None, None);
        let coach = staff("Ali", Some(55), 140, Some("Beşiktaş"), Some(2));
        let mut list = vec![&human, &free, &coach];
        let by = |by, ascending| StaffOrder { by, ascending };
        let names = |list: &[&StaffSummary]| list.iter().map(|s| s.name.clone()).collect::<Vec<_>>();
        sort_staff(&mut list, by(StaffSort::Name, true));
        assert_eq!(names(&list), ["Ali", "Ünal", "Zeki"]);
        sort_staff(&mut list, by(StaffSort::CurrentAbility, false));
        assert_eq!(names(&list), ["Ünal", "Ali", "Zeki"]);
        // No age and no club go last, whichever way.
        sort_staff(&mut list, by(StaffSort::Age, false));
        assert_eq!(names(&list), ["Ali", "Zeki", "Ünal"]);
        sort_staff(&mut list, by(StaffSort::Club, true));
        assert_eq!(names(&list), ["Zeki", "Ali", "Ünal"]);
        sort_staff(&mut list, by(StaffSort::Club, false));
        assert_eq!(names(&list), ["Ali", "Zeki", "Ünal"]);
    }

    #[test]
    fn text_sorts_ignore_accents_and_keep_ties_in_order() {
        let ozil = player("Özil", Some(30), 150, Some("Fenerbahçe"), 1);
        let pele = player("pelé", Some(30), 160, Some("Santos"), 1);
        let zico = player("Zico", Some(30), 140, Some("Flamengo"), 1);
        let mut list = vec![&zico, &pele, &ozil];
        sort_players(&mut list, PlayerOrder { by: PlayerSort::Name, ascending: true });
        assert_eq!(list.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["Özil", "pelé", "Zico"]);
        sort_players(&mut list, PlayerOrder { by: PlayerSort::Club, ascending: true });
        assert_eq!(list.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["Özil", "Zico", "pelé"]);
        // Same age: the incoming order (here by club) decides.
        sort_players(&mut list, PlayerOrder { by: PlayerSort::Age, ascending: true });
        assert_eq!(list.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["Özil", "Zico", "pelé"]);
    }
}
