use super::development_store::{
    CareerPeriods, FAVORITES, FinanceSnapshot, Frequency, Period, PlayerRef, Rules, Settings, Snapshot, Store,
};
use super::{AppState, Connection, Entity, ExportsFolder, Failure, FmDate, not_connected, not_found, now_ms};
use fmlibre_core::{
    DevelopmentAttributes, DevelopmentFields, DevelopmentMinimum, DevelopmentPlayer, MoveError, ROLES, Scale,
    weekly_minimum_due,
};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use tauri::Manager;

type Roster = BTreeMap<u32, Result<Option<DevelopmentPlayer>, MoveError>>;

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DevelopmentStatus {
    active: bool,
    club: Option<u32>,
    team: Option<usize>,
    multiplier: u8,
    weekly_limit: Option<u16>,
    weekly: bool,
    guaranteed_weekly_growth: bool,
    tracked: usize,
    processed: usize,
    boosted: usize,
    unchanged: usize,
    failures: usize,
    mean_bonus: f64,
    event: u64,
    last_date: Option<FmDate>,
    last_week: Option<FmDate>,
    error: Option<String>,
    report_date: Option<FmDate>,
    report: Vec<DevelopmentReport>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DevelopmentReport {
    uid: u32,
    name: String,
    ca: Option<u16>,
    ca_before: Option<u16>,
    pa: Option<i16>,
    natural: u16,
    bonus: u16,
    guaranteed_gain: u16,
    attributes: Vec<AttributeBonus>,
    focus: Vec<String>,
    multiplier: u8,
    group: Option<String>,
    week: FmDate,
    attempted_at: Option<u64>,
    status: String,
    reason: Option<String>,
    growth_reason: Option<&'static str>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttributeBonus {
    key: String,
    shown: i64,
    raw_gain: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DevelopmentCandidate {
    uid: u32,
    born: Option<FmDate>,
    name: String,
    club: String,
    positions: Vec<&'static str>,
    age: Option<u16>,
    ability: u16,
    potential: Option<u16>,
    raw_potential: i16,
    eligible: bool,
    reason: Option<String>,
    focus: Vec<String>,
}

struct Plan {
    player: PlayerRef,
    rules: Rules,
    group: Option<String>,
    frequency: Frequency,
}

#[derive(Default)]
pub(super) struct Development {
    status: DevelopmentStatus,
    pub(super) store: Store,
    career_periods: CareerPeriods,
    fields: Option<DevelopmentFields>,
    peaks: BTreeMap<u32, DevelopmentPlayer>,
    recent_reads: BTreeMap<u32, FmDate>,
    plans: BTreeMap<u32, Plan>,
}

fn scope_key(club: u32, team: Option<usize>) -> String {
    team.map_or_else(|| club.to_string(), |team| format!("{club}/{team}"))
}

fn focused(positions: &[&str], focus: Option<&str>) -> Vec<String> {
    if let Some(keys) = focus.and_then(|value| value.strip_prefix("custom:")) {
        return keys.split(',').filter(|key| !key.is_empty()).map(|key| format!("attribute.{key}")).collect();
    }
    let position = positions.first().copied().unwrap_or("");
    let focus = match focus.unwrap_or("auto") {
        "auto" => match position {
            "gk" => "goalkeeper",
            "dl" | "dc" | "dr" | "wbl" | "wbr" | "sw" => "defender",
            "amr" | "aml" | "ml" | "mr" => "winger",
            "st" => "striker",
            "dm" | "mc" | "amc" => "midfielder",
            _ => "none",
        },
        value => value,
    };
    let priorities: &[&str] = match focus {
        "goalkeeper" => &["reflexes", "one_on_ones", "handling", "positioning", "communication"],
        "defender" => &["marking", "tackling", "positioning", "anticipation", "jumping_reach"],
        "midfielder" => &["passing", "vision", "technique", "decisions", "first_touch"],
        "striker" => &["finishing", "composure", "anticipation", "off_the_ball", "technique"],
        "winger" => &["dribbling", "acceleration", "pace", "crossing", "off_the_ball"],
        role => role
            .strip_prefix("role:")
            .and_then(|key| ROLES.iter().find(|role| role.key == key))
            .map_or(&[], |role| role.key_attributes),
    };
    priorities.iter().map(|key| format!("attribute.{key}")).collect()
}

fn observation(
    summary: &fmlibre_core::PlayerSummary,
    sample: &DevelopmentPlayer,
    fields: &DevelopmentFields,
    date: FmDate,
    source: &str,
) -> Snapshot {
    Snapshot {
        player: PlayerRef { uid: summary.uid, born: sample.born() },
        name: summary.name.clone(),
        club: summary.club.clone(),
        date,
        read_at: now_ms(),
        ability: sample.ability(),
        potential: sample.raw_potential(),
        attributes: sample.attributes(fields),
        source: source.into(),
    }
}

fn period_due(last: FmDate, date: FmDate, frequency: Frequency) -> bool {
    match frequency {
        Frequency::Daily => date > last,
        Frequency::Weekly => date.week_start() > last.week_start(),
    }
}

fn missed_week(last: FmDate, date: FmDate) -> bool {
    last.week_start().plus_days(7) < date.week_start()
}

impl Development {
    /// An edit performed by another tool starts a fresh baseline for that player.
    pub(super) fn forget(&mut self, uid: u32) {
        self.peaks.remove(&uid);
    }

    fn stop(&mut self, error: Option<String>) {
        self.status.active = false;
        self.status.tracked = 0;
        self.status.error = error;
        self.fields = None;
        self.peaks.clear();
        self.recent_reads.clear();
        self.plans.clear();
    }

    pub(super) fn reset_after_reload(&mut self) {
        self.stop(None);
        self.store = Store::default();
        self.career_periods = CareerPeriods::default();
        self.status.last_date = None;
        self.status.last_week = None;
        self.status.report.clear();
        self.status.report_date = None;
    }

    fn pass(&mut self, connection: &mut Connection, fields: &DevelopmentFields) -> Result<(), Failure> {
        check_connection(connection)?;
        let date = connection.session.game_date().ok_or_else(date_missing)?;
        if self.status.last_date.is_some_and(|previous| previous > date) {
            return Err(Failure::new(
                "development.date",
                "A data da carreira voltou. Confira a partida e ative novamente.",
            ));
        }
        if self.status.last_date == Some(date) {
            return Ok(());
        }
        let guaranteed = self.status.guaranteed_weekly_growth;
        let due: BTreeSet<u32> = self
            .plans
            .iter()
            .filter_map(|(&uid, plan)| {
                let last = self.recent_reads.get(&uid).copied()?;
                let frequency = if guaranteed { Frequency::Weekly } else { plan.frequency };
                period_due(last, date, frequency).then_some(uid)
            })
            .collect();
        if due.is_empty() {
            self.status.last_date = Some(date);
            return Ok(());
        }

        let club_uid = self.status.club.expect("clube para uma rotina ativa");
        let club = connection.clubs.get(club_uid).ok_or_else(|| not_found(Entity::Club, club_uid))?;
        let mut samples =
            connection.session.development_roster(club, self.status.team, &connection.players, Some(&due), fields)?;
        if connection.session.game_date() != Some(date) {
            return Ok(());
        }

        let week = date.week_start();
        let prior_periods: BTreeMap<_, _> = due
            .iter()
            .map(|&uid| {
                let player = self.plans[&uid].player;
                let period = [self.store.document.periods.get(&uid), self.career_periods.players.get(&uid)]
                    .into_iter()
                    .flatten()
                    .filter(|stamp| stamp.player == player)
                    .max_by_key(|stamp| (stamp.week, stamp.guaranteed, stamp.day))
                    .copied();
                (uid, period)
            })
            .collect();
        let minimum_due: BTreeSet<_> = due
            .iter()
            .copied()
            .filter(|uid| {
                self.status.guaranteed_weekly_growth
                    && weekly_minimum_due(
                        self.recent_reads[uid].week_start(),
                        week,
                        prior_periods[uid]
                            .filter(|stamp| stamp.player == self.plans[uid].player)
                            .map(|stamp| stamp.week),
                    )
            })
            .collect();
        // Persist the reservation before writing CA. A restart or an interrupted write cannot apply the period again.
        let mut reserved = false;
        for &uid in &due {
            let plan = &self.plans[&uid];
            let prior = prior_periods[&uid].filter(|stamp| stamp.player == plan.player);
            if prior.is_some_and(|stamp| stamp.already_processed(date, plan.frequency, guaranteed))
                || (guaranteed
                    && !matches!(samples.get(&uid), Some(Ok(Some(sample))) if sample.born() == plan.player.born))
            {
                continue;
            }
            let same_week = prior.filter(|stamp| stamp.week == week);
            let period = Period {
                player: plan.player,
                day: date,
                week,
                granted: same_week.map_or(0, |stamp| stamp.granted),
                guaranteed,
            };
            if guaranteed {
                self.career_periods.players.insert(uid, period);
            } else {
                self.store.document.periods.insert(uid, period);
            }
            reserved = true;
        }
        if reserved {
            if guaranteed {
                self.career_periods.save()?;
            } else {
                self.store.save()?;
            }
        }

        let mut reports = Vec::with_capacity(due.len());
        let mut snapshots = Vec::new();
        let mut failures = 0;
        let mut boosted = 0;
        let mut total_bonus = 0u64;
        let batch = connection.fresh_id();
        for uid in due {
            let plan = &self.plans[&uid];
            let factor = plan.rules.multiplier.unwrap_or(5);
            let mut row = DevelopmentReport {
                uid,
                name: connection.players.get(uid).map_or_else(|| uid.to_string(), |p| p.name.clone()),
                ca: None,
                ca_before: None,
                pa: None,
                natural: 0,
                bonus: 0,
                guaranteed_gain: 0,
                attributes: Vec::new(),
                focus: Vec::new(),
                multiplier: factor,
                group: plan.group.clone(),
                week,
                attempted_at: None,
                status: "Sem alteração".into(),
                reason: None,
                growth_reason: None,
            };
            let last = self.recent_reads[&uid];
            let minimum_due = minimum_due.contains(&uid);
            if !minimum_due {
                self.recent_reads.insert(uid, date);
            }
            let outcome = (|| -> Result<Option<DevelopmentPlayer>, (&'static str, String)> {
                if connection.session.game_date() != Some(date) {
                    return Err(("Data mudou", "O FM avançou durante a verificação".into()));
                }
                let mut sample = match samples.remove(&uid) {
                    Some(Ok(Some(sample))) if sample.born() == plan.player.born => sample,
                    Some(Err(error)) => return Err(("Falha de leitura", error.to_string())),
                    _ => {
                        return Err(("Registro indisponível", "Jogador fora do elenco validado ou ficha mudou".into()));
                    }
                };
                if minimum_due {
                    self.recent_reads.insert(uid, date);
                }
                row.ca = Some(sample.ability());
                row.ca_before = row.ca;
                row.pa = Some(sample.raw_potential());
                row.focus = focused(sample.positions(), plan.rules.focus.as_deref());
                let mode = if !row.focus.is_empty() {
                    DevelopmentAttributes::Focus(&row.focus)
                } else if plan.rules.focus.as_deref() == Some("none") && plan.frequency == Frequency::Daily {
                    DevelopmentAttributes::AllObserved
                } else {
                    DevelopmentAttributes::AbilityOnly
                };
                if let Some(summary) = connection.players.get(uid) {
                    snapshots.push(observation(summary, &sample, fields, date, "Leitura do FM"));
                }
                let previous = prior_periods[&uid].filter(|stamp| stamp.player == plan.player);
                let duplicate = previous.is_some_and(|stamp| stamp.already_processed(date, plan.frequency, guaranteed));
                let gap = missed_week(last, date);
                let same_week = previous.filter(|stamp| stamp.week == week);
                let minimum = if minimum_due { DevelopmentMinimum::Due } else { DevelopmentMinimum::NotDue };
                let peak = self.peaks.get(&uid).filter(|peak| peak.same_player(&sample) && !gap);
                let fresh_baseline = (minimum_due && peak.is_none()).then(|| sample.clone());
                let ceiling = sample.potential().min(plan.rules.ceiling.unwrap_or(200));
                if let Some(reason) = blocked(connection, uid, Some(&sample)) {
                    row.status = if reason == "Potencial atingido" { "Limite atingido" } else { "Bloqueado" }.into();
                    row.reason = Some(reason.into());
                } else if plan.rules.paused == Some(true) || (factor == 1 && !guaranteed) {
                    row.status = "Pausado".into();
                } else if sample.ability() >= ceiling {
                    row.status = "Limite atingido".into();
                    row.reason = Some("Teto configurado".into());
                } else if duplicate || (gap && !minimum_due) {
                    row.status = "Referência atualizada".into();
                    row.reason =
                        Some(if duplicate { "Período já conferido" } else { "Avanço de várias semanas" }.into());
                } else if let Some(peak) = peak.or(fresh_baseline.as_ref()) {
                    row.natural = sample.ability().saturating_sub(peak.ability());
                    if row.natural > 0 || minimum_due {
                        let granted = same_week.map_or(0, |stamp| stamp.granted);
                        let remaining = plan.rules.weekly_limit.map_or(u16::MAX, |limit| limit.saturating_sub(granted));
                        row.attempted_at = Some(now_ms());
                        let gain = connection
                            .session
                            .apply_development(
                                fields,
                                date,
                                &mut sample,
                                peak,
                                factor,
                                remaining,
                                ceiling,
                                mode,
                                minimum,
                            )
                            .map_err(|error| ("Falha de gravação", error.to_string()))?;
                        row.bonus = gain.bonus;
                        row.ca = Some(sample.ability());
                        row.attributes = gain
                            .changes
                            .iter()
                            .filter_map(|change| {
                                Some(AttributeBonus {
                                    key: change.field.strip_prefix("attribute.")?.into(),
                                    shown: Scale::Attribute.shown(change.new) - Scale::Attribute.shown(change.old),
                                    raw_gain: change.new - change.old,
                                })
                            })
                            .collect();
                        if minimum_due {
                            row.guaranteed_gain = gain.bonus.min(u16::from(factor).saturating_sub(row.natural));
                        }
                        let periods = if guaranteed {
                            &mut self.career_periods.players
                        } else {
                            &mut self.store.document.periods
                        };
                        if gain.resolved
                            && let Some(stamp) = periods.get_mut(&uid)
                        {
                            stamp.granted = stamp.granted.saturating_add(gain.bonus);
                        }
                        if gain.bonus > 0 {
                            row.status = "Evolução aplicada".into();
                            row.growth_reason = Some(if row.guaranteed_gain > 0 {
                                "Crescimento semanal garantido"
                            } else {
                                "Amplificação do ganho natural"
                            });
                            if let Some(summary) = connection.players.get(uid) {
                                snapshots.push(observation(summary, &sample, fields, date, "Bônus confirmado"));
                            }
                            let source = if row.guaranteed_gain > 0 {
                                "Desenvolvimento · Crescimento semanal garantido"
                            } else {
                                "Desenvolvimento"
                            };
                            for change in gain.changes {
                                connection.log_tool_change(change, row.name.clone(), batch, source);
                            }
                        }
                        if gain.weekly_limited || gain.potential_limited {
                            row.reason =
                                Some(if gain.weekly_limited { "Limite semanal" } else { "Teto de CA ou PA" }.into());
                        }
                    } else {
                        row.reason = Some("Sem ganho positivo de CA sobre a referência".into());
                    }
                } else {
                    row.status = "Referência atualizada".into();
                    row.reason = Some("Leitura inicial ou após mudança na ficha".into());
                }
                Ok(Some(sample))
            })();
            match outcome {
                Ok(Some(sample)) => {
                    if let Some(peak) = self
                        .peaks
                        .get_mut(&uid)
                        .filter(|_| !(minimum_due && missed_week(last, date)) && !duplicate_or_gap(&row))
                    {
                        peak.observe(&sample, true);
                    } else {
                        self.peaks.insert(uid, sample);
                    }
                }
                Ok(None) => {}
                Err((status, reason)) => {
                    self.peaks.remove(&uid);
                    row.status = status.into();
                    row.reason = Some(reason);
                    failures += 1;
                }
            }
            if row.bonus > 0 {
                total_bonus += u64::from(row.bonus);
                boosted += 1;
            }
            reports.push(row);
        }
        self.store.observe(snapshots);
        self.status.last_date = Some(date);
        self.status.last_week = Some(week);
        self.status.report_date = Some(date);
        self.status.processed = reports.len();
        self.status.boosted = boosted;
        self.status.failures = failures;
        self.status.unchanged = reports.len() - boosted - failures;
        self.status.mean_bonus = total_bonus as f64 / reports.len() as f64;
        self.status.report = reports;
        self.status.event += u64::from(boosted > 0);
        if guaranteed && reserved {
            self.career_periods.save()?;
        }
        self.store.save()
    }
}

fn duplicate_or_gap(row: &DevelopmentReport) -> bool {
    row.status == "Referência atualizada"
}

fn roster(
    connection: &Connection,
    club: u32,
    team: Option<usize>,
    pid: u32,
    selected: Option<&BTreeSet<u32>>,
) -> Result<(DevelopmentFields, FmDate, Roster), Failure> {
    check_connection(connection)?;
    if connection.session.process.pid() != pid || !connection.human_clubs.contains(&club) {
        return Err(Failure::new("development.scope", "Selecione um clube que você comanda nesta partida."));
    }
    let summary = connection.clubs.get(club).ok_or_else(|| not_found(Entity::Club, club))?;
    let date = connection.session.game_date().ok_or_else(date_missing)?;
    let fields = connection.session.development_fields()?;
    let players = connection.session.development_roster(summary, team, &connection.players, selected, &fields)?;
    connection.refuse_after_load()?;
    if connection.session.game_date() != Some(date) {
        return Err(Failure::new(
            "development.date",
            "A data mudou durante a leitura. Aguarde o FM terminar de avançar.",
        ));
    }
    Ok((fields, date, players))
}

fn blocked(connection: &Connection, uid: u32, player: Option<&DevelopmentPlayer>) -> Option<&'static str> {
    let Some(player) = player else {
        return Some("Dados do jogador indisponíveis");
    };
    if connection.frozen.attributes.contains_key(&uid) {
        Some("Atributos congelados")
    } else if player.potential() == 0 {
        Some("PA indefinido ou fora da faixa validada")
    } else if player.ability() >= player.potential() {
        Some("Potencial atingido")
    } else {
        None
    }
}

fn date_missing() -> Failure {
    Failure::new("development.date", "O editor não conseguiu ler a data do FM.")
}

pub(super) fn check_connection(connection: &Connection) -> Result<(), Failure> {
    connection.refuse_after_load()?;
    if !connection.session.process.can_write()
        || !connection.session.known_build()
        || !connection.session.writes_allowed()
    {
        return Err(Failure::new("development.readOnly", "A edição exige conexão de escrita e uma versão validada."));
    }
    Ok(())
}

impl Connection {
    pub(super) fn hold_development(&mut self) {
        if !self.development.status.active {
            return;
        }
        let mut development = std::mem::take(&mut self.development);
        let fields = development.fields.take().expect("active layout");
        match development.pass(self, &fields) {
            Ok(()) => development.fields = Some(fields),
            Err(error) => development.stop(Some(error.message)),
        }
        self.development = development;
    }
}

#[tauri::command]
pub(crate) fn development_status(state: tauri::State<'_, AppState>) -> Result<DevelopmentStatus, Failure> {
    Ok(state.0.lock()?.as_ref().map(|c| c.development.status.clone()).unwrap_or_default())
}

#[tauri::command]
pub(crate) async fn development_preview(
    app: tauri::AppHandle,
    club: u32,
    team: Option<usize>,
    pid: u32,
) -> Result<Vec<DevelopmentCandidate>, Failure> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let guard = state.0.lock()?;
        let connection = guard.as_ref().ok_or_else(not_connected)?;
        let (_, date, players) = roster(connection, club, team, pid, None)?;
        let club_name = &connection.clubs.get(club).ok_or_else(|| not_found(Entity::Club, club))?.name;
        let settings = &connection.development.store.document.settings;
        let mut rows: Vec<_> = players
            .into_iter()
            .filter_map(|(uid, reading)| {
                let summary = connection.players.get(uid)?;
                let player = reading.as_ref().ok().and_then(Option::as_ref);
                let reason = reading
                    .as_ref()
                    .err()
                    .map(ToString::to_string)
                    .or_else(|| blocked(connection, uid, player).map(str::to_owned));
                let born = player.map(DevelopmentPlayer::born).or(summary.date_of_birth);
                let raw_potential = player.map_or(summary.potential_ability, DevelopmentPlayer::raw_potential);
                let rules = born.and_then(|born| settings.rules_for(PlayerRef { uid, born }, &Rules::default()).ok());
                let positions = player.map(DevelopmentPlayer::positions).unwrap_or_default();
                Some(DevelopmentCandidate {
                    uid,
                    born,
                    name: summary.name.clone(),
                    club: club_name.clone(),
                    positions: positions.to_vec(),
                    age: born.and_then(|born| born.age_on(date)),
                    ability: player.map_or(summary.current_ability, DevelopmentPlayer::ability),
                    potential: u16::try_from(raw_potential).ok().filter(|pa| (1..=200).contains(pa)),
                    raw_potential,
                    eligible: reason.is_none(),
                    reason,
                    focus: focused(positions, rules.as_ref().and_then(|(rules, _)| rules.focus.as_deref())),
                })
            })
            .collect();
        rows.sort_by(|a, b| b.eligible.cmp(&a.eligible).then(a.age.cmp(&b.age)).then(a.name.cmp(&b.name)));
        Ok(rows)
    })
    .await?
}

