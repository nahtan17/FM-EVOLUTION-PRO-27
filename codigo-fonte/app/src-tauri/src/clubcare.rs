//! Team maintenance lives in Rust, so minimising the window does not suspend it.
use super::{AppState, Failure, FmDate, TeamAction};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CareStatus {
    enabled: bool,
    relationships: bool,
    event: u64,
    changed: bool,
    error: String,
    activity: String,
    last_check: u64,
}

#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub(super) struct FitnessTargets {
    pub(super) condition: i64,
    pub(super) sharpness: i64,
}

impl Default for FitnessTargets {
    fn default() -> Self {
        Self { condition: 10_000, sharpness: 10_000 }
    }
}

impl FitnessTargets {
    fn validate(self) -> Result<(), Failure> {
        let max = i64::from(fmlibre_core::RAW_FITNESS_MAX);
        if !(0..=max).contains(&self.condition) || !(3_500..=max).contains(&self.sharpness) {
            return Err(Failure::new(
                "club.care",
                format!("Informe a condição entre 0 e {max} e o ritmo entre 3500 e {max}."),
            ));
        }
        Ok(())
    }
}

#[derive(Serialize)]
pub(crate) struct CareView {
    #[serde(flatten)]
    status: CareStatus,
    fitness: FitnessTargets,
}

#[derive(Clone)]
struct Entry {
    status: CareStatus,
    context: String,
    date: Option<FmDate>,
}

type Key = (u32, usize, bool);
#[derive(Default)]
struct Maintenance {
    entries: BTreeMap<Key, Entry>,
    fitness: FitnessTargets,
}

fn registry() -> &'static (Mutex<Maintenance>, Condvar) {
    static STATE: OnceLock<(Mutex<Maintenance>, Condvar)> = OnceLock::new();
    STATE.get_or_init(|| (Mutex::new(Maintenance::default()), Condvar::new()))
}
// An OFF response waits for any in-flight pass to finish before it returns.
fn operation() -> &'static Mutex<()> {
    static OP: Mutex<()> = Mutex::new(());
    &OP
}

fn context(
    app: &tauri::AppHandle,
    club: u32,
    team: usize,
    national: bool,
) -> Result<(String, Option<FmDate>), Failure> {
    let state = app.state::<AppState>();
    let guard = state.0.lock()?;
    let c = guard.as_ref().ok_or_else(super::not_connected)?;
    if c.session.save_changed() {
        return Err(Failure::new(
            "club.care",
            "O jogo carregou outro save. Leia os dados novamente e reative a manutenção.",
        ));
    }
    if !c.info(0).editable {
        return Err(Failure::new("club.care", "A conexão está somente para leitura. A manutenção foi pausada."));
    }
    if national {
        super::national_teams_of(c)?.get(club).ok_or_else(|| super::not_found(super::Entity::NationalTeam, club))?;
    } else {
        let summary = c.clubs.get(club).ok_or_else(|| super::not_found(super::Entity::Club, club))?;
        if !c.session.club_teams(summary, &c.players)?.iter().any(|t| t.index == team) {
            return Err(Failure::new("club.care", "O plantel selecionado não está disponível."));
        }
    }
    Ok((format!("{}|{}", c.history.session, c.save.as_deref().unwrap_or("")), c.session.game_date()))
}

fn start(app: tauri::AppHandle) {
    static WORKER: OnceLock<()> = OnceLock::new();
    WORKER.get_or_init(|| {
        std::thread::Builder::new()
            .name("club-maintenance".into())
            .spawn(move || {
                loop {
                    {
                        let _op = operation().lock().unwrap_or_else(|p| p.into_inner());
                        let (entries, fitness) = {
                            let maintenance = registry().0.lock().unwrap_or_else(|p| p.into_inner());
                            (maintenance.entries.clone(), maintenance.fitness)
                        };
                        for (key, entry) in
                            entries.into_iter().filter(|(_, e)| e.status.enabled || e.status.relationships)
                        {
                            maintain(&app, key, entry, fitness);
                        }
                    }
                    let (lock, wake) = registry();
                    let guard = lock.lock().unwrap_or_else(|p| p.into_inner());
                    drop(wake.wait_timeout(guard, Duration::from_secs(3)).unwrap_or_else(|p| p.into_inner()));
                }
            })
            .expect("club maintenance worker");
    });
}

