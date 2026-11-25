//! Integration of FM27 Trainer 0.2.8 (MIT, Sem Hiel).
//! Original modules and their checked memory operations are retained in vendor/.
#[path = "../../../vendor/fm27-trainer/app/src/agent.rs"]
pub mod agent;
mod automation;
#[path = "../../../vendor/fm27-trainer/app/src/export.rs"]
pub mod export;
#[path = "../../../vendor/fm27-trainer/app/src/i18n.rs"]
pub mod i18n;
#[path = "../../../vendor/fm27-trainer/app/src/labels.rs"]
pub mod labels;
#[path = "../../../vendor/fm27-trainer/app/src/live_training.rs"]
pub mod live_training;
#[path = "../../../vendor/fm27-trainer/app/src/model.rs"]
pub mod model;
#[path = "../../../vendor/fm27-trainer/app/src/planner.rs"]
pub mod planner;
#[path = "../../../vendor/fm27-trainer/app/src/tactics.rs"]
pub mod tactics;
#[cfg(windows)]
#[path = "../../../vendor/fm27-trainer/app/src/vision.rs"]
pub mod vision;

use anyhow::{Context, Result, bail};
use chrono::{Datelike, Duration, NaiveDate, Weekday};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::OnceLock;

fn relationship_clubs() -> &'static Mutex<HashSet<u32>> {
    static CLUBS: OnceLock<Mutex<HashSet<u32>>> = OnceLock::new();
    CLUBS.get_or_init(|| Mutex::new(HashSet::new()))
}
pub fn clear_relationship_focus(club: u32) {
    relationship_clubs().lock().unwrap_or_else(|p| p.into_inner()).remove(&club);
}
fn configure_relationships(req: &Value) -> Result<Value> {
    let club = req["club_uid"].as_u64().context("Clube não informado")? as u32;
    let on = req["on"].as_bool().unwrap_or(false);
    if on {
        let current = agent::request(json!({"cmd":"club"}))?;
        if current["uid"].as_u64() != Some(club.into()) {
            bail!("O treino de entrosamento está disponível para o clube atualmente selecionado no Trainer.");
        }
        relationship_clubs().lock().unwrap_or_else(|p| p.into_inner()).insert(club);
    } else {
        clear_relationship_focus(club);
    }
    Ok(json!({"enabled":on}))
}

fn add_bonding(days: &mut [[u16; 3]], editable: &[bool; 7], rest_week: bool, bonding: u16, rest: u16) -> bool {
    if rest_week || days.iter().flatten().any(|code| *code == bonding) {
        return false;
    }
    for (i, day) in days.iter_mut().enumerate().take(7) {
        if !editable[i] || day.contains(&500) || day.contains(&402) {
            continue;
        }
        for slot in [2, 1, 0] {
            if day[slot] == rest {
                day[slot] = bonding;
                return true;
            }
        }
    }
    false
}

pub fn home() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}
pub fn data_dir() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(home)
        .join("io.github.fmlivre27.personal")
        .join("trainer")
}
pub fn fm_user_dir() -> PathBuf {
    home().join("Documents/Sports Interactive/Football Manager 27")
}
pub fn exports_dir() -> PathBuf {
    home().join("Documents/FM Livre 27/Trainer")
}