#[tauri::command]
pub(crate) async fn development_set(
    app: tauri::AppHandle,
    multiplier: u8,
    club: u32,
    team: Option<usize>,
    pid: u32,
    weekly_limit: Option<u16>,
    ceiling: Option<u16>,
    weekly: Option<bool>,
    guaranteed_weekly_growth: Option<bool>,
    selected_players: BTreeSet<u32>,
) -> Result<DevelopmentStatus, Failure> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut guard = state.0.lock()?;
        let connection = guard.as_mut().ok_or_else(not_connected)?;
        let guaranteed_weekly_growth = guaranteed_weekly_growth.unwrap_or_default();
        if multiplier == 1 && !guaranteed_weekly_growth {
            connection.development.stop(None);
            return Ok(connection.development.status.clone());
        }
        if !(1..=100).contains(&multiplier)
            || weekly_limit.is_some_and(|limit| !(1..=200).contains(&limit))
            || ceiling.is_some_and(|limit| !(1..=200).contains(&limit))
        {
            return Err(Failure::new("development.config", "Confira o multiplicador e o limite semanal."));
        }
        if selected_players.is_empty() || selected_players.len() > 2000 {
            return Err(Failure::new("development.scope", "Selecione de 1 a 2.000 jogadores."));
        }
        let weekly = weekly.unwrap_or(true);
        let global = Rules {
            multiplier: Some(multiplier),
            weekly_limit,
            ceiling,
            frequency: Some(if weekly { Frequency::Weekly } else { Frequency::Daily }),
            ..Rules::default()
        };
        let (fields, date, mut samples) = roster(connection, club, team, pid, Some(&selected_players))?;
        let mut plans = BTreeMap::new();
        let mut peaks = BTreeMap::new();
        let mut snapshots = Vec::new();
        let mut reports = Vec::new();
        let mut selected = Vec::new();
        for uid in selected_players {
            let Some(summary) = connection.players.get(uid) else {
                continue;
            };
            let sample = samples.remove(&uid).and_then(Result::ok).flatten();
            let Some(born) = sample.as_ref().map(DevelopmentPlayer::born).or(summary.date_of_birth) else {
                continue;
            };
            let player = PlayerRef { uid, born };
            selected.push(player);
            let (rules, group, conflict) =
                match connection.development.store.document.settings.rules_for(player, &global) {
                    Ok((rules, group)) => (rules, group, None),
                    Err(error) => (Rules { paused: Some(true), ..global.clone() }, None, Some(error)),
                };
            let frequency = rules.frequency.unwrap_or_default();
            let reason = conflict.or_else(|| blocked(connection, uid, sample.as_ref())).map(str::to_owned);
            reports.push(DevelopmentReport {
                uid,
                name: summary.name.clone(),
                ca: sample.as_ref().map(DevelopmentPlayer::ability),
                ca_before: sample.as_ref().map(DevelopmentPlayer::ability),
                pa: sample.as_ref().map(DevelopmentPlayer::raw_potential),
                natural: 0,
                bonus: 0,
                guaranteed_gain: 0,
                attributes: Vec::new(),
                focus: sample.as_ref().map(|p| focused(p.positions(), rules.focus.as_deref())).unwrap_or_default(),
                multiplier: rules.multiplier.unwrap_or(multiplier),
                group: group.clone(),
                week: date.week_start(),
                attempted_at: None,
                status: if reason.is_some() {
                    "Bloqueado"
                } else if rules.paused == Some(true) {
                    "Pausado"
                } else {
                    "Aguardando verificação"
                }
                .into(),
                reason,
                growth_reason: None,
            });
            if let Some(sample) = sample {
                snapshots.push(observation(summary, &sample, &fields, date, "Leitura inicial"));
                peaks.insert(uid, sample);
            }
            plans.insert(uid, Plan { player, rules, group, frequency });
        }
        if plans.is_empty() {
            return Err(Failure::new("development.scope", "Nenhum jogador da seleção pôde ser identificado."));
        }
        let periods = CareerPeriods::open(connection);
        let development = &mut connection.development;
        match periods {
            Ok(periods) => development.career_periods.refresh(periods),
            Err(error) if guaranteed_weekly_growth => return Err(error),
            Err(_) => {}
        }
        development.store.document.selections.insert(scope_key(club, team), selected);
        development.store.observe(snapshots);
        development.store.save()?;
        development.status = DevelopmentStatus {
            active: true,
            multiplier,
            club: Some(club),
            team,
            weekly_limit,
            weekly: weekly || guaranteed_weekly_growth,
            guaranteed_weekly_growth,
            tracked: plans.len(),
            last_date: Some(date),
            report_date: Some(date),
            event: development.status.event,
            report: reports,
            ..DevelopmentStatus::default()
        };
        development.fields = Some(fields);
        development.recent_reads = plans.keys().map(|&uid| (uid, date)).collect();
        development.plans = plans;
        development.peaks = peaks;
        Ok(development.status.clone())
    })
    .await?
}