fn maintain(app: &tauri::AppHandle, key: Key, mut entry: Entry, fitness: FitnessTargets) {
    let mut changed = false;
    let result = (|| -> Result<(), String> {
        let (identity, date) = context(app, key.0, key.1, key.2).map_err(|e| e.message)?;
        if identity != entry.context || date.zip(entry.date).is_some_and(|(now, was)| now < was) {
            return Err("A conexão ou a data do save mudou. Reative a manutenção após conferir o clube.".into());
        }
        entry.date = date.or(entry.date);
        if entry.status.enabled {
            let refresh = TeamAction::MaintainFitness(fitness);
            let actions: &[TeamAction] = if key.2 {
                &[TeamAction::Inspire, refresh, TeamAction::Heal]
            } else {
                &[
                    TeamAction::Inspire,
                    refresh,
                    TeamAction::Heal,
                    TeamAction::MaxCohesion,
                    TeamAction::MaxTactics,
                ]
            };
            for &action in actions {
                let (now, _) = context(app, key.0, key.1, key.2).map_err(|e| e.message)?;
                if now != entry.context {
                    return Err("A conexão mudou; manutenção interrompida.".into());
                }
                let state = app.state::<AppState>();
                let report = if key.2 {
                    super::national_team_action(state, key.0, action)
                } else {
                    super::team_action(state, key.0, key.1, action, None, None)
                }
                .map_err(|e| e.message)?;
                changed |= report.applied > 0;
                if let Some(failed) =
                    report.failed.iter().find(|row| !matches!(row.error.code, "club.tactics" | "club.cohesion"))
                {
                    return Err(format!("{}: {}", failed.name, failed.error.message));
                }
            }
        }
        if entry.status.relationships {
            // This is a real calendar session, not a write to unvalidated partnership pointers.
            let plan =
                fmlibre_trainer::handle(json!({"cmd":"bonding_apply","club_uid":key.0})).map_err(|e| e.to_string())?;
            changed |= plan["written_days"].as_u64().unwrap_or(0) > 0;
        }
        Ok(())
    })();
    entry.status.last_check = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    entry.status.changed = changed;
    match result {
        Ok(()) => {
            entry.status.error.clear();
            entry.status.activity =
                if changed { "Melhorias aplicadas ao elenco." } else { "Verificado; valores mantidos." }.into();
            if changed {
                entry.status.event += 1;
            }
        }
        Err(error) => {
            entry.status.enabled = false;
            entry.status.relationships = false;
            entry.status.error = error;
            entry.status.activity = "Manutenção pausada.".into();
            entry.status.event += 1;
            if !key.2 {
                fmlibre_trainer::clear_relationship_focus(key.0);
            }
        }
    }
    registry().0.lock().unwrap_or_else(|p| p.into_inner()).entries.insert(key, entry);
}

#[tauri::command]
pub(crate) fn club_care_status(club: u32, team: usize, national: Option<bool>) -> CareView {
    let maintenance = registry().0.lock().unwrap_or_else(|p| p.into_inner());
    let status = maintenance.entries.get(&(club, team, national.unwrap_or(false)))
        .map(|e| e.status.clone()).unwrap_or_default();
    CareView { status, fitness: maintenance.fitness }
}

