//! Additional club fields and sponsorship edits, ported from Jackhamerp24's GPL-3.0 editor.
//! Exact image size and club vtable select the supplied Steam/Game Pass offset profile.
use std::collections::BTreeMap;
use fmlibre_mem::is_user_pointer;
use serde::{Serialize,Deserialize};
use serde_json::Value;
use crate::{ClubSummary,Session};
use crate::edit::Kind;
use crate::transfer::{Patch,Patches,MoveError};

const PROFILES:[&str;2]=[
 include_str!("../../../vendor/fm27-reference/offsets/27.1.0+2505117-steam.json"),
 include_str!("../../../vendor/fm27-reference/offsets/27.1.0+2505117-gamepass.json")];
const STEAM_OVERVIEW: &str =
    include_str!("../../../vendor/fm27-reference/offsets/27.1.1+2511875-steam-club-overview.json");
pub(crate) fn number(v:&Value)->Option<u64>{v.as_u64().or_else(||v.as_str().and_then(|s|u64::from_str_radix(s.trim_start_matches("0x"),16).ok()))}
fn error(e:impl ToString)->String{e.to_string()}
pub(crate) fn rev(guards:&[(u64,Vec<u8>)])->String{let mut h=0xcbf29ce484222325u64;for (a,b) in guards{for x in a.to_le_bytes().iter().chain(b){h=(h^u64::from(*x)).wrapping_mul(0x100000001b3)}}format!("{h:016x}")}

