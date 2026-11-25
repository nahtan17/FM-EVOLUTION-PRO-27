use super::{AppState, Failure};
use fmlibre_core::TransferDealPlan;
use fmlibre_deals::Edit;
use serde_json::{Value, json};
use std::sync::{
    Mutex,
    atomic::{AtomicU64, Ordering},
};
use tauri::Manager;
struct Pending {
    token: String,
    session: String,
    plan: TransferDealPlan,
}
static PENDING: Mutex<Option<Pending>> = Mutex::new(None);
static NEXT: AtomicU64 = AtomicU64::new(1);
fn failure(message: impl Into<String>) -> Failure {
    Failure::new("transfer.center", message)
}

#[tauri::command]
pub(crate) async fn transfer_center(
    app: tauri::AppHandle,
    club: u32,
) -> Result<Vec<fmlibre_core::TransferDeal>, Failure> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let guard = state.0.lock()?;
        let c = guard.as_ref().ok_or_else(super::not_connected)?;
        let summary = c.clubs.get(club).ok_or_else(|| failure("Clube não encontrado."))?;
        c.session.club_transfer_center(summary, &c.players, &c.clubs).map_err(Failure::from)
    })
    .await?
}
#[tauri::command]
pub(crate) async fn club_loan_portfolio(app: tauri::AppHandle, club: u32) -> Result<Value, Failure> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let guard = state.0.lock()?;
        let c = guard.as_ref().ok_or_else(super::not_connected)?;
        c.refuse_after_load()?;
        let summary = c.clubs.get(club).ok_or_else(|| failure("Clube não encontrado."))?;
        let date = c.session.game_date();
        let uids: std::collections::BTreeSet<_> = c
            .session
            .club_teams(summary, &c.players)?
            .into_iter()
            .flat_map(|team| team.players)
            .filter(|member| member.loan.is_some())
            .map(|member| member.uid)
            .collect();
        let mut loans = Vec::new();
        let mut unread = 0;
        for uid in uids {
            let Some(player) = c.players.get(uid) else {
                unread += 1;
                continue;
            };
            let Ok(Some(loan)) = c.session.loan(player) else {
                unread += 1;
                continue;
            };
            if loan.club_uid != Some(club) && loan.parent_uid != Some(club) {
                unread += 1;
                continue;
            }
            loans.push(json!({"player":player, "loan":loan}));
        }
        c.refuse_after_load()?;
        if c.session.game_date() != date {
            return Err(super::data_changed());
        }
        Ok(json!({"loans":loans, "unread":unread}))
    })
    .await?
}

#[tauri::command]
pub(crate) async fn preview_transfer_deal(
    app: tauri::AppHandle,
    club: u32,
    id: String,
    revision: String,
    edit: Edit,
) -> Result<Value, Failure> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let guard = state.0.lock()?;
        let c = guard.as_ref().ok_or_else(super::not_connected)?;
        c.refuse_after_load()?;
        let summary = c.clubs.get(club).ok_or_else(|| failure("Clube não encontrado."))?;
        let mut rows = c
            .session
            .club_transfer_center(summary, &c.players, &c.clubs)?
            .into_iter()
            .filter(|row| row.id == id)
            .collect::<Vec<_>>();
        if rows.len() != 1 {
            return Err(failure("A proposta não foi identificada de forma única. Atualize a lista."));
        }
        let row = rows.remove(0);
        if row.revision != revision {
            return Err(failure("A proposta mudou no jogo. Atualize a lista e confira os valores."));
        }
        let plan = c.session.plan_transfer_deal(row, &edit).map_err(failure)?;
        let token = format!("transfer-{}", NEXT.fetch_add(1, Ordering::Relaxed));
        let out = json!({"token":token,"before":plan.before.values,"after":plan.after,"fields":plan.fields});
        *PENDING.lock()? = Some(Pending { token, session: c.history.session.clone(), plan });
        Ok(out)
    })
    .await?
}
#[tauri::command]
pub(crate) async fn apply_transfer_deal(app: tauri::AppHandle, token: String) -> Result<Value, Failure> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut guard = state.0.lock()?;
        let c = guard.as_mut().ok_or_else(super::not_connected)?;
        let pending = {
            let mut slot = PENDING.lock()?;
            if !slot.as_ref().is_some_and(|pending| pending.token == token && pending.session == c.history.session) {
                return Err(failure("Esta prévia expirou. Confira os valores novamente."));
            }
            slot.take().expect("validated pending plan")
        };
        c.refuse_after_load()?;
        c.session.apply_transfer_deal(&pending.plan)?;
        let plan = pending.plan;
        let deal = plan.updated_deal();
        let entry = c.entry(
            fmlibre_core::Change {
                entity: fmlibre_core::Entity::Player,
                uid: plan.before.player,
                field: "transfer_center.changes".into(),
                old: 0,
                new: plan.fields as i64,
            },
            format!("{} — proposta {}", plan.before.name, plan.before.number),
            None,
        );
        let logged = c.push_log(super::LoggedChange { undo: Some(super::Undo::TransferDeal(plan)), ..entry });
        Ok(json!({"change":logged.id,"deal":deal}))
    })
    .await?
}