#[tauri::command]
pub(crate) async fn club_care_set(
    app: tauri::AppHandle,
    club: u32,
    team: usize,
    enabled: Option<bool>,
    relationships: Option<bool>,
    national: Option<bool>,
    fitness: Option<FitnessTargets>,
) -> Result<CareView, Failure> {
    tauri::async_runtime::spawn_blocking(move || {
        let national = national.unwrap_or(false);
        if national && (team != 0 || relationships.is_some()) {
            return Err(Failure::new("club.care", "A manutenção da seleção só se aplica à equipe principal."));
        }
        if let Some(fitness) = fitness {
            fitness.validate()?;
        }
        let _op=operation().lock().map_err(Failure::from)?;
        let mut entry=registry().0.lock()?.entries.get(&(club,team,national)).cloned().unwrap_or(Entry{status:CareStatus::default(),context:String::new(),date:None});
        let on=enabled.unwrap_or(entry.status.enabled);
        let bonding=relationships.unwrap_or(entry.status.relationships);
        if enabled==Some(true) || relationships==Some(true) {
            let (identity,date)=context(&app,club,team,national)?;
            entry.context=identity;entry.date=date;
            if enabled==Some(true) && !national {
                let state=app.state::<AppState>();
                let guard=state.0.lock()?;
                let c=guard.as_ref().ok_or_else(super::not_connected)?;
                let summary=c.clubs.get(club).ok_or_else(||super::not_found(super::Entity::Club,club))?;
                if c.session.team_familiarity_areas(summary,team,&c.players)?.is_none_or(|p|p.is_empty()) {
                    return Err(Failure::new("club.care","O editor não encontrou os registros da tática deste plantel. Selecione um time com tática de treinador humano e leia os dados novamente."));
                }
            }
            if relationships==Some(true) {
                if team!=0 { return Err(Failure::new("club.care","O treino coletivo usa o calendário do time principal.")); }
                fmlibre_trainer::handle(json!({"cmd":"relationship_focus","club_uid":club,"on":true}))
                    .map_err(|e|Failure::new("club.care",e.to_string()))?;
            }
        }
        entry.status.enabled=on;entry.status.relationships=bonding;entry.status.error.clear();
        entry.status.activity=if on||bonding {"Manutenção ativada enquanto o editor estiver aberto."} else {"Manutenção desativada."}.into();
        if !bonding && !national {fmlibre_trainer::clear_relationship_focus(club);}
        let status=entry.status.clone();
        let fitness = {
            let mut maintenance = registry().0.lock()?;
            if let Some(fitness) = fitness {
                maintenance.fitness = fitness;
            }
            maintenance.entries.insert((club,team,national),entry);
            maintenance.fitness
        };
        start(app);
        registry().1.notify_all();
        Ok(CareView { status, fitness })
    }).await?
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CohesionSample {
    date: FmDate,
    week: FmDate,
    cohesion: Option<f64>,
    measured: usize,
    players: usize,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CohesionWatch {
    enabled: bool,
    samples: Vec<CohesionSample>,
    error: Option<String>,
    #[serde(skip)]
    attempt: Option<Instant>,
}

impl CohesionWatch {
    fn due(&self, date: FmDate) -> bool {
        self.enabled
            && self.samples.last().is_none_or(|sample| date.week_start() > sample.week)
            && self.attempt.is_none_or(|attempt| attempt.elapsed() >= Duration::from_secs(12))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CohesionMember {
    uid: u32,
    name: String,
    cohesion: Option<i8>,
    reason: Option<String>,
    tactical_record: bool,
}

fn cohesion_members(
    c: &super::Connection,
    club: &fmlibre_core::ClubSummary,
    team: &fmlibre_core::ClubTeam,
    areas: &[fmlibre_core::FamiliarityAreas],
) -> Vec<CohesionMember> {
    team.players
        .iter()
        .filter(|m| m.plays_here && m.loan != Some(fmlibre_core::Loan::In))
        .filter_map(|member| {
            let player = c.players.get(member.uid)?;
            let (cohesion, reason) = match c.session.cohesion(player, club) {
                Ok(value) => (value.filter(|rating| (0..=100).contains(rating)), None),
                Err(error) => (None, Some(error.to_string())),
            };
            Some(CohesionMember {
                uid: member.uid,
                name: player.name.clone(),
                cohesion,
                reason,
                tactical_record: areas.iter().any(|area| area.player == member.uid),
            })
        })
        .collect()
}

fn cohesion_mean(members: &[CohesionMember]) -> (Option<f64>, usize) {
    let (sum, count) = members
        .iter()
        .filter_map(|member| member.cohesion)
        .fold((0u64, 0), |(sum, count), value| (sum + value as u64, count + 1));
    ((count > 0).then(|| sum as f64 / count as f64), count)
}

pub(super) fn hold_cohesion(c: &mut super::Connection) {
    if !c.cohesion_watches.values().any(|watch| watch.enabled) {
        return;
    }
    let failure = if c.session.save_changed() {
        Some("O save mudou. Recarregue os dados antes de ativar o monitoramento.")
    } else {
        None
    };
    if let Some(message) = failure {
        for watch in c.cohesion_watches.values_mut().filter(|watch| watch.enabled) {
            watch.enabled = false;
            watch.error = Some(message.into());
        }
        return;
    }
    let Some(date) = c.session.game_date() else {
        return;
    };
    for watch in c.cohesion_watches.values_mut() {
        if watch.enabled && watch.samples.last().is_some_and(|sample| date < sample.date) {
            watch.enabled = false;
            watch.error = Some("A data da carreira voltou. Confira a conexão antes de retomar.".into());
        }
    }
    let due: Vec<_> = c.cohesion_watches.iter().filter_map(|(&key, watch)| watch.due(date).then_some(key)).collect();
    for (club, team) in due {
        let result =
            (|| -> Result<CohesionSample, Failure> {
                let club = c.clubs.get(club).ok_or_else(|| super::not_found(super::Entity::Club, club))?;
                let team =
                    c.session.club_teams(club, &c.players)?.into_iter().find(|row| row.index == team).ok_or_else(
                        || Failure::new("club.cohesion", "O plantel monitorado deixou de estar disponível."),
                    )?;
                let members = cohesion_members(c, club, &team, &[]);
                let (cohesion, measured) = cohesion_mean(&members);
                c.refuse_after_load()?;
                if c.session.game_date() != Some(date) {
                    return Err(super::data_changed());
                }
                Ok(CohesionSample { date, week: date.week_start(), cohesion, measured, players: members.len() })
            })();
        let watch = c.cohesion_watches.get_mut(&(club, team)).expect("watch still active");
        watch.attempt = Some(Instant::now());
        match result {
            Ok(sample) => {
                watch.error = None;
                if watch.samples.len() >= 60 {
                    watch.samples.remove(0);
                }
                watch.samples.push(sample);
            }
            Err(error) => watch.error = Some(error.message),
        }
    }
}

#[tauri::command]
pub(crate) fn club_cohesion_watch(
    state: tauri::State<'_, AppState>,
    club: u32,
    team: usize,
    enabled: Option<bool>,
) -> Result<CohesionWatch, Failure> {
    let mut guard = state.0.lock()?;
    let c = guard.as_mut().ok_or_else(super::not_connected)?;
    let key = (club, team);
    if let Some(enabled) = enabled {
        if enabled {
            c.refuse_after_load()?;
            let Some(date) = c.session.game_date() else {
                return Err(Failure::new("club.cohesion", "O FM ainda não fornece a data da carreira."));
            };
            if c.session.layout.cohesion.is_none() || !c.session.health().passed(fmlibre_core::Check::Cohesion) {
                return Err(Failure::new("club.cohesion", "A leitura de coesão não está disponível nesta conexão."));
            }
            let summary = c.clubs.get(club).ok_or_else(|| super::not_found(super::Entity::Club, club))?;
            if !c.session.club_teams(summary, &c.players)?.iter().any(|row| row.index == team) {
                return Err(Failure::new("club.cohesion", "O plantel selecionado não está disponível."));
            }
            let watch = c.cohesion_watches.entry(key).or_default();
            if watch.samples.last().is_some_and(|sample| date < sample.date) {
                watch.samples.clear();
            }
            watch.enabled = true;
            watch.error = None;
            watch.attempt = None;
            hold_cohesion(c);
        } else if let Some(watch) = c.cohesion_watches.get_mut(&key) {
            watch.enabled = false;
            watch.error = None;
        }
    }
    Ok(c.cohesion_watches.get(&key).cloned().unwrap_or_default())
}

#[tauri::command]
pub(crate) fn club_tactical_summary(state: tauri::State<'_, AppState>, club: u32) -> Result<Value, Failure> {
    let guard = state.0.lock()?;
    let c = guard.as_ref().ok_or_else(super::not_connected)?;
    let summary = c.clubs.get(club).ok_or_else(|| super::not_found(super::Entity::Club, club))?;
    c.refuse_after_load()?;
    let mut teams = Vec::new();
    let date = c.session.game_date();
    for team in c.session.club_teams(summary, &c.players)? {
        let (areas, tactics_error) = match c.session.team_familiarity_areas(summary, team.index, &c.players) {
            Ok(areas) => (areas.unwrap_or_default(), None),
            Err(error) => (Vec::new(), Some(error.to_string())),
        };
        let mean = |values: Vec<u8>| -> Option<f64> {
            (!values.is_empty()).then(|| values.iter().map(|v| *v as f64).sum::<f64>() / values.len() as f64)
        };
        let record: Vec<Option<f64>> =
            (0..8).map(|i| mean(areas.iter().filter_map(|a| a.record[i]).collect())).collect();
        let training: Vec<Option<f64>> = (0..8)
            .map(|i| mean(areas.iter().filter_map(|a| a.training.as_ref().and_then(|t| t[i])).collect()))
            .collect();
        let members = cohesion_members(c, summary, &team, &areas);
        let (cohesion, _) = cohesion_mean(&members);
        teams.push(json!({"index":team.index,"kind":team.kind,"ageLimit":team.age_limit,
            "record":record,"training":training,"cohesion":cohesion,"knownPlayers":areas.len(),
            "players":members.len(),"members":members,"tacticsError":tactics_error}));
    }
    c.refuse_after_load()?;
    if c.session.game_date() != date {
        return Err(super::data_changed());
    }
    Ok(json!({"teams":teams,"date":date,"session":c.history.session}))
}