#[derive(Serialize)]
pub(crate) struct Workspace {
    label: Option<String>,
    session: String,
    revision: u64,
    settings: Settings,
    selections: BTreeMap<String, Vec<PlayerRef>>,
}

fn workspace(connection: &Connection) -> Workspace {
    let store = &connection.development.store;
    Workspace {
        label: store.label.clone(),
        session: connection.history.session.clone(),
        revision: store.document.revision,
        settings: store.document.settings.clone(),
        selections: store.document.selections.clone(),
    }
}

#[tauri::command]
pub(crate) fn development_workspace(
    state: tauri::State<'_, AppState>,
    name: Option<String>,
) -> Result<Workspace, Failure> {
    let mut guard = state.0.lock()?;
    let connection = guard.as_mut().ok_or_else(not_connected)?;
    connection.refuse_after_load()?;
    if let Some(name) = name {
        let store = Store::open(connection, &name)?;
        connection.development.stop(None);
        connection.development.store = store;
        connection.development.status.report.clear();
    }
    Ok(workspace(connection))
}

#[tauri::command]
pub(crate) fn development_validate_settings(settings: Settings) -> Result<Settings, Failure> {
    settings.validate()?;
    Ok(settings)
}

#[tauri::command]
pub(crate) fn development_settings(
    state: tauri::State<'_, AppState>,
    session: String,
    label: Option<String>,
    revision: u64,
    settings: Settings,
) -> Result<Workspace, Failure> {
    settings.validate()?;
    let mut guard = state.0.lock()?;
    let connection = guard.as_mut().ok_or_else(not_connected)?;
    connection.refuse_after_load()?;
    let store = &mut connection.development.store;
    if session != connection.history.session || label != store.label || revision != store.document.revision {
        return Err(Failure::new(
            "development.conflict",
            "A partida ou as configurações mudaram. Atualize a área antes de salvar.",
        ));
    }
    let previous = std::mem::replace(&mut store.document.settings, settings);
    store.document.revision += 1;
    if let Err(error) = store.save() {
        store.document.revision -= 1;
        store.document.settings = previous;
        return Err(error);
    }
    Ok(workspace(connection))
}

