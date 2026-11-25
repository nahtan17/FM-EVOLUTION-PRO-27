//! Native automation: continues while the FM Livre window is in the background.
use super::*;
use std::sync::{Arc, Condvar, OnceLock};
use std::time::{Duration as Interval, Instant};

#[derive(Clone)]
struct Config {
    training: bool,
    understanding: bool,
    read_screen: bool,
    read_interval: Interval,
    identity: String,
    protected: HashSet<NaiveDate>,
    protected_days: HashSet<NaiveDate>,
    last_date: Option<NaiveDate>,
    effectiveness: model::Effectiveness,
    settings: planner::PlannerSettings,
}
impl Config {
    fn enabled(&self) -> bool { self.training || self.understanding || self.read_screen }
}
#[derive(Default)]
struct State {
    config: Option<Config>,
    generation: u64,
    event: u64,
    result: Value,
    error: String,
    last_screen: Option<Instant>,
    last_edit: Option<Instant>,
}
type Runtime = Arc<(Mutex<State>, Condvar)>;

fn runtime() -> &'static Runtime {
    static RUNTIME: OnceLock<Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        let runtime = Arc::new((Mutex::new(State::default()), Condvar::new()));
        let worker = runtime.clone();
        std::thread::Builder::new().name("fmlivre-trainer-auto".into()).spawn(move || run(worker)).expect("trainer automation thread");
        runtime
    })
}
fn snapshot(s: &State) -> Value {
    let mut out = s.result.as_object().cloned().unwrap_or_default();
    out.insert("generation".into(),json!(s.generation));
    out.insert("event".into(),json!(s.event));
    out.insert("error".into(),json!(s.error));
    out.insert("enabled".into(),json!(s.config.as_ref().map(|c|json!({"training":c.training,"understanding":c.understanding,"read_screen":c.read_screen}))));
    Value::Object(out)
}
pub fn state() -> Value {
    snapshot(&runtime().0.lock().unwrap_or_else(|p|p.into_inner()))
}
pub fn protections(identity: &str) -> (HashSet<NaiveDate>, HashSet<NaiveDate>) {
    let state = runtime().0.lock().unwrap_or_else(|p|p.into_inner());
    state.config.as_ref().filter(|cfg| cfg.identity == identity)
        .map(|cfg| (cfg.protected.clone(), cfg.protected_days.clone())).unwrap_or_default()
}
pub fn configure(req: &Value) -> Result<Value> {
    let on = |name: &str|req.get(name).and_then(Value::as_bool).unwrap_or(false);
    let mut cfg = Config {
        training:on("training"),understanding:on("understanding"),read_screen:on("read_screen"),
        read_interval:Interval::from_secs(req["read_interval"].as_u64().unwrap_or(8).clamp(5, 120)),
        identity:req.get("identity").and_then(Value::as_str).unwrap_or("").to_owned(),
        protected:protected_weeks(req)?,
        protected_days:protected_days(req)?,
        last_date:req.get("game_date").and_then(Value::as_str).and_then(|s|s.parse().ok()),
        effectiveness:effectiveness(req)?,settings:settings(req)?,
    };
    let (lock,changed)=&**runtime();
    let mut s=lock.lock().unwrap_or_else(|p|p.into_inner());
    if let Some(old)=&s.config {
        if old.enabled()&&cfg.enabled()&&old.identity==cfg.identity { cfg.last_date=old.last_date; }
    }
    if !s.config.as_ref().is_some_and(|old|old.read_screen && cfg.read_screen && old.identity==cfg.identity) {
        s.last_screen=None;
    }
    if !s.config.as_ref().is_some_and(|old|old.training==cfg.training && old.understanding==cfg.understanding && old.identity==cfg.identity && old.protected==cfg.protected && old.protected_days==cfg.protected_days) {
        s.last_edit=None;
    }
    if cfg.enabled() { s.error.clear(); }
    s.result=Value::Null;
    s.config=Some(cfg);s.generation+=1;
    changed.notify_one();
    Ok(snapshot(&s))
}
fn current(runtime: &Runtime,generation:u64)->bool {
    let s=runtime.0.lock().unwrap_or_else(|p|p.into_inner());
    s.generation==generation && s.config.as_ref().is_some_and(Config::enabled)
}
fn tick(runtime:&Runtime,generation:u64,cfg:&Config, read_now:bool, edit_now:bool, request:&dyn Fn(Value)->Result<Value>)->Result<Option<Value>> {
    let status=request(json!({"cmd":"status"}))?;
    if !cfg.identity.is_empty() && status["context"].as_str() != Some(&cfg.identity) {
        bail!("O clube, o plantel de treino ou o processo do FM mudou. As automações foram pausadas.");
    }
    let date=request(json!({"cmd":"game_date"})).ok().and_then(|d|NaiveDate::from_yo_opt(d["year"].as_i64()? as i32,d["doy"].as_u64()? as u32));
    if date.zip(cfg.last_date).is_some_and(|(now,last)|now<last) { bail!("A data do jogo voltou para trás. Recarregue o save e ative as automações novamente."); }
    if (cfg.training||cfg.understanding)&&!status["ping"]["known_build"].as_bool().unwrap_or(false)&&!status["ping"]["untested_writes"].as_bool().unwrap_or(false) {
        bail!("O Trainer está em modo de leitura nesta versão do FM. As automações de edição foram pausadas.");
    }
    if !current(runtime,generation) { return Ok(None); }
    let mut eff=cfg.effectiveness.clone();
    let mut read_warning=None;
    if read_now {
        read_warning=Some(String::new());
        match request(json!({"cmd":"read_screen","automatic":true})) {
            Ok(result)=>eff=serde_json::from_value(result["effectiveness"].clone())?,
            Err(error)=>read_warning=Some(format!("{error:#}. Os últimos valores de eficácia foram mantidos.")),
        }
    }
    if !current(runtime,generation) { return Ok(None); }
    let mut modified=false;
    let mut understanding=Value::Null;
    if edit_now&&cfg.understanding&&status["understanding"]["team"].as_object().is_some_and(|a|a.values().any(|v|v.as_u64().unwrap_or(10000)<10000)) {
        request(json!({"cmd":"max_understanding","context":cfg.identity}))?;
        understanding=request(json!({"cmd":"understanding"}))?;
        modified=true;
    }
    if !current(runtime,generation) { return Ok(None); }
    let plan=if edit_now&&cfg.training {
        request(json!({"cmd":"training_apply","context":cfg.identity,"protected_weeks":cfg.protected,"protected_days":cfg.protected_days,"effectiveness":eff,"settings":cfg.settings}))?
    }else{Value::Null};
    let written=plan["written_days"].as_u64().unwrap_or(0);
    modified|=written>0;
    let activity=if written>0 { format!("Treino mantido no calendário: {written} dias ajustados.") }else if modified { "Entendimento tático restaurado para 100%.".to_owned() }else{String::new()};
    Ok(Some(json!({"plan":plan,"effectiveness":eff,"settings":cfg.settings,"understanding":understanding,"activity":activity,"changed":modified,"warning":read_warning,"game_date":date,"last_check":chrono::Local::now().timestamp_millis()})))
}
fn run(runtime:Runtime) {
    let edit_interval=Interval::from_secs(8);
    loop {
        let (lock,changed)=&*runtime;
        let mut s=lock.lock().unwrap_or_else(|p|p.into_inner());
        while !s.config.as_ref().is_some_and(Config::enabled) { s=changed.wait(s).unwrap_or_else(|p|p.into_inner()); }
        let generation=s.generation;
        let cfg=s.config.clone().expect("enabled config");
        let read_now=cfg.read_screen && s.last_screen.is_none_or(|at| at.elapsed() >= cfg.read_interval);
        let edit_now=(cfg.training || cfg.understanding) && s.last_edit.is_none_or(|at|at.elapsed() >= edit_interval);
        if read_now { s.last_screen=Some(Instant::now()); }
        if edit_now { s.last_edit=Some(Instant::now()); }
        drop(s);
        let result=tick(&runtime,generation,&cfg,read_now,edit_now,&super::handle);
        let mut s=lock.lock().unwrap_or_else(|p|p.into_inner());
        if s.generation!=generation { continue; }
        match result {
            Ok(Some(result))=>{
                if result["changed"].as_bool().unwrap_or(false) { s.event+=1; }
                if let Some(config)=&mut s.config {
                    if let Ok(eff)=serde_json::from_value(result["effectiveness"].clone()) { config.effectiveness=eff; }
                    if let Some(date)=result["game_date"].as_str().and_then(|v|v.parse().ok()) { config.last_date=Some(date); }
                }
                let mut result=result;
                if result["warning"].is_null() { result["warning"]=s.result["warning"].clone(); }
                s.result=result;
            },
            Ok(None)=>{},
            Err(error)=>{
                s.error=format!("{error:#}");s.event+=1;
                if let Some(config)=&mut s.config {config.training=false;config.understanding=false;config.read_screen=false;}
            }
        }
        // A configuration change wakes the worker immediately, including switching it off.
        let next_screen = if cfg.read_screen {
            cfg.read_interval.saturating_sub(s.last_screen.map(|at|at.elapsed()).unwrap_or_default())
        } else { Interval::MAX };
        let next_edit=if cfg.training || cfg.understanding {
            edit_interval.saturating_sub(s.last_edit.map(|at|at.elapsed()).unwrap_or_default())
        } else { Interval::MAX };
        drop(changed.wait_timeout(s,next_screen.min(next_edit).max(Interval::from_millis(50))).unwrap_or_else(|p|p.into_inner()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn config() -> Config {
        Config {training:true,understanding:true,read_screen:false,read_interval:Interval::from_secs(8),identity:"27:7:0".into(),protected:HashSet::new(),protected_days:HashSet::new(),last_date:None,effectiveness:model::Effectiveness::default(),settings:planner::PlannerSettings::default()}
    }
    fn state_for(cfg:&Config)->Runtime {
        Arc::new((Mutex::new(State{config:Some(cfg.clone()),generation:1,..State::default()}),Condvar::new()))
    }
    fn response(req:Value,tested:bool)->Result<Value> {
        Ok(match req["cmd"].as_str().unwrap() {
            "status"=>json!({"context":"27:7:0","ping":{"pid":27,"known_build":tested,"untested_writes":false},"club":{"uid":7},"understanding":{"team":{"PassingStyle":5000}}}),
            "game_date"=>json!({"year":2026,"doy":200}),
            "max_understanding"=>json!({"players":3}),
            "understanding"=>json!({"team":{"PassingStyle":10000}}),
            "training_apply"=>json!({"written_days":2,"weeks":[]}),
            _=>bail!("Unexpected request"),
        })
    }
    #[test]
    fn automation_checks_compatibility_before_editing() {
        let cfg=config();let state=state_for(&cfg);let calls=RefCell::new(Vec::new());
        let result=tick(&state,1,&cfg,cfg.read_screen,true,&|req|{calls.borrow_mut().push(req["cmd"].as_str().unwrap().to_owned());response(req,false)});
        assert!(result.is_err());
        assert_eq!(*calls.borrow(),["status","game_date"]);
    }
    #[test]
    fn automation_pauses_when_the_club_changes() {
        let mut cfg=config();cfg.identity="27:7:1".into();let state=state_for(&cfg);let calls=RefCell::new(Vec::new());
        let result=tick(&state,1,&cfg,cfg.read_screen,true,&|req|{calls.borrow_mut().push(req["cmd"].as_str().unwrap().to_owned());response(req,true)});
        assert!(result.is_err());assert_eq!(*calls.borrow(),["status"]);
    }
    #[test]
    fn automation_pauses_when_a_save_moves_the_date_backwards() {
        let mut cfg=config();cfg.last_date=NaiveDate::from_ymd_opt(2026,8,1);let state=state_for(&cfg);let calls=RefCell::new(Vec::new());
        let result=tick(&state,1,&cfg,cfg.read_screen,true,&|req|{calls.borrow_mut().push(req["cmd"].as_str().unwrap().to_owned());response(req,true)});
        assert!(result.is_err());assert_eq!(*calls.borrow(),["status","game_date"]);
    }
    #[test]
    fn automation_applies_training_and_tactical_understanding_after_checks() {
        let mut cfg=config();
        cfg.protected.insert(NaiveDate::from_ymd_opt(2026,8,3).unwrap());
        let state=state_for(&cfg);
        let calls=RefCell::new(Vec::new());
        let result=tick(&state,1,&cfg,false,true,&|req|{
            calls.borrow_mut().push(req["cmd"].as_str().unwrap().to_owned());
            if req["cmd"] == "training_apply" {
                assert_eq!(req["context"], "27:7:0");
                assert_eq!(req["protected_weeks"], json!(["2026-08-03"]));
            }
            response(req,true)
        }).unwrap().unwrap();
        assert!(result["changed"].as_bool().unwrap());
        assert_eq!(*calls.borrow(),["status","game_date","max_understanding","understanding","training_apply"]);
    }
    #[test]
    fn leaving_the_breakdown_screen_keeps_training_running_with_the_last_values() {
        let mut cfg=config();cfg.read_screen=true;let state=state_for(&cfg);let calls=RefCell::new(Vec::new());
        let result=tick(&state,1,&cfg,cfg.read_screen,true,&|req|{
            calls.borrow_mut().push(req["cmd"].as_str().unwrap().to_owned());
            if req["cmd"]=="read_screen" {
                assert_eq!(req["automatic"], true);
                bail!("Breakdown not visible");
            }
            response(req,true)
        }).unwrap().unwrap();
        assert!(!result["warning"].as_str().unwrap().is_empty());
        assert!(result["changed"].as_bool().unwrap());
        assert!(calls.borrow().iter().any(|c|c=="training_apply"));
    }
}