fn effectiveness(req: &Value) -> Result<model::Effectiveness> {
    let eff = if let Some(v) = req.get("effectiveness") {
        serde_json::from_value(v.clone()).context("Valores da eficácia tática inválidos")?
    } else {
        std::fs::read_to_string(data_dir().join("effectiveness.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    };
    validate_effectiveness(&eff)?;
    Ok(eff)
}
pub fn validate_effectiveness(eff: &model::Effectiveness) -> Result<()> {
    for (_, value) in &eff.factors {
        if !value.is_finite() || !(0.0..=100.0).contains(value) {
            bail!("A eficácia deve estar entre 0 e 100.");
        }
    }
    for (_, value) in &eff.components {
        if !value.is_finite() || !(0.0..=100.0).contains(value) {
            bail!("A eficácia deve estar entre 0 e 100.");
        }
    }
    Ok(())
}
fn settings(req: &Value) -> Result<planner::PlannerSettings> {
    let s: planner::PlannerSettings =
        req.get("settings").map(|v| serde_json::from_value(v.clone())).transpose()?.unwrap_or_default();
    if !(1..=52).contains(&s.replan_every_weeks)
        || s.set_pieces_every > 52
        || [s.bonding_below, s.gain_per_session, s.decay_per_week]
            .iter()
            .any(|v| !v.is_finite() || !(0.0..=100.0).contains(v))
    {
        bail!("Configuração do plano fora dos limites.");
    }
    Ok(s)
}
fn save_effectiveness(eff: &model::Effectiveness) -> Result<()> {
    std::fs::create_dir_all(data_dir())?;
    std::fs::write(data_dir().join("effectiveness.json"), serde_json::to_vec_pretty(eff)?)?;
    Ok(())
}
fn status() -> Result<Value> {
    let club = agent::request(json!({"cmd":"club"}))?;
    let ping = agent::request(json!({"cmd":"ping"}))?;
    let mut warnings = Vec::new();
    let mut read = |cmd: &str| match agent::request(json!({"cmd":cmd})) {
        Ok(v) => v,
        Err(e) => {
            warnings.push(format!("{cmd}: {e}"));
            Value::Null
        }
    };
    let squad = read("squad");
    let flags = read("human_flags");
    let understanding = named_understanding(read("understanding"));
    let teams = read("teams");
    let context = team_context(&ping, &club, &teams);
    Ok(
        json!({"club":club,"ping":ping,"squad":squad,"flags":flags,"understanding":understanding,"teams":teams,"context":context,"warnings":warnings}),
    )
}

fn named_understanding(mut result: Value) -> Value {
    if let Some(levels) = result["team"].as_array() {
        use model::Factor::*;
        let factors = [PassingStyle, BuildUp, ChanceCreation, InPossessionShape,
            LineOfEngagement, PressingIntensity, PressingTrap, OutOfPossessionShape];
        result["team"] = json!(factors.into_iter().zip(levels.iter()).collect::<std::collections::HashMap<_, _>>());
    }
    result
}

fn selected_team(teams: &Value) -> Option<&Value> {
    teams["teams"].as_array()?.iter().find(|team| team["selected"] == true)
}

fn team_context(ping: &Value, club: &Value, teams: &Value) -> Option<String> {
    Some(format!("{}:{}:{}", ping["pid"].as_u64()?, club["uid"].as_u64()?, selected_team(teams)?["index"].as_u64()?))
}

fn check_context(req: &Value, club: &Value, teams: &Value) -> Result<()> {
    if let Some(expected) = req["context"].as_str() {
        let ping = agent::request(json!({"cmd":"ping"}))?;
        if team_context(&ping, club, teams).as_deref() != Some(expected) {
            bail!("O clube ou o plantel de treino mudou. Atualize os dados e confira o plano novamente.");
        }
    }
    Ok(())
}

fn protected_weeks(req: &Value) -> Result<HashSet<NaiveDate>> {
    let Some(weeks) = req.get("protected_weeks") else { return Ok(HashSet::new()); };
    let weeks = weeks.as_array().context("Lista de semanas protegidas inválida.")?;
    if weeks.len() > 200 { bail!("Há semanas protegidas demais."); }
    weeks.iter().map(|week| {
        let date: NaiveDate = week.as_str().context("Semana protegida inválida.")?.parse()?;
        if date.weekday() != Weekday::Mon { bail!("A semana protegida precisa começar numa segunda-feira."); }
        Ok(date)
    }).collect()
}

fn protected_days(req: &Value) -> Result<HashSet<NaiveDate>> {
    let Some(days) = req.get("protected_days") else { return Ok(HashSet::new()); };
    let days = days.as_array().context("Lista de dias protegidos inválida.")?;
    if days.len() > 1400 { bail!("Há dias protegidos demais."); }
    days.iter().map(|day| Ok(day.as_str().context("Dia protegido inválido.")?.parse()?)).collect()
}

fn editable_code(code: u16) -> bool {
    model::session_by_code(code).is_some_and(|name| !matches!(name, "Match" | "Travel" | "Not Available"))
}

type SessionOverrides = BTreeMap<NaiveDate, [Option<u16>; 3]>;

fn session_overrides(req: &Value) -> Result<SessionOverrides> {
    let overrides: SessionOverrides = match req.get("session_overrides") {
        Some(value) => serde_json::from_value(value.clone()).context("Edição de sessões inválida.")?,
        None => BTreeMap::new(),
    };
    if overrides.len() > 1400 || overrides.values().flatten().flatten().any(|&code| !editable_code(code)) {
        bail!("A edição contém uma sessão que o calendário não permite alterar.");
    }
    Ok(overrides)
}

fn preserve_days(week: &mut live_training::WeekPreview, protected: &HashSet<NaiveDate>) -> [bool; 7] {
    std::array::from_fn(|day| {
        let locked = protected.contains(&(week.start + Duration::days(day as i64)));
        week.editable[day] &= week.current[day].iter().all(|&code| editable_code(code));
        if locked || !week.editable[day] { week.planned[day] = week.current[day]; }
        week.editable[day] && !locked
    })
}

fn edit_slots(week: &mut live_training::WeekPreview, overrides: &SessionOverrides) {
    for (i, slots) in week.planned.iter_mut().enumerate() {
        if !week.editable[i] { continue; }
        let date = week.start + Duration::days(i as i64);
        if let Some(edits) = overrides.get(&date) {
            for (slot, new) in slots.iter_mut().zip(edits) {
                if let Some(code) = new { *slot = *code; }
            }
        }
    }
}

fn training(req: &Value, write: bool, bonding_only: bool) -> Result<Value> {
    let eff = effectiveness(req)?;
    let settings = settings(req)?;
    let mut protected = protected_weeks(req)?;
    let mut days = protected_days(req)?;
    let overrides = session_overrides(req)?;
    let club = agent::request(json!({"cmd":"club"}))?;
    let teams = agent::request(json!({"cmd":"teams"}))?;
    check_context(req, &club, &teams)?;
    let manager_team = selected_team(&teams).is_some_and(|team| team["own"] == true);
    if req.get("club_uid").and_then(Value::as_u64).is_some_and(|uid| Some(uid) != club["uid"].as_u64()) {
        bail!("O calendário pertence ao clube selecionado na aba Treino.");
    }
    if bonding_only && !manager_team {
        bail!("Selecione o plantel do treinador na aba Treino para programar o convívio do clube.");
    }
    if bonding_only {
        let ping = agent::request(json!({"cmd":"ping"}))?;
        if let Some(context) = team_context(&ping, &club, &teams) {
            let (weeks, dates) = automation::protections(&context);
            protected.extend(weeks);
            days.extend(dates);
        }
    }
    let focused = bonding_only || (manager_team && relationship_clubs()
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .contains(&(club["uid"].as_u64().unwrap_or(0) as u32)));
    let mut out = live_training::run(&eff, &settings, false, &protected)?;
    for week in &mut out.weeks {
        if protected.contains(&week.start) { continue; }
        if bonding_only {
            week.planned = week.current.clone();
            week.focus = "Treino coletivo de entrosamento".into();
        }
        let automated_editable = preserve_days(week, &days);
        if focused {
            let bonding = model::session_code("Team Bonding").context("Sessão de convívio não identificada")?;
            let rest = model::session_code("Rest").context("Sessão de descanso não identificada")?;
            if add_bonding(&mut week.planned, &automated_editable, week.rest, bonding, rest) && !bonding_only {
                week.focus.push_str(" · Convívio da equipe");
            }
        }
        edit_slots(week, &overrides);
        if write && week.planned != week.current {
            let result = agent::request(
                json!({"cmd":"set_week","start":{"year":week.start.year(),"doy":week.start.ordinal()},"days":week.planned,"expected":week.current}),
            )?;
            week.written = result["days"].as_u64().unwrap_or(0) as usize;
            out.written_days += week.written;
            let expected = week.current.iter().zip(&week.planned).filter(|(before, after)| before != after).count();
            if week.written == expected { week.current.clone_from(&week.planned); }
        }
    }
    let weeks: Vec<Value> = out.weeks.iter().map(|week| {
        let days: Vec<Value> = week.planned.iter().enumerate().map(|(day, slots)| json!({
            "date": week.start + Duration::days(day as i64),
            "editable": week.editable[day],
            "protected": days.contains(&(week.start + Duration::days(day as i64))),
            "current_codes": week.current[day],
            "planned_codes": slots,
            "current": week.current.get(day).map(|c| c.iter().map(|code| live_training::long(*code)).collect::<Vec<_>>()),
            "planned": slots.iter().map(|code| live_training::long(*code)).collect::<Vec<_>>()
        })).collect();
        json!({"start":week.start,"name":week.name,"rest":week.rest,"protected":protected.contains(&week.start),"matches":week.matches,"focus":week.focus,"written":week.written,"days":days})
    }).collect();
    let sessions: Vec<_> = model::SESSIONS.iter()
        .filter_map(|session| Some((model::session_code(session.name)?, session.name)))
        .filter(|(code, _)| editable_code(*code))
        .collect();
    Ok(json!({"today":out.today,"weeks":weeks,"written_days":out.written_days,"sessions":sessions}))
}

fn tactics_report() -> Result<Value> {
    let raw = agent::request(json!({"cmd":"tactics"}))?;
    let data: tactics::Data = serde_json::from_value(raw)?;
    let reports: Vec<Value> = data.tactics.iter().map(|tactic| {
        let places = tactics::places(tactic);
        let eligible = data.players.iter().filter(|p| !p.injured && !p.banned).count();
        let assignment = if eligible >= places.len() { tactics::best_eleven(&places, &data.players) } else { vec![] };
        let starters: HashSet<u32> = places.iter().filter_map(|place| place.uid).collect();
        let rows: Vec<Value> = places.iter().enumerate().map(|(i, place)| {
            let current = data.players.iter().find(|p| Some(p.uid) == place.uid);
            let best = assignment.get(i).and_then(|j| data.players.get(*j));
            let suggested_role = current.and_then(|p| tactics::better_role(p, place)).map(|(role, score, old)| json!({"role":role.name,"score":score,"old":old}));
            let top = data.players.iter()
                .filter(|p| !p.injured && !p.banned && !starters.contains(&p.uid))
                .max_by(|a,b| tactics::fit(a,place).total_cmp(&tactics::fit(b,place)))
                .filter(|p| current.is_none_or(|starter| tactics::fit(p,place) >= tactics::fit(starter,place) + 2.0));
            json!({"slot":i+1,"line":format!("{:?}",place.line),"side":format!("{:?}",place.side),
                "in_possession":tactics::ip_label(place.ip).1,"out_of_possession":tactics::oop_label(place.oop).1,
                "current":current.map(|p|json!({"uid":p.uid,"name":p.name,"fit":tactics::fit(p,place)})),
                "best":best.map(|p|json!({"uid":p.uid,"name":p.name,"fit":tactics::fit(p,place)})),
                "alternative":top.map(|p|json!({"uid":p.uid,"name":p.name,"fit":tactics::fit(p,place)})),"suggested_role":suggested_role})
        }).collect();
        json!({"index":tactic.index,"style":tactic.style,"rows":rows,"enough_players":eligible>=places.len()})
    }).collect();
    Ok(json!({"current":data.current,"tactics":reports}))
}

fn export_plan(req: &Value) -> Result<Value> {
    let eff = effectiveness(req)?;
    let settings = settings(req)?;
    let start = req
        .get("start")
        .and_then(Value::as_str)
        .and_then(|s| s.parse::<NaiveDate>().ok())
        .unwrap_or_else(|| chrono::Local::now().date_naive());
    let weeks = req.get("weeks").and_then(Value::as_u64).unwrap_or(52).clamp(1, 52) as u32;
    let weekday = |value: u64| {
        [Weekday::Mon, Weekday::Tue, Weekday::Wed, Weekday::Thu, Weekday::Fri, Weekday::Sat, Weekday::Sun]
            [value.min(6) as usize]
    };
    let opts = planner::CalendarOptions {
        start,
        weeks,
        league_day: weekday(req.get("league_day").and_then(Value::as_u64).unwrap_or(5)),
        europe: req.get("europe_day").and_then(Value::as_u64).map(weekday),
        cup: req.get("cup").and_then(Value::as_bool).unwrap_or(false),
    };
    let calendar = planner::default_calendar(&opts);
    let plans = planner::plan_year(&calendar, &eff, &settings);
    let dir = exports_dir().join(chrono::Local::now().format("%Y-%m-%d_%H-%M-%S-%3f").to_string());
    let html = export::write_all(&dir, "plano", "FM Livre 27 - plano de treinos", &eff, &plans)?;
    Ok(json!({"html":html,"folder":dir,"weeks":plans.len()}))
}

/// Public operations only: no arbitrary memory commands are exposed to the UI.
pub fn handle(req: Value) -> Result<Value> {
    static LOCK: Mutex<()> = Mutex::new(());
    let _guard = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    match req.get("cmd").and_then(Value::as_str).unwrap_or("") {
        "status" => status(),
        "automation_config" => automation::configure(&req),
        "automation_state" => Ok(automation::state()),
        "effectiveness" => Ok(json!(effectiveness(&req)?)),
        "save_effectiveness" => {
            let eff = effectiveness(&req)?;
            save_effectiveness(&eff)?;
            Ok(json!(eff))
        }
        "training_preview" => training(&req, false, false),
        "training_apply" => training(&req, true, false),
        "bonding_preview" => training(&req, false, true),
        "bonding_apply" => training(&req, true, true),
        "relationship_focus" => configure_relationships(&req),
        "tactics_report" => tactics_report(),
        "export_plan" => export_plan(&req),
        "backup" => Ok(json!({"path":agent::backup_saves()?})),
        "read_screen" | "read_image" => {
            #[cfg(windows)]
            {
                let from_image = req["cmd"] == "read_image";
                let analysis = if from_image {
                    use base64::Engine;
                    let encoded = req["png"].as_str().context("Selecione uma captura PNG.")?;
                    if encoded.len() > 16 * 1024 * 1024 { bail!("A captura PNG deve ter até 12 MB."); }
                    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded)?;
                    let mut reader = image::ImageReader::with_format(std::io::Cursor::new(bytes), image::ImageFormat::Png);
                    let mut limits = image::Limits::default();
                    limits.max_image_width = Some(7680);
                    limits.max_image_height = Some(4320);
                    reader.limits(limits);
                    let image = reader.decode().context("Não foi possível abrir esta captura PNG.")?.to_rgba8();
                    vision::analyze_image(&image)?.0
                } else {
                    vision::analyze_screen()?.0
                };
                if analysis.gauges.len() != 17 {
                    bail!(
                        "Leitura incompleta: {} fator(es) não identificados. Abra o Breakdown inteiro e tente novamente; os valores anteriores foram mantidos.",
                        analysis.missing.len()
                    );
                }
                let doubts: Vec<_> = analysis.gauges.iter().filter(|g| g.doubt).map(|g| g.factor).collect();
                let missing_bars = 4usize.saturating_sub(analysis.components.len());
                if req["automatic"] == true && (missing_bars > 0 || !doubts.is_empty()) {
                    bail!("A leitura precisa de revisão: {missing_bars} barra(s) ausente(s) e {} indicador(es) incerto(s)", doubts.len());
                }
                let mut eff = analysis.to_effectiveness(if from_image { "Leitura de uma captura PNG" } else { "Leitura da tela do Football Manager" });
                if !from_image {
                    eff.game_date = agent::request(json!({"cmd":"game_date"}))
                        .ok()
                        .and_then(|d| NaiveDate::from_yo_opt(d["year"].as_i64()? as i32, d["doy"].as_u64()? as u32));
                }
                if missing_bars == 0 && doubts.is_empty() { save_effectiveness(&eff)?; }
                Ok(json!({"effectiveness":eff,"doubts":doubts,"missing_bars":missing_bars}))
            }
            #[cfg(not(windows))]
            {
                bail!("Leitura da tela disponível nesta edição para Windows.")
            }
        }
        "understanding" => agent::request(req).map(named_understanding),
        "max_understanding" | "heal" | "lift_bans" | "inspire" | "set_human_flags" => {
            if req["context"].is_string() {
                check_context(&req, &agent::request(json!({"cmd":"club"}))?, &agent::request(json!({"cmd":"teams"}))?)?;
            }
            agent::request(req)
        }
        "ping" | "club" | "squad" | "teams" | "select"
        | "game_date" | "undo" | "human_flags"
        | "allow_untested" => agent::request(req),
        _ => bail!("Operação do Trainer não disponível."),
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    #[test]
    fn understanding_labels_follow_the_trainers_schema() {
        let result = named_understanding(json!({"team":[1000,2000,3000,4000,5000,6000,7000,8000]}));
        assert_eq!(result["team"]["PassingStyle"], 1000);
        assert_eq!(result["team"]["LineOfEngagement"], 5000);
        assert_eq!(result["team"]["PressingTrap"], 7000);
    }
    #[test]
    fn protected_weeks_accept_only_calendar_mondays() {
        let weeks = protected_weeks(&json!({"protected_weeks":["2026-11-23","2026-11-23"]})).unwrap();
        assert_eq!(weeks.len(), 1);
        assert!(protected_weeks(&json!({"protected_weeks":["2026-11-22"]})).is_err());
    }
    #[test]
    fn invalid_effectiveness_is_rejected_before_any_live_call() {
        let mut eff = model::Effectiveness::default();
        eff.factors[0].1 = 101.0;
        assert!(validate_effectiveness(&eff).is_err());
    }
    #[test]
    fn generic_memory_requests_are_not_exposed() {
        assert!(handle(json!({"cmd":"write","addr":0,"hex":"00"})).is_err());
    }
    #[test]
    fn bonding_changes_only_one_future_rest_slot_and_is_idempotent() {
        let mut days = vec![[1, 1, 1]; 7];
        let editable = [false, true, true, true, true, true, true];
        let before = days.clone();
        assert!(add_bonding(&mut days, &editable, false, 17, 1));
        assert_eq!(days[0], before[0]);
        assert_eq!(days[1], [1, 1, 17]);
        assert_eq!(days.iter().flatten().filter(|c| **c == 17).count(), 1);
        assert!(!add_bonding(&mut days, &editable, false, 17, 1));
    }
    #[test]
    fn bonding_preserves_matches_travel_rest_weeks_and_existing_sessions() {
        let mut days = vec![[500, 1, 1], [402, 1, 1], [2, 3, 4], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]];
        let editable = [true, true, true, false, false, false, false];
        let original = days.clone();
        assert!(!add_bonding(&mut days, &editable, false, 17, 1));
        assert_eq!(days, original);
        assert!(!add_bonding(&mut days, &[true; 7], true, 17, 1));
        assert_eq!(days, original);
    }
}
    #[test]
    fn calendar_preserves_locked_days_but_accepts_an_explicit_slot_edit() {
        let start = NaiveDate::from_ymd_opt(2026, 11, 23).unwrap();
        let mut week = live_training::WeekPreview {
            start, name: String::new(), focus: String::new(), rest: false, matches: 1, written: 0,
            current: vec![[300; 3]; 7], planned: vec![[0, 200, 300]; 7], editable: [true; 7],
        };
        week.current[2] = [300, 500, 300];
        week.current[3] = [300, 399, 300];
        let protected = HashSet::from([start]);
        let eligible = preserve_days(&mut week, &protected);
        assert_eq!(week.planned[0], [300, 300, 300]);
        assert!(!eligible[0]);
        assert_eq!(week.planned[1], [0, 200, 300]);
        let mut edits = BTreeMap::new();
        for day in [0, 2, 3] {
            edits.insert(start + Duration::days(day), [None, Some(106), None]);
        }
        edit_slots(&mut week, &edits);
        assert_eq!(week.planned[0], [300, 106, 300]);
        assert_eq!(week.planned[2], [300, 500, 300]);
        assert_eq!(week.planned[3], [300, 399, 300]);
    }

    #[test]
    fn calendar_rejects_inserting_a_match_or_unknown_code() {
        for code in [402, 500, 599] {
            assert!(session_overrides(&json!({"session_overrides":{"2026-11-23":[null,code,null]}})).is_err());
        }
        assert!(session_overrides(&json!({"session_overrides":{"2026-11-23":[null,0,300]}})).is_ok());
    }