#[tauri::command]
pub(crate) async fn club_finance_history(
    app: tauri::AppHandle,
    club: u32,
    capture: Option<bool>,
    profile: Option<String>,
) -> Result<serde_json::Value, Failure> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut guard = state.0.lock()?;
        let c = guard.as_mut().ok_or_else(not_connected)?;
        c.refuse_after_load()?;
        let store = &mut c.development.store;
        if capture == Some(true) {
            if profile.is_none() || profile != store.label {
                return Err(Failure::new(
                    "finance.history",
                    "Associe e confirme o perfil desta carreira antes de registrar.",
                ));
            }
            let club_summary = c.clubs.get(club).ok_or_else(|| not_found(Entity::Club, club))?;
            let date = c.session.game_date().ok_or_else(date_missing)?;
            let finance =
                c.session.club_details(club_summary)?.and_then(|details| details.finances).ok_or_else(|| {
                    Failure::new("finance.history", "Os valores financeiros do clube não foram confirmados.")
                })?;
            if c.session.save_changed() || c.session.game_date() != Some(date) {
                return Err(super::data_changed());
            }
            let old = store.document.finances.clone();
            store.document.finances.retain(|row| (row.club, row.date) != (club, date));
            store.document.finances.push(FinanceSnapshot {
                club,
                date,
                read_at: now_ms(),
                balance: finance.balance,
                transfer_budget: finance.transfer_budget,
                wage_budget: finance.wage_budget,
            });
            const MAX_READINGS: usize = 6000;
            let excess = store.document.finances.len().saturating_sub(MAX_READINGS);
            store.document.finances.drain(..excess);
            if let Err(reason) = store.save() {
                store.document.finances = old;
                return Err(reason);
            }
        }
        let mut rows: Vec<_> = store.document.finances.iter().filter(|row| row.club == club).collect();
        rows.sort_unstable_by_key(|row| (row.date, row.read_at));
        Ok(serde_json::json!({"profile":store.label,"rows":rows}))
    })
    .await?
}

