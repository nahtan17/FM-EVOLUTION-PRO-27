//! A confirmed PA edit for players the game created in one club intake.
use fmlibre_core::{Change, Entity, FmDate, Intake, MoveError};
use serde::Serialize;
use std::collections::BTreeMap;
use tauri::State;

use super::{AppState, Connection, Failure, MassFailure, MassReport, not_connected, not_found};

pub(super) const SOURCE: &str = "Geração de Ouro";
const PA: &str = "potential_ability";
const CA: &str = "current_ability";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Row {
    uid: u32,
    name: String,
    ca: Option<i64>,
    previous_pa: Option<i64>,
    proposed_pa: Option<i64>,
    reason: Option<&'static str>,
}

#[derive(Serialize)]
pub(crate) struct Preview {
    id: u32,
    day: i64,
    rows: Vec<Row>,
}

pub(super) struct Pending {
    id: u32,
    club: u32,
    day: FmDate,
    changes: Vec<Row>,
}

fn failure(message: impl Into<String>) -> Failure {
    Failure::new("youth.goldenGeneration", message)
}

fn intake(connection: &Connection, club: u32, day: FmDate) -> Result<Intake, Failure> {
    let club = connection.clubs.get(club).ok_or_else(|| not_found(Entity::Club, club))?;
    let result = connection.session.youth_intakes(club, &connection.players)?;
    if !result.marked {
        return Err(failure("Esta versão do FM não identifica com segurança os jogadores gerados na fornada."));
    }
    result
        .intakes
        .into_iter()
        .find(|intake| intake.joined == Some(day))
        .ok_or_else(|| failure("A fornada selecionada não está mais disponível. Atualize os dados do clube."))
}

fn proposed_pa(ca: i64, pa: i64, minimum: i64) -> Option<i64> {
    if !(1..=200).contains(&ca) || !(ca..=200).contains(&pa) {
        return None;
    }
    Some(pa.max(minimum))
}

#[tauri::command]
pub(crate) fn plan_golden_generation(
    state: State<'_, AppState>,
    club: u32,
    day: i64,
    minimum: i64,
) -> Result<Preview, Failure> {
    let day = FmDate::from_number(day).ok_or_else(|| failure("Escolha uma data de fornada válida."))?;
    let mut guard = state.0.lock()?;
    let connection = guard.as_mut().ok_or_else(not_connected)?;
    connection.refuse_after_load()?;
    let session = &connection.session;
    let pa = session.field(Entity::Player, PA)?;
    if !pa.takes(minimum) {
        return Err(failure("Informe um PA mínimo inteiro de 1 a 200."));
    }
    if let Some(lock) = session.field_lock(&pa).or_else(|| session.structure_lock()) {
        return Err(MoveError::Locked(lock).into());
    }
    let fields = [session.field(Entity::Player, CA)?, pa];
    let intake = intake(connection, club, day)?;
    let rows: Vec<_> = intake
        .players
        .into_iter()
        .map(|item| {
            let player = item.player;
            let values = session.read_fields(&player.target(), &fields).ok();
            let ca = values.as_ref().and_then(|values| values[0]);
            let previous_pa = values.and_then(|values| values[1]);
            let proposed_pa = ca.zip(previous_pa).and_then(|(ca, pa)| proposed_pa(ca, pa, minimum));
            Row {
                uid: player.uid,
                name: player.name,
                ca,
                previous_pa,
                proposed_pa,
                reason: proposed_pa.is_none().then_some("CA ou PA indisponível ou incoerente"),
            }
        })
        .collect();
    let id = connection.fresh_id();
    let changes =
        rows.iter().filter(|row| row.proposed_pa.is_some() && row.proposed_pa != row.previous_pa).cloned().collect();
    connection.golden_generation.insert(club, Pending { id, club, day, changes });
    Ok(Preview { id, day: day.to_number(), rows })
}

#[tauri::command]
pub(crate) fn apply_golden_generation(state: State<'_, AppState>, club: u32, id: u32) -> Result<MassReport, Failure> {
    let mut guard = state.0.lock()?;
    let connection = guard.as_mut().ok_or_else(not_connected)?;
    connection.refuse_after_load()?;
    if !connection.golden_generation.get(&club).is_some_and(|pending| pending.id == id) {
        return Err(failure("A prévia ficou desatualizada. Gere uma nova prévia antes de aplicar."));
    }
    let pending = connection.golden_generation.remove(&club).expect("matched preview");
    let intake = intake(connection, pending.club, pending.day)?;
    let members: BTreeMap<_, _> =
        intake.players.into_iter().map(|item| (item.player.uid, item.player.target())).collect();
    let batch = connection.fresh_id();
    let mut report = MassReport { batch, applied: 0, failed: Vec::new() };
    for row in pending.changes {
        let change = Change {
            entity: Entity::Player,
            uid: row.uid,
            field: PA.to_owned(),
            old: row.previous_pa.expect("previewed PA"),
            new: row.proposed_pa.expect("previewed target"),
        };
        let result = members
            .get(&row.uid)
            .ok_or_else(|| failure("O jogador saiu da fornada desde a prévia."))
            .and_then(|target| {
                connection
                    .session
                    .apply_player_values(target, std::slice::from_ref(&change), &[(CA, row.ca.expect("previewed CA"))])
                    .map_err(Failure::from)
            });
        match result {
            Ok(()) => {
                connection.log_tool_change(change, row.name, batch, SOURCE);
                report.applied += 1;
            }
            Err(error) => report.failed.push(MassFailure { uid: row.uid, name: row.name, field: PA.into(), error }),
        }
    }
    Ok(report)
}

/// A later rise in CA can make the original PA too low to restore.
pub(super) fn check_undo(connection: &Connection, change: &Change) -> Result<(), Failure> {
    let (target, _) = connection.target(Entity::Player, change.uid)?;
    let field = connection.session.field(Entity::Player, CA)?;
    let ca = connection.session.read_field(&target, &field)?;
    if ca > change.old {
        return Err(failure(format!("O CA atual ({ca}) já supera o PA anterior ({}).", change.old)));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::proposed_pa;

    #[test]
    fn raises_only_known_pa_below_the_minimum() {
        assert_eq!(proposed_pa(80, 120, 160), Some(160));
        assert_eq!(proposed_pa(120, 185, 160), Some(185));
        assert_eq!(proposed_pa(120, 160, 160), Some(160));
        assert_eq!(proposed_pa(150, 120, 160), None);
        assert_eq!(proposed_pa(70, -9, 160), None);
    }
}
