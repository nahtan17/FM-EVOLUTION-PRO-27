use super::{AppState,Connection,Failure};
use std::collections::BTreeMap;
use serde_json::{Value,json};
use tauri::Manager;
fn failure(message:impl Into<String>)->Failure{Failure::new("club.extensions",message)}
pub(super) fn log(c:&mut Connection,done:fmlibre_core::ClubRecordChange)->Value{
 let entry=c.entry(fmlibre_core::Change{entity:fmlibre_core::Entity::Club,uid:done.club,field:"club_extensions.changes".into(),old:0,new:done.fields as i64},format!("{} — {}",c.club_name(done.club),done.label),None);
 let done=c.push_log(super::LoggedChange{undo:Some(super::Undo::ClubRecord(done)),..entry});json!({"change":done.id})
}
#[tauri::command]
pub(crate) async fn club_extra_view(app:tauri::AppHandle,club:u32)->Result<Value,Failure>{
 tauri::async_runtime::spawn_blocking(move||{let state=app.state::<AppState>();let guard=state.0.lock()?;let c=guard.as_ref().ok_or_else(super::not_connected)?;c.refuse_after_load()?;let club=c.clubs.get(club).ok_or_else(||failure("Clube não encontrado."))?;Ok(json!(c.session.club_extra_view(club).map_err(failure)?))}).await?
}
#[tauri::command]
pub(crate) async fn set_club_extra(app:tauri::AppHandle,club:u32,revision:String,values:BTreeMap<String,i64>)->Result<Value,Failure>{
 tauri::async_runtime::spawn_blocking(move||{let state=app.state::<AppState>();let mut guard=state.0.lock()?;let c=guard.as_mut().ok_or_else(super::not_connected)?;c.refuse_after_load()?;let club=c.clubs.get(club).ok_or_else(||failure("Clube não encontrado."))?.clone();let done=c.session.change_club_extras(&club,&revision,&values).map_err(failure)?;Ok(log(c,done))}).await?
}
#[tauri::command]
pub(crate) async fn sponsor_editor(app:tauri::AppHandle,club:u32)->Result<Value,Failure>{
 tauri::async_runtime::spawn_blocking(move||{let state=app.state::<AppState>();let guard=state.0.lock()?;let c=guard.as_ref().ok_or_else(super::not_connected)?;c.refuse_after_load()?;let club=c.clubs.get(club).ok_or_else(||failure("Clube não encontrado."))?;Ok(json!(c.session.sponsor_editor(club).map_err(failure)?))}).await?
}
#[tauri::command]
pub(crate) async fn set_sponsor(app:tauri::AppHandle,club:u32,revision:String,action:String,index:Option<usize>,input:Option<fmlibre_core::SponsorInput>)->Result<Value,Failure>{
 tauri::async_runtime::spawn_blocking(move||{if !["add","update","remove"].contains(&action.as_str()){return Err(failure("Operação de patrocínio inválida."))}let state=app.state::<AppState>();let mut guard=state.0.lock()?;let c=guard.as_mut().ok_or_else(super::not_connected)?;c.refuse_after_load()?;let club=c.clubs.get(club).ok_or_else(||failure("Clube não encontrado."))?.clone();let done=c.session.change_sponsor(&club,&revision,&action,index,input.as_ref()).map_err(failure)?;Ok(log(c,done))}).await?
}
#[tauri::command]
pub(crate) fn rating_context(state:tauri::State<'_,AppState>)->Result<Value,Failure>{let guard=state.0.lock()?;let c=guard.as_ref().ok_or_else(super::not_connected)?;Ok(json!({"save":c.save,"connection":c.history.session}))}