#[tauri::command]
pub(crate) fn development_favorite(
    state: tauri::State<'_, AppState>,
    uid: u32,
    selected: Option<bool>,
) -> Result<bool, Failure> {
    let mut guard = state.0.lock()?;
    let connection = guard.as_mut().ok_or_else(not_connected)?;
    connection.refuse_after_load()?;
    let player = connection
        .players
        .get(uid)
        .and_then(PlayerRef::from_summary)
        .ok_or_else(|| Failure::new("development.player", "A identidade do jogador não pôde ser confirmada."))?;
    let store = &mut connection.development.store;
    let members = store.document.settings.lists.entry(FAVORITES.into()).or_default();
    let before = members.contains(&player);
    if let Some(selected) = selected.filter(|next| *next != before) {
        if selected && members.len() >= 2000 {
            return Err(Failure::new("development.favorites", "A lista de favoritos está cheia."));
        }
        if selected {
            members.insert(player);
        } else {
            members.remove(&player);
        }
        store.document.revision += 1;
        if let Err(error) = store.save() {
            let members = store.document.settings.lists.get_mut(FAVORITES).expect("existe");
            if before {
                members.insert(player);
            } else {
                members.remove(&player);
            }
            store.document.revision -= 1;
            return Err(error);
        }
        return Ok(selected);
    }
    Ok(before)
}