#[derive(Debug,Clone)]
pub struct ClubRecordChange{pub club:u32,pub label:String,pub fields:usize,pub(crate) patches:Vec<Patch>,pub(crate) guards:Vec<(u64,Vec<u8>)>}
#[derive(Debug,Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct ExtraField{pub key:String,pub label:String,pub group:String,pub value:i64,pub min:i64,pub max:i64,pub kind:String,#[serde(skip)]address:u64,#[serde(skip)]raw:Vec<u8>}
#[derive(Debug,Clone,Serialize)]
pub struct ExtraView{pub revision:String,pub fields:Vec<ExtraField>,#[serde(skip)]guards:Vec<(u64,Vec<u8>)>}

fn meta(key:&str)->Option<(&str,i64,i64)>{Some(match key{
 "YearFounded"=>("Ano de fundação",0,2300),"Status"=>("Situação",1,3),"ChairmanStatus"=>("Status do presidente",0,10000),"Morale"=>("Moral do clube",0,20),
 "AverageAttendance"=>("Público médio",0,1_000_000),"MinimumAttendance"=>("Público mínimo",0,1_000_000),"MaximumAttendance"=>("Público máximo",0,1_000_000),
 "SeasonTicketHolders"=>("Ingressos de temporada",0,1_000_000),"SocialMediaFollowers"=>("Seguidores nas redes sociais",-1,i32::MAX as i64),
 "OwnershipType"=>("Tipo de propriedade",0,255),"ChairpersonTitle"=>("Título do presidente",0,255),"YouthImportance"=>("Importância da juventude",0,20),
 "BackgroundColour"=>("Cor de fundo",0,u32::MAX as i64),"ForegroundColour"=>("Cor de primeiro plano",0,u32::MAX as i64),"AllowCustomLogo"=>("Permitir escudo personalizado",0,1),
 _=>return None})}

impl Session{
 pub(crate) fn extra_profile(&self,club:&ClubSummary)->Result<Value,String>{
  let actual=self.process.read_u64(club.address).map_err(error)?;
  for text in PROFILES{let p:Value=serde_json::from_str(text).map_err(error)?;if number(&p["imageSize"])==Some(self.plugin.size)&&number(&p["club"]["vtable"]).is_some_and(|v|self.plugin.base+v==actual){return Ok(p)}}
  Err("Os campos adicionais ainda não têm perfil correspondente para este módulo do jogo.".into())
 }
 pub fn club_extra_view(&self,club:&ClubSummary)->Result<ExtraView,String>{
  let steam: Value = serde_json::from_str(STEAM_OVERVIEW).map_err(error)?;
  let p = match self.fingerprint {
      crate::PluginFingerprint::Pe { size_of_image, link_timestamp }
          if number(&steam["imageSize"]) == Some(u64::from(size_of_image))
              && number(&steam["peTimestamp"]) == Some(u64::from(link_timestamp)) =>
      {
          let vtable = number(&steam["club"]["vtable"]).ok_or("Perfil de clube inválido.")?;
          if self.process.read_u64(club.address).map_err(error)? != self.plugin.base + vtable {
              return Err("Não foi possível confirmar a estrutura deste clube.".into());
          }
          steam
      }
      _ => self.extra_profile(club)?,
  };
  let mut fields=Vec::new();let mut guards=vec![(club.address,self.process.read_bytes(club.address,16).map_err(error)?)];
  for (key,mapping) in p["club"]["fields"].as_object().ok_or("Perfil de clube inválido.")?{
   let Some((label,min,max))=meta(key) else{continue};if mapping["root"].as_str()!=Some("club"){continue}
   let path=mapping["path"].as_str().unwrap_or("").split("->").filter_map(|s|u64::from_str_radix(s.trim_start_matches("0x"),16).ok()).collect::<Vec<_>>();
   if path.is_empty(){continue}let mut address=club.address;let mut valid=true;
   for offset in path.iter().take(path.len()-1){let at=address+offset;let bytes=self.process.read_bytes(at,8).map_err(error)?;address=u64::from_le_bytes(bytes.clone().try_into().unwrap());guards.push((at,bytes));if !is_user_pointer(address){valid=false;break}}
   if !valid{continue}address+=path[path.len()-1];
   let kind=mapping["type"].as_str().unwrap_or("");let size=match kind{"byte"|"sbyte"|"bool"=>1,"int16"=>2,"int32"|"colour"=>4,_=>continue};
   let raw=self.process.read_bytes(address,size).map_err(error)?;
   let value=match kind{"byte"|"bool"=>i64::from(raw[0]),"sbyte"=>i64::from(raw[0] as i8),"int16"=>i64::from(i16::from_le_bytes(raw.clone().try_into().unwrap())),"colour"=>i64::from(u32::from_le_bytes(raw.clone().try_into().unwrap())),_=>i64::from(i32::from_le_bytes(raw.clone().try_into().unwrap()))};
   if !(min..=max).contains(&value){continue}guards.push((address,raw.clone()));fields.push(ExtraField{key:key.clone(),label:label.into(),group:"overview".into(),value,min,max,kind:kind.into(),address,raw});
  }
  let a=&p["staff"]["allowances"];let human=p["staff"]["kinds"].as_array().and_then(|v|v.iter().find(|v|v["manager"].as_bool()==Some(true))).and_then(|v|number(&v["staffVtable"]));
  if let (Some(manager_vt),Some(team_manager),Some(human_mscc),Some(extra))=(human,number(&a["teamManager"]),number(&a["humanMscc"]),number(&a["msccExtraStaff"])){
   let teams_at=club.address+number(&p["club"]["lists"]["teams"]).unwrap_or(0x18);let header=self.process.read_bytes(teams_at,16).map_err(error)?;let begin=u64::from_le_bytes(header[0..8].try_into().unwrap());let end=u64::from_le_bytes(header[8..16].try_into().unwrap());
   if is_user_pointer(begin)&&end>=begin&&(end-begin)%8==0&&(end-begin)/8<=32{
    for at in (begin..end).step_by(8){let team=self.process.read_u64(at).map_err(error)?;if !is_user_pointer(team){continue}let manager=self.process.read_u64(team+team_manager).map_err(error)?;
     if !is_user_pointer(manager)||self.process.read_u64(manager).ok()!=Some(self.plugin.base+manager_vt){continue}
     let mscc=self.process.read_u64(manager+human_mscc).map_err(error)?;if !is_user_pointer(mscc){continue}
     guards.push((team+team_manager,manager.to_le_bytes().to_vec()));guards.push((manager,self.process.read_bytes(manager,8).map_err(error)?));guards.push((manager+human_mscc,mscc.to_le_bytes().to_vec()));
     for (name,base,max) in [("Preparadores",0,10),("Fisioterapeutas",3,10),("Cientistas desportivos",9,5),("Analistas de desempenho",12,5)]{
      for (i,squad) in ["Principal","Reservas/base","Base jovem"].into_iter().enumerate(){let offset=base+i as u64;let address=mscc+extra+offset;let raw=self.process.read_bytes(address,1).map_err(error)?;let value=raw[0] as i64;if value>max{continue}guards.push((address,raw.clone()));fields.push(ExtraField{key:format!("staff_{offset}"),label:format!("{name} — {squad}"),group:"staff".into(),value,min:0,max,kind:"byte".into(),address,raw});}
     }
     for (offset,label,max) in [(0x13,"Olheiros",15),(0x14,"Analistas de recrutamento",5)]{let address=mscc+extra+offset;let raw=self.process.read_bytes(address,1).map_err(error)?;let value=raw[0] as i64;if value>max{continue}guards.push((address,raw.clone()));fields.push(ExtraField{key:format!("staff_{offset}"),label:label.into(),group:"staff".into(),value,min:0,max,kind:"byte".into(),address,raw});}
     break
    }
   }
  }
  Ok(ExtraView{revision:rev(&guards),fields,guards})
 }
 pub fn change_club_extras(&self,club:&ClubSummary,revision:&str,values:&BTreeMap<String,i64>)->Result<ClubRecordChange,String>{
  let view=self.club_extra_view(club)?;if view.revision!=revision{return Err("Os dados do clube mudaram. Atualize antes de salvar.".into())}
  let mut after=view.fields.iter().map(|f|(f.key.clone(),f.value)).collect::<BTreeMap<_,_>>();let mut patches=Vec::new();
  for (key,value) in values{let field=view.fields.iter().find(|f|&f.key==key).ok_or("Campo indisponível neste clube.")?;if !(field.min..=field.max).contains(value){return Err(format!("{}: informe um valor de {} a {}.",field.label,field.min,field.max))}after.insert(key.clone(),*value);if *value==field.value{continue}let bytes=match field.kind.as_str(){"byte"|"bool"=>vec![*value as u8],"sbyte"=>vec![*value as i8 as u8],"int16"=>(*value as i16).to_le_bytes().to_vec(),"colour"=>(*value as u32).to_le_bytes().to_vec(),_=>(*value as i32).to_le_bytes().to_vec()};patches.push(Patch{address:field.address,before:field.raw.clone(),after:bytes});}
  if let (Some(min),Some(avg),Some(max))=(after.get("MinimumAttendance"),after.get("AverageAttendance"),after.get("MaximumAttendance")){if min>avg||avg>max{return Err("Mantenha público mínimo ≤ médio ≤ máximo.".into())}}
  if patches.is_empty(){return Err("Nenhuma alteração para salvar.".into())}
  let done=ClubRecordChange{club:club.uid,label:"Informações do clube".into(),fields:patches.len(),patches,guards:view.guards};self.apply_club_record(&done).map_err(error)?;Ok(done)
 }
 pub fn apply_club_record(&self,done:&ClubRecordChange)->Result<(),MoveError>{for (address,bytes) in &done.guards{self.expect(*address,bytes)?}self.apply_patches(&done.patches)}
 pub fn undo_club_record(&self,done:&ClubRecordChange)->Result<(),MoveError>{if let Some(lock)=self.structure_lock(){return Err(MoveError::Locked(lock))}let changes=done.patches.iter().map(|p|(p.address,p.after.clone())).collect::<Vec<_>>();for (address,before) in &done.guards{self.expect(*address,&fmlibre_deals::expected_after(*address,before,&changes))?}self.undo_patches(&done.patches)}
}

#[derive(Debug,Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct SponsorRow{pub index:usize,pub kind:u8,pub total:i64,pub per_season:i64,pub start:i64,pub end:i64,pub percent:u16,pub renew:Option<bool>,pub fixed:Option<bool>,#[serde(skip)]address:u64,#[serde(skip)]bytes:Vec<u8>}
#[derive(Debug,Clone,Serialize)]
pub struct SponsorView{pub today:Option<crate::FmDate>,pub revision:String,pub rows:Vec<SponsorRow>,pub editable:bool,#[serde(skip)]guards:Vec<(u64,Vec<u8>)>,#[serde(skip)]record:u64,#[serde(skip)]begin:u64,#[serde(skip)]end:u64,#[serde(skip)]profile:Value}
#[derive(Debug,Clone,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct SponsorInput{pub kind:u8,pub total:i64,pub per_season:i64,pub start:i64,pub end:i64,pub percent:u16,pub renew:Option<bool>,pub fixed:Option<bool>}
impl Session{
 pub fn sponsor_editor(&self,club:&ClubSummary)->Result<SponsorView,String>{
  let profile=self.extra_profile(club)?;let s=self.layout.sponsorship.as_ref().ok_or("Patrocínios indisponíveis.")?;
  self.sponsorships(club).map_err(|_|"Os contratos de patrocínio não foram validados neste clube.")?;
  let mut guards=vec![(club.address,self.process.read_bytes(club.address,16).map_err(error)?)];let record=self.process.read_u64(club.address+s.club_list).map_err(error)?;guards.push((club.address+s.club_list,record.to_le_bytes().to_vec()));
  if !is_user_pointer(record){return Ok(SponsorView{today:self.game_date(),revision:rev(&guards),rows:Vec::new(),editable:false,guards,record:0,begin:0,end:0,profile})}
  let header=self.process.read_bytes(record,24).map_err(error)?;let begin=u64::from_le_bytes(header[0..8].try_into().unwrap());let end=u64::from_le_bytes(header[8..16].try_into().unwrap());guards.push((record,header));
  if end<begin||(end-begin)%8!=0||(end-begin)/8>64{return Err("Lista de patrocínios inválida.".into())}
  let pointers=if end==begin{Vec::new()}else{self.process.read_bytes(begin,(end-begin) as usize).map_err(error)?};if !pointers.is_empty(){guards.push((begin,pointers.clone()));}let mut rows=Vec::new();let f=&profile["club"]["financeLists"];
  for (index,pointer) in pointers.chunks_exact(8).enumerate(){let address=u64::from_le_bytes(pointer.try_into().unwrap());let bytes=self.process.read_bytes(address,s.entry_size as usize).map_err(error)?;let field=|at:u64|i64::from(u32::from_le_bytes(bytes[at as usize..at as usize+4].try_into().unwrap()));let date=|at:u64|Kind::Date.decode(&bytes[at as usize..at as usize+4]);let flag=|key:&str|number(&f[key]).and_then(|at|bytes.get(at as usize)).and_then(|v|(*v<=1).then_some(*v==1));
   rows.push(SponsorRow{index,kind:bytes[s.kind as usize],total:field(s.total),per_season:field(s.per_season),start:date(s.start),end:date(s.end),percent:u16::from_le_bytes(bytes[s.percent as usize..s.percent as usize+2].try_into().unwrap()),renew:flag("sponsorRenew"),fixed:flag("sponsorFixed"),address,bytes:bytes.clone()});guards.push((address,bytes));
  }
  Ok(SponsorView{today:self.game_date(),revision:rev(&guards),rows,editable:true,guards,record,begin,end,profile})
 }
 pub fn change_sponsor(&self,club:&ClubSummary,revision:&str,action:&str,index:Option<usize>,input:Option<&SponsorInput>)->Result<ClubRecordChange,String>{
  let view=self.sponsor_editor(club)?;if !view.editable||view.revision!=revision{return Err("A lista mudou ou está indisponível. Atualize antes de salvar.".into())}
  if let Some(lock)=self.structure_lock(){return Err(error(MoveError::Locked(lock)))}
  let mut patches=Vec::new();let s=self.layout.sponsorship.as_ref().unwrap();
  if action=="remove"{
   let index=index.filter(|i|*i<view.rows.len()).ok_or("Selecione um patrocínio válido.")?;let at=view.begin+index as u64*8;let length=(view.end-at) as usize;let before=self.process.read_bytes(at,length).map_err(error)?;let mut after=before.clone();after.copy_within(8..,0);after[length-8..].fill(0);patches.push(Patch{address:at,before,after});patches.push(Patch{address:view.record+8,before:view.end.to_le_bytes().to_vec(),after:(view.end-8).to_le_bytes().to_vec()});
  }else{
   let input=input.ok_or("Preencha o patrocínio.")?;let current=index.and_then(|i|view.rows.get(i));
   if action!="add"&&current.is_none(){return Err("Selecione um patrocínio válido.".into())}
   if crate::sponsorship::kind_name(input.kind).is_none()&&current.is_none_or(|r|r.kind!=input.kind){return Err("Tipo de patrocinador não validado.".into())}
   if !(0..=i32::MAX as i64).contains(&input.total)||!(0..=i32::MAX as i64).contains(&input.per_season)||input.percent>100{return Err("Valor ou percentual fora do limite.".into())}
   if fmlibre_deals::date(input.start).is_none()||fmlibre_deals::date(input.end).is_none()||input.start>input.end{return Err("Datas do patrocínio inválidas.".into())}
   let mut bytes=current.or_else(||view.rows.first()).map(|r|r.bytes.clone()).unwrap_or_else(||vec![0;s.entry_size as usize]);
   for (at,v) in [(s.total,input.total),(s.per_season,input.per_season)]{bytes[at as usize..at as usize+4].copy_from_slice(&(v as u32).to_le_bytes());}
   for (at,v) in [(s.start,input.start),(s.end,input.end)]{let start=at as usize;let new=Kind::Date.encode(v,&bytes[start..start+4]);bytes[start..start+4].copy_from_slice(&new);}
   bytes[s.kind as usize]=input.kind;bytes[s.percent as usize..s.percent as usize+2].copy_from_slice(&input.percent.to_le_bytes());
   for (key,value) in [("sponsorRenew",input.renew),("sponsorFixed",input.fixed)]{if let Some(value)=value{let at=number(&view.profile["club"]["financeLists"][key]).ok_or("Opção indisponível neste perfil.")? as usize;if at>=bytes.len(){return Err("Opção inválida no perfil.".into())}bytes[at]=u8::from(value)}}
   if action=="add"{
    if view.rows.len()>=64{return Err("Limite de patrocínios atingido.".into())}
    let address=self.heap_block(bytes.len()).map_err(error)?;self.process.write_bytes(address,&bytes).map_err(error)?;
    let mut all=Patches::default();let mut blocks=vec![address];
    // Allocations are from the game's runtime. Retained on undo to avoid dangling references in game caches.
    self.add_to_list(view.record,&address.to_le_bytes(),&mut all,&mut blocks).map_err(error)?;patches=all.0;
   }else{let current=current.unwrap();if bytes==current.bytes{return Err("Nenhuma alteração para salvar.".into())}patches.push(Patch{address:current.address,before:current.bytes.clone(),after:bytes});}
  }
  let done=ClubRecordChange{club:club.uid,label:format!("Patrocínio: {action}"),fields:1,patches,guards:view.guards};self.apply_club_record(&done).map_err(error)?;Ok(done)
 }
}
