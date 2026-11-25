use std::collections::BTreeMap;

use fmlibre_core::{ClubRecordSection, ClubRecords, StatementPeriod};
use serde_json::Value;
use tauri::Manager;

use super::{AppState, Failure, not_connected};

fn failure(message: impl Into<String>) -> Failure {
    Failure::new("club.records", message)
}

#[tauri::command]
pub(crate) fn club_records(
    state: tauri::State<'_, AppState>,
    club: u32,
    section: ClubRecordSection,
) -> Result<ClubRecords, Failure> {
    let guard = state.0.lock()?;
    let connection = guard.as_ref().ok_or_else(not_connected)?;
    connection.refuse_after_load()?;
    let club = connection.clubs.get(club).ok_or_else(|| failure("Clube não encontrado."))?;
    connection.session.club_records(club, section, &connection.clubs, &connection.players).map_err(failure)
}

#[tauri::command]
pub(crate) fn set_club_record(
    app: tauri::AppHandle,
    club: u32,
    section: ClubRecordSection,
    slot: usize,
    revision: String,
    values: BTreeMap<String, i64>,
) -> Result<Value, Failure> {
    let state = app.state::<AppState>();
    let mut guard = state.0.lock()?;
    let connection = guard.as_mut().ok_or_else(not_connected)?;
    connection.refuse_after_load()?;
    let club = connection.clubs.get(club).ok_or_else(|| failure("Clube não encontrado."))?;
    let done = connection
        .session
        .change_club_record(club, section, slot, &revision, &values, &connection.clubs, &connection.players)
        .map_err(failure)?;
    Ok(super::club_extensions::log(connection, done))
}

#[tauri::command]
pub(crate) fn club_statements(state: tauri::State<'_, AppState>, club: u32) -> Result<Vec<StatementPeriod>, Failure> {
    let guard = state.0.lock()?;
    let connection = guard.as_ref().ok_or_else(not_connected)?;
    connection.refuse_after_load()?;
    let club = connection.clubs.get(club).ok_or_else(|| failure("Clube não encontrado."))?;
    connection.session.club_statements(club).map_err(failure)
}