#[tauri::command]
pub(crate) fn development_snapshots(
    state: tauri::State<'_, AppState>,
    uids: BTreeSet<u32>,
) -> Result<Vec<Snapshot>, Failure> {
    let guard = state.0.lock()?;
    let connection = guard.as_ref().ok_or_else(not_connected)?;
    connection.refuse_after_load()?;
    if uids.len() > 50 {
        return Err(Failure::new("development.history", "Escolha até 50 jogadores para consultar o histórico."));
    }
    let data = &connection.development.store.document.snapshots;
    Ok(data
        .iter()
        .filter(|row| {
            uids.contains(&row.player.uid)
                && connection.players.get(row.player.uid).is_some_and(|p| row.player.matches(p))
        })
        .cloned()
        .collect())
}

#[tauri::command]
pub(crate) fn development_export(
    state: tauri::State<'_, AppState>,
    folder: tauri::State<'_, ExportsFolder>,
) -> Result<String, Failure> {
    let guard = state.0.lock()?;
    let connection = guard.as_ref().ok_or_else(not_connected)?;
    connection.refuse_after_load()?;
    let folder = folder
        .0
        .as_deref()
        .ok_or_else(|| Failure::new("export.folder", "A pasta de exportações está indisponível."))?;
    let failure = |error: std::io::Error| Failure::new("export.write", error.to_string());
    std::fs::create_dir_all(folder).map_err(failure)?;
    let name = format!("desenvolvimento-{}.json", now_ms());
    let bytes = serde_json::to_vec_pretty(&serde_json::json!({
        "partida": connection.development.store.label,
        "perfilDoJogo": connection.session.profile.as_ref().map(|profile| &profile.name),
        "processamento": connection.development.status,
        "configuracoes": connection.development.store.document.settings,
        "periodosPorJogador": connection.development.store.document.periods,
        "semanasGarantidasPorCarreira": connection.development.career_periods.players,
    }))
    .map_err(|error| Failure::new("export.write", error.to_string()))?;
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(folder.join(&name))
        .and_then(|mut file| file.write_all(&bytes))
        .map_err(failure)?;
    Ok(name)
}
