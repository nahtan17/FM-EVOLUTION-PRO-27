use std::sync::atomic::{AtomicU32, Ordering};

use fmlibre_core::{Change, Entity, MoveError, NationalTacticalEvidence, NationalTacticsPlan};
use serde::Serialize;
use tauri::State;

use super::{AppState, Failure, LoggedChange, MassReport, Undo, national_teams_of, not_connected, not_found};

const FIELD: &str = "national_tactics.exposure";
static NEXT_PREVIEW: AtomicU32 = AtomicU32::new(1);

pub(super) struct Pending {
    id: u32,
    uid: u32,
    kind: u8,
    plan: NationalTacticsPlan,
}

#[derive(Serialize)]
pub(crate) struct Preview {
    id: Option<u32>,
    #[serde(flatten)]
    evidence: NationalTacticalEvidence,
    locked: Option<Failure>,
}

#[tauri::command]
pub(crate) fn preview_national_tactics(
    state: State<'_, AppState>,
    uid: u32,
    kind: u8,
    targets: Option<[Option<u8>; 6]>,
) -> Result<Preview, Failure> {
    let mut guard = state.0.lock()?;
    let connection = guard.as_mut().ok_or_else(not_connected)?;
    connection.refuse_after_load()?;
    let team = national_teams_of(connection)?.get(uid).ok_or_else(|| not_found(Entity::NationalTeam, uid))?;
    let session = &connection.session;
    let plan = session.plan_national_tactics(team, kind, &connection.players, targets.unwrap_or([Some(100); 6]))?;
    connection.refuse_after_load()?;
    let locked = session.tactics_lock().or_else(|| session.structure_lock()).map(|lock| MoveError::Locked(lock).into());
    let id = (locked.is_none() && plan.writes()).then(|| NEXT_PREVIEW.fetch_add(1, Ordering::Relaxed));
    let evidence = plan.evidence.clone();
    connection.national_tactics = id.map(|id| Pending { id, uid, kind, plan });
    Ok(Preview { id, evidence, locked })
}

#[derive(Serialize)]
pub(crate) struct Applied {
    #[serde(flatten)]
    report: MassReport,
    session: String,
}

#[tauri::command]
pub(crate) fn apply_national_tactics(
    state: State<'_, AppState>,
    uid: u32,
    kind: u8,
    id: u32,
    selected: Vec<u32>,
) -> Result<Applied, Failure> {
    let mut guard = state.0.lock()?;
    let connection = guard.as_mut().ok_or_else(not_connected)?;
    connection.refuse_after_load()?;
    if selected.is_empty() {
        return Err(Failure::new("national.tactics", "Selecione pelo menos um convocado com valores a alterar."));
    }
    if !connection.national_tactics.as_ref().is_some_and(|p| (p.id, p.uid, p.kind) == (id, uid, kind)) {
        return Err(Failure::new("national.tactics", "A prévia ficou desatualizada. Gere uma nova prévia."));
    }
    let pending = connection.national_tactics.take().expect("matched national tactics preview");
    let team = national_teams_of(connection)?.get(uid).ok_or_else(|| not_found(Entity::NationalTeam, uid))?;
    let source = format!("Tática da seleção · {}", team.name);
    let written = connection.session.apply_national_tactics(team, &connection.players, pending.plan, &selected)?;
    let batch = connection.fresh_id();
    let applied = written.len();
    for done in written {
        let change = Change {
            entity: Entity::Player,
            uid: done.player,
            field: FIELD.into(),
            old: done.before(),
            new: done.after(),
        };
        let entry = connection.entry(change, connection.player_name(done.player), Some(batch));
        connection.push_log(LoggedChange {
            source: Some(source.clone()),
            undo: Some(Undo::NationalTactics(done)),
            ..entry
        });
    }
    Ok(Applied {
        report: MassReport { batch, applied, failed: Vec::new() },
        session: connection.history.session.clone(),
    })
}
