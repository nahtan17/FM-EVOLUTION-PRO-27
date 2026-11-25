import { confirmPendingNavigation, usePendingForm } from "./pendingEdits";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { call } from "./api";
import { PlayerBatchTools } from "./PlayerBatchTools";
import { DevelopmentPanel } from "./DevelopmentPanel";
import { TrainingCalendar } from "./TrainingCalendar";
import { teamLabel } from "./labels";
import { EditorContext } from "./useProfileEditing";
import { DEFAULT_SETTINGS, FACTORS, defaultEffectiveness, trainerCall, planKey, type TrainerAutomation, type Effectiveness, type EffectivenessReading, type TrainingTeam, type SessionOverrides, type TrainerSettings, type TrainerStatus, type TrainingPlan, type TacticsReport } from "./trainerApi";
import type { FmDate } from "./types";
import "./TrainerPanel.css";

type Page = "training" | "development" | "tactics" | "club";
const teamName = (team: TrainingTeam) => teamLabel({
  index: team.index, kind: team.kind,
  ageLimit: team.age_limit > 0 && team.age_limit < 100 ? team.age_limit : null,
});

function readPng(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Não foi possível ler a captura PNG."));
    reader.readAsDataURL(file);
  });
}
const iso = (date: FmDate | null | undefined) => date ? `${date.year}-${String(date.month).padStart(2,"0")}-${String(date.day).padStart(2,"0")}` : new Date().toLocaleDateString("sv-SE");
const dateText = (date: string) => new Date(date+"T12:00:00").toLocaleDateString("pt-BR");
function readSettings(): TrainerSettings { try { return {...DEFAULT_SETTINGS,...JSON.parse(localStorage.getItem("fmlivre.trainer.settings")??"{}")} } catch { return {...DEFAULT_SETTINGS} } }

export function TrainerPanel({active, paused, gameDate}: {active:boolean;paused:boolean;gameDate?:FmDate|null}) {
  const {onEdited} = useContext(EditorContext);
  const [page,setPage] = useState<Page>("training");
  const [status,setStatus] = useState<TrainerStatus|null>(null);
  const [eff,setEff] = useState<Effectiveness>(defaultEffectiveness);
  const [settings,setSettings] = useState<TrainerSettings>(readSettings);
  const [busy,setBusy] = useState("");
  const [error,setError] = useState("");
  const [message,setMessage] = useState("");
  const [readWarning,setReadWarning] = useState("");
  const [log,setLog] = useState<string[]>([]);
  const [plan,setPlan] = useState<TrainingPlan|null>(null);
  const [previewKey,setPreviewKey] = useState("");
  const [week,setWeek] = useState(0);
  const [report,setReport] = useState<TacticsReport|null>(null);
  const [tactic,setTactic] = useState(0);
  const [autoTraining,setAutoTraining] = useState(false);
  const [keepTactics,setKeepTactics] = useState(false);
  const [autoRead,setAutoRead] = useState(false);
  const [selected,setSelected] = useState<number[]>([]);
  const [readInterval,setReadInterval] = useState(() => {
    try {
      const value = Number(localStorage.getItem("fmlivre.trainer.readInterval"));
      return Number.isInteger(value) && value >= 5 && value <= 120 ? value : 8;
    } catch { return 8; }
  });
  const [protectedWeeks,setProtectedWeeks] = useState<string[]>([]);
  const [protectedDays,setProtectedDays] = useState<string[]>([]);
  const [drafts,setDrafts] = useState<SessionOverrides>({});
  const [exportStart,setExportStart] = useState(()=>iso(gameDate));
  const [leagueDay,setLeagueDay] = useState(5);
  const [europeDay,setEuropeDay] = useState(-1);
  const [cup,setCup] = useState(false);
  const started=useRef(false);
  const running=useRef(false);
  const configuration=useRef<Promise<TrainerAutomation>|null>(null);
  const seenEvent=useRef(0);
  const [lastCheck,setLastCheck]=useState<number|null>(null);
  const latest=useRef({eff,settings,autoTraining,keepTactics,autoRead});
  latest.current={eff,settings,autoTraining,keepTactics,autoRead};
  const writable=Boolean(status?.ping.known_build||status?.ping.untested_writes);
  const disabled=Boolean(busy)||paused;
  const identity=status?.context??"";
  const team=status?.teams?.teams.find(candidate=>candidate.selected);
  const planRequest={effectiveness:eff,settings,context:identity,protected_weeks:protectedWeeks,protected_days:protectedDays};
  const key=JSON.stringify([planKey(eff,settings),identity,protectedWeeks,protectedDays]);
  const gameDay=gameDate?iso(gameDate):"";
  const note=useCallback((text:string)=>setLog(old=>[`${new Date().toLocaleTimeString("pt-BR")} · ${text}`,...old].slice(0,30)),[]);
  const refresh=useCallback(async()=>{const s=await trainerCall<TrainerStatus>({cmd:"status"});setStatus(s);return s;},[]);
  const perform=useCallback(async<T,>(label:string,task:()=>Promise<T>):Promise<T|undefined>=>{
    if(running.current)return;
    running.current=true;setBusy(label);setError("");setMessage("");
    try{return await task();}
    catch(e){const text=String(e);setError(text);note(`${label}: ${text}`);return;}
    finally{running.current=false;setBusy("");}
  },[note]);
  const action=(label:string,request:Record<string,unknown>)=>void perform(label,async()=>{
    const result=await trainerCall<Record<string,unknown>>({...request,context:identity||undefined});
    await refresh();onEdited();setMessage(label+" concluído.");note(label);
    return result;
  });

  useEffect(()=>{try{localStorage.setItem("fmlivre.trainer.settings",JSON.stringify(settings));}catch{/* Optional preferences. */}},[settings]);
  useEffect(()=>{
    if(!active||paused||started.current)return;
    started.current=true;
    void perform("Lendo dados de treino",async()=>{
      const effectiveness=await trainerCall<Effectiveness>({cmd:"effectiveness"});setEff(effectiveness);
      await refresh();
    });
  },[active,paused,perform,refresh]);
  useEffect(()=>{
    if(paused){
      started.current=false;
      setAutoTraining(false);setKeepTactics(false);setAutoRead(false);
      setStatus(null);setPlan(null);setReport(null);setProtectedWeeks([]);setProtectedDays([]);setDrafts({});setSelected([]);
      setPreviewKey("");setLastCheck(null);setReadWarning("");
    }
  },[paused]);
  useEffect(()=>{
    try { localStorage.setItem("fmlivre.trainer.readInterval",String(readInterval)); }
    catch { /* Optional preference. */ }
  },[readInterval]);

  useEffect(()=>{
    if(!started.current)return;
    const configure=()=>{
      const pending=trainerCall<TrainerAutomation>({cmd:"automation_config",training:autoTraining&&!paused,understanding:keepTactics&&!paused,read_screen:autoRead&&!paused,effectiveness:latest.current.eff,settings:latest.current.settings,identity,game_date:gameDay,protected_weeks:protectedWeeks,protected_days:protectedDays,read_interval:readInterval});
      configuration.current=pending;
      void pending.then(result=>{if(configuration.current===pending)seenEvent.current=result.event;}).catch(e=>{
        if(configuration.current===pending){setError(String(e));setAutoTraining(false);setKeepTactics(false);setAutoRead(false);}
      });
    };
    if(!autoTraining&&!keepTactics&&!autoRead){configure();return;}
    const timer=window.setTimeout(configure,200);
    return()=>window.clearTimeout(timer);
  },[autoTraining,keepTactics,autoRead,paused,key,identity,gameDay,protectedWeeks,protectedDays,readInterval]);

  useEffect(()=>{
    if(paused||(!autoTraining&&!keepTactics&&!autoRead))return;
    let cancelled=false;let polling=false;
    const poll=async()=>{
      if(polling)return;polling=true;
      try{
        const pending=configuration.current;
        if(pending)await pending;
        const result=await trainerCall<TrainerAutomation>({cmd:"automation_state"});
        if(cancelled||configuration.current!==pending)return;
        if(result.last_check)setLastCheck(result.last_check);
        setReadWarning(result.warning??"");
        if(result.effectiveness)setEff(result.effectiveness);
        if(result.plan){setPlan(result.plan);setPreviewKey(JSON.stringify([planKey(result.effectiveness??latest.current.eff,result.settings??latest.current.settings),identity,protectedWeeks,protectedDays]));}
        if(result.understanding)setStatus(old=>old?{...old,understanding:result.understanding??null}:old);
        if(result.error){setError(result.error);setAutoTraining(false);setKeepTactics(false);setAutoRead(false);}
        if(result.event>seenEvent.current){
          seenEvent.current=result.event;
          if(result.activity)note(result.activity);
          if(result.changed&&!result.error)onEdited();
        }
      }catch(e){if(!cancelled){setError(String(e));setAutoTraining(false);setKeepTactics(false);setAutoRead(false);}}
      finally{polling=false;}
    };
    const timer=window.setInterval(()=>void poll(),1500);
    return()=>{cancelled=true;window.clearInterval(timer);};
  },[autoTraining,keepTactics,autoRead,paused,onEdited,note,identity,protectedWeeks,protectedDays]);

  const acceptReading=(result:EffectivenessReading)=>{
    setEff(result.effectiveness);
    const names=result.doubts.map(factor=>FACTORS.find(([id])=>id===factor)?.[1]??factor);
    const warnings=[];
    if(result.missing_bars) warnings.push(`${result.missing_bars} barra(s) não foram identificadas.`);
    if(names.length) warnings.push(`Confira os valores de ${names.join(", ")}.`);
    setReadWarning(warnings.join(" "));
    setMessage(warnings.length?"Leitura disponível para revisão.":"Eficácia tática atualizada.");
    note("Eficácia tática atualizada.");
  };
  const readScreen=()=>void perform("Lendo eficácia tática",async()=>{
    acceptReading(await trainerCall<EffectivenessReading>({cmd:"read_screen"}));
  });
  const importImage=(file:File)=>void perform("Lendo captura PNG",async()=>{
    if(file.size>12*1024*1024) throw new Error("Escolha uma captura PNG de até 12 MB.");
    acceptReading(await trainerCall<EffectivenessReading>({cmd:"read_image",png:await readPng(file)}));
  });
  const selectTrainingTeam=(selection:{club?:number;team?:number})=>void perform("Trocando plantel de treino",async()=>{
    setAutoTraining(false);setKeepTactics(false);setAutoRead(false);
    await call("development_set",{multiplier:1,selectedPlayers:[],club:status?.club.uid??0,pid:status?.ping.pid??0,team:null});
    await trainerCall({cmd:"automation_config"});
    await trainerCall({cmd:"select",...selection});
    setPlan(null);setReport(null);setPreviewKey("");setProtectedWeeks([]);setProtectedDays([]);setDrafts({});setSelected([]);
    setLastCheck(null);setReadWarning("");setWeek(0);setEff(defaultEffectiveness());
    await refresh();
    setMessage("Plantel de treino selecionado. Leia a eficácia tática desta equipe ou ajuste os valores manualmente.");
  });
  const changeFactor=(factor:string,value:number)=>setEff(old=>({...old,source:"Valores ajustados manualmente",components:[],factors:old.factors.map(([f,v])=>[f,f===factor?value:v])}));
  const preview=()=>void perform("Pré-visualizando treinos",async()=>{
    const p=await trainerCall<TrainingPlan>({cmd:"training_preview",...planRequest});setPlan(p);setWeek(0);setPreviewKey(key);if(p.today)setExportStart(p.today);setMessage("Plano calculado com o calendário do jogo; nenhuma sessão foi alterada.");
  });
  const apply=async()=>Boolean(await perform("Aplicando treinos",async()=>{
    const p=await trainerCall<TrainingPlan>({cmd:"training_apply",...planRequest,session_overrides:drafts});setPlan(p);setDrafts({});setPreviewKey(key);onEdited();setMessage(`${p.written_days} dias ajustados no calendário do FM.`);note(`Treinos aplicados: ${p.written_days} dias.`);return true;
  }));
  const draftCount=Object.keys(drafts).length;
  usePendingForm({count:active?draftCount:0,busy:active&&Boolean(busy),validate:()=>{
    if(!writable||paused||previewKey!==key)throw Error("Atualize a prévia do calendário antes de salvar os treinos.");
  },save:apply});
  useEffect(()=>{if(!active)setDrafts({})},[active]);
  const exportPlan=(weeks:number)=>void perform("Exportando plano",async()=>{
    const r=await trainerCall<{html:string;folder:string}>({cmd:"export_plan",effectiveness:eff,settings,start:exportStart,weeks,league_day:leagueDay,europe_day:europeDay<0?null:europeDay,cup});setMessage(`Plano exportado em HTML, CSV e JSON: ${r.folder}`);note("Plano exportado.");
  });
  const loadTactics=()=>void perform("Analisando a tática",async()=>{
    const r=await trainerCall<TacticsReport>({cmd:"tactics_report"});setReport(r);setTactic(Math.max(0,r.tactics.findIndex(t=>t.index===r.current)));
  });
  const backup=()=>void perform("Copiando saves",async()=>{const r=await trainerCall<{path:string}>({cmd:"backup"});setMessage(`Cópias criadas em: ${r.path}`);note("Cópia dos saves concluída.");});
  const selectedArgs=selected.length?{uids:selected}:{};
  const shownWeek=plan?.weeks[Math.min(week,plan.weeks.length-1)];
  const protect = (date:string, on:boolean, period:"week"|"day") => void perform("Atualizando proteção", async () => {
    const toggle = (dates:string[]) => on ? [...new Set([...dates,date])] : dates.filter(item=>item!==date);
    const weeks = period==="week" ? toggle(protectedWeeks) : protectedWeeks;
    const days = period==="day" ? toggle(protectedDays) : protectedDays;
    setProtectedWeeks(weeks);
    setProtectedDays(days);
    const updated=await trainerCall<TrainingPlan>({cmd:"training_preview",...planRequest,protected_weeks:weeks,protected_days:days});
    setPlan(updated);
    setPreviewKey(JSON.stringify([planKey(eff,settings),identity,weeks,days]));
    setMessage(on ? "Proteção ativada." : "Proteção removida.");
  });
  const shownTactic=report?.tactics[tactic];
  const lineNames:Record<string,string>={Keeper:"Goleiro",CentreBack:"Zagueiro",WideBack:"Lateral",DefMid:"Volante",CentreMid:"Meia central",WideMid:"Meia aberto",AttMid:"Meia ofensivo",WideForward:"Ponta",Striker:"Atacante"};
  const fit=(p:{name:string;fit:number}|null)=>p?<><strong>{p.name}</strong><span className="trainer-score">{p.fit.toFixed(1)}</span></>:<span className="muted">—</span>;

  return <section className={`workspace trainer-workspace${active?"":" inactive"}`} aria-label="Treino">
    <header className="trainer-heading"><div><h1>Treino</h1><p>{status?status.club.name:"Conecte o jogo para consultar o treino"}</p></div>
      <div className="trainer-tools"><button onClick={()=>void perform("Atualizando dados de treino",refresh)} disabled={disabled}>Atualizar dados</button><button onClick={backup} disabled={disabled}>Copiar saves</button><button disabled={disabled||!writable} onClick={()=>action("Desfazer última alteração",{cmd:"undo"})}>Desfazer última ação</button></div>
    </header>
    <div className="trainer-tabs" role="tablist" aria-label="Seções de treino">{([["training","Eficácia e treinos"],["development","Desenvolvimento"],["tactics","Tática e escalação"],["club","Elenco"]] as const).map(([id,label])=><button key={id} role="tab" aria-selected={page===id} onClick={()=>setPage(id)}>{label}</button>)}</div>
    <div className="trainer-scroll">
      {busy&&<p className="trainer-progress" role="status">{busy}…</p>}
      {error&&<div className="banner" role="alert">{error}</div>}
      {message&&<div className="trainer-notice" role="status">{message}</div>}
      {readWarning&&<div className="trainer-notice">{readWarning}</div>}
      {paused&&<div className="banner">O save mudou. Recarregue o jogo no editor; as automações foram pausadas.</div>}
      {status&&!status.ping.known_build&&<div className="trainer-compat"><strong>{status.ping.untested_writes?"Operações experimentais autorizadas nesta sessão":"Treino está em modo de leitura nesta versão do FM"}</strong><p>Confira se clube e elenco correspondem ao seu jogo. Use uma cópia do save para testar.</p><label><input type="checkbox" checked={status.ping.untested_writes} disabled={disabled} onChange={e=>action("Atualizar permissão de edição",{cmd:"allow_untested",on:e.target.checked})}/> Conferi os dados e permito alterações de treino nesta versão.</label></div>}
      <DevelopmentPanel visible={active&&page==="development"} paused={paused} gameDate={gameDate} club={status?.club.uid}
        clubName={status?.club.name} team={team?.index} teamName={team&&teamName(team)} pid={status?.ping.pid}/>
      {page==="training"&&<>
        {status?.teams&&<section className="trainer-card trainer-context">
          <div className="trainer-form">
            {status.teams.managers.length>1&&<label>Treinador do clube<select
              value={status.teams.managers.find(manager=>manager.selected)?.club_uid??status.club.uid}
              disabled={disabled} onChange={e=>{if(!draftCount||confirmPendingNavigation())selectTrainingTeam({club:Number(e.target.value)})}}>
              {status.teams.managers.map(manager=><option key={manager.club_uid} value={manager.club_uid}>{manager.club}</option>)}
            </select></label>}
            {team&&<label>Plantel de treino<select value={team.index} disabled={disabled||status.teams.teams.length<2}
              onChange={e=>{if(!draftCount||confirmPendingNavigation())selectTrainingTeam({team:Number(e.target.value)})}}>
              {status.teams.teams.map(candidate=><option key={candidate.index} value={candidate.index}>{teamName(candidate)} · {candidate.players} jogadores</option>)}
            </select></label>}
          </div>
          {team&&!team.own&&<p className="muted">O plantel precisa ter calendário próprio no FM. Leia o detalhamento de eficácia tática desta equipe.</p>}
        </section>}
        <div className="trainer-cards">{["Entendimento tático","Capacidade do elenco","Apoio do elenco","Próximo adversário"].map((title,i)=>{
          const component=["TacticalUnderstanding","PlayerAbility","PlayerBuyIn","NextMatchInfo"][i];
          const indices=[[0,8],[8,12],[12,15],[15,17]][i];const factorNames=new Set<string>(FACTORS.slice(indices[0],indices[1]).map(([id])=>id));const values=eff.factors.filter(([id])=>factorNames.has(id));
          const value=eff.components.find(([name])=>name===component)?.[1]??values.reduce((a,[,v])=>a+v,0)/Math.max(1,values.length);
          return <div className="trainer-metric" key={title}><span>{title}</span><strong>{value.toFixed(0)}<small>%</small></strong><progress value={value} max={100}/></div>;
        })}</div>
        <div className="trainer-two">
          <section className="trainer-card"><h2>Eficácia tática</h2><p className="muted">Abra no FM o detalhamento de Eficácia Tática (Breakdown) e clique em Ler tela. Os valores abaixo também podem ser ajustados manualmente.</p><div className="trainer-row"><button className="primary" onClick={readScreen} disabled={disabled}>Ler tela do FM</button><button disabled={disabled} onClick={()=>void perform("Salvando valores",async()=>{await trainerCall({cmd:"save_effectiveness",effectiveness:eff});setMessage("Valores da eficácia guardados para o próximo plano.");})}>Salvar valores</button><label className="trainer-import">Ler captura PNG<input type="file" accept=".png,image/png" disabled={disabled}
            onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)importImage(file);}}/></label></div>
          <div className="trainer-row"><label><input type="checkbox" checked={autoRead} disabled={disabled||!identity} onChange={e=>setAutoRead(e.target.checked)}/> Ler automaticamente</label>
            <label>Intervalo (segundos) <input type="number" min={5} max={120} defaultValue={readInterval}
              onKeyDown={e=>{if(e.key==="Enter")e.currentTarget.blur();}}
              onBlur={e=>{
                const value=e.currentTarget.valueAsNumber;
                const interval=Number.isFinite(value)?Math.min(120,Math.max(5,Math.round(value))):readInterval;
                e.currentTarget.value=String(interval);setReadInterval(interval);
              }}/></label></div><p className="trainer-source">{eff.source||"Tela do FM ainda não lida"}{eff.game_date&&` · ${dateText(eff.game_date)}`}</p><div className="trainer-factors">{FACTORS.map(([factor,label])=><label key={factor}><span>{label}</span><input aria-label={label} type="number" min={0} max={100} value={eff.factors.find(([f])=>f===factor)?.[1]??50} onChange={e=>changeFactor(factor,Math.min(100,Math.max(0,Number(e.target.value))))}/><span>%</span></label>)}</div></section>
          <div className="trainer-stack">
            <section className="trainer-card"><h2>Planejamento do treino</h2><div className="trainer-form">
              <label>Carga de treino<select value={settings.load} onChange={e=>setSettings(s=>({...s,load:e.target.value as TrainerSettings["load"]}))}><option value="Light">Mais descanso</option><option value="Balanced">Equilibrada</option><option value="Intense">Menos descanso</option></select></label>
              <label>Reavaliar foco a cada (semanas)<input type="number" min={1} max={52} value={settings.replan_every_weeks} onChange={e=>setSettings(s=>({...s,replan_every_weeks:Math.max(1,Math.min(52,Math.round(Number(e.target.value))))}))}/></label>
              <label>Convívio quando apoio estiver abaixo de (%)<input type="number" min={0} max={100} value={settings.bonding_below} onChange={e=>setSettings(s=>({...s,bonding_below:Number(e.target.value)}))}/></label>
              <label>Bolas paradas a cada (semanas; 0 desliga)<input type="number" min={0} max={52} value={settings.set_pieces_every} onChange={e=>setSettings(s=>({...s,set_pieces_every:Number(e.target.value)}))}/></label>
            </div><label className="trainer-check"><input type="checkbox" checked={settings.no_tactical} onChange={e=>setSettings(s=>({...s,no_tactical:e.target.checked}))}/> Priorizar desenvolvimento dos jogadores, sem sessões de entendimento tático</label><p className="muted">O plano para o FM usa os jogos reais do calendário. Preserva jogos, viagens, férias e os dias até a data atual.</p><div className="trainer-row"><button onClick={preview} disabled={disabled||!identity}>Pré-visualizar treino</button></div><label className="trainer-check"><input type="checkbox" checked={autoTraining} disabled={disabled||!identity||!writable} onChange={e=>setAutoTraining(e.target.checked)}/> Manter o treino planejado automaticamente</label><p className="muted">Enquanto o aplicativo estiver aberto, verifica o calendário a cada 8 segundos e restaura o planejamento, inclusive com a janela em segundo plano.</p>{lastCheck&&<p className="muted">Última verificação: {new Date(lastCheck).toLocaleTimeString("pt-BR")}</p>}</section>
            <section className="trainer-card"><h2>Exportar plano semanal ou da temporada</h2><p className="muted">Monte um calendário para exportação com os dias abaixo. Esta exportação não altera o calendário do jogo.</p><div className="trainer-form"><label>Começar em<input type="date" value={exportStart} onChange={e=>setExportStart(e.target.value)}/></label><label>Jogo de liga<select value={leagueDay} onChange={e=>setLeagueDay(Number(e.target.value))}>{["Segunda","Terça","Quarta","Quinta","Sexta","Sábado","Domingo"].map((d,i)=><option key={d} value={i}>{d}</option>)}</select></label><label>Jogo europeu<select value={europeDay} onChange={e=>setEuropeDay(Number(e.target.value))}><option value={-1}>Sem jogo europeu</option><option value={1}>Terça</option><option value={2}>Quarta</option><option value={3}>Quinta</option></select></label><label className="trainer-check"><input type="checkbox" checked={cup} onChange={e=>setCup(e.target.checked)}/> Incluir copa</label></div><div className="trainer-row"><button onClick={()=>exportPlan(1)} disabled={disabled}>Exportar semana</button><button onClick={()=>exportPlan(52)} disabled={disabled}>Exportar temporada</button></div><p className="muted">Gera HTML, CSV e JSON; o relatório abre ao terminar.</p></section>
          </div>
        </div>
        {plan && shownWeek && <TrainingCalendar plan={plan} week={shownWeek}
          selectWeek={start=>setWeek(Math.max(0,plan.weeks.findIndex(item=>item.start===start)))}
          drafts={drafts} setDrafts={setDrafts} protectedDays={protectedDays} disabled={disabled||!identity}
          canApply={Boolean(writable&&previewKey===key)} protectDay={(date,on)=>protect(date,on,"day")}
          protectWeek={(date,on)=>protect(date,on,"week")} apply={apply}/>}
        {plan && !shownWeek && <p className="muted">Nenhuma semana de treino disponível no calendário.</p>}
      </>}
      {page==="tactics"&&<>
        <section className="trainer-card"><div className="trainer-row trainer-between"><div><h2>Entendimento tático do elenco</h2><p className="muted">As oito áreas da tática, em porcentagem. Os valores são do plantel do treinador.</p></div><button disabled={disabled||!writable||!status?.understanding} onClick={()=>action("Entendimento tático em 100%",{cmd:"max_understanding"})}>Entendimento tático em 100%</button></div><div className="trainer-areas">{FACTORS.slice(0,8).map(([id,label])=>{const level=status?.understanding?.team[id];return <div key={id}><span>{label}</span><strong>{level===undefined?"—":(level/100).toFixed(0)+"%"}</strong></div>;})}</div><label className="trainer-check"><input type="checkbox" checked={keepTactics} disabled={disabled||!identity||!writable||!status?.understanding} onChange={e=>setKeepTactics(e.target.checked)}/> Manter entendimento tático em 100%</label>{Boolean(status?.understanding?.without_record)&&<p className="muted">{status?.understanding?.without_record} jogador(es) ainda sem registro de treino nesta equipe.</p>}</section>
        <section className="trainer-card"><div className="trainer-row trainer-between"><div><h2>Adequação e melhor escalação</h2><p className="muted">Notas estimadas pela análise tática. A análise sugere jogadores e funções; a escalação no FM fica como está.</p></div><button className="primary" disabled={disabled||!status} onClick={loadTactics}>Analisar tática e melhor onze</button></div>{report&&<><label className="trainer-tactic-select">Tática<select value={tactic} onChange={e=>setTactic(Number(e.target.value))}>{report.tactics.map((t,i)=><option value={i} key={t.index}>{t.style||`Tática ${t.index+1}`}</option>)}</select></label>{shownTactic&&!shownTactic.enough_players&&<p className="banner">Não há jogadores disponíveis suficientes para sugerir um onze completo.</p>}<div className="trainer-table-scroll"><table className="grid"><thead><tr><th>Posição</th><th>Função com / sem bola</th><th>Jogador atual</th><th>Melhor onze</th><th>Alternativa no banco</th><th>Função sugerida</th></tr></thead><tbody>{shownTactic?.rows.map(row=><tr key={row.slot}><td>{row.slot} · {lineNames[row.line]??row.line}</td><td>{row.in_possession}<br/><span className="muted">{row.out_of_possession}</span></td><td>{fit(row.current)}</td><td>{fit(row.best)}</td><td>{fit(row.alternative)}</td><td>{row.suggested_role?`${row.suggested_role.role} · ${row.suggested_role.score.toFixed(1)}`:"—"}</td></tr>)}</tbody></table></div></>}</section>
      </>}
      {page==="club"&&<>
        {active && status && <PlayerBatchTools key={status.club.uid} kind="fitness" paused={paused} club={status.club.uid} initialIds={selected} />}

        <section className="trainer-card"><h2>Registro e números de camisa</h2>{status?.flags?.supported?<><label className="trainer-check"><input type="checkbox" checked={status.flags.registration_anytime} disabled={disabled||!writable} onChange={e=>action("Atualizar registro livre",{cmd:"set_human_flags",registration_anytime:e.target.checked})}/> Registrar jogadores a qualquer momento</label><label className="trainer-check"><input type="checkbox" checked={status.flags.numbers_anytime} disabled={disabled||!writable} onChange={e=>action("Atualizar números livres",{cmd:"set_human_flags",numbers_anytime:e.target.checked})}/> Trocar números de camisa a qualquer momento</label></>:<p className="muted">Estas opções não foram localizadas nesta versão do jogo.</p>}<p className="muted">As ações desta aba têm o botão próprio de desfazer. Salve a carreira no FM para manter as alterações.</p></section>
        <section className="trainer-card"><div className="trainer-row trainer-between"><h2>Elenco · {selected.length?`${selected.length} selecionado(s)`:"equipe inteira"}</h2><div className="trainer-row"><button disabled={disabled||!writable} onClick={()=>action("Curar lesões",{cmd:"heal",...selectedArgs})}>Curar lesões</button><button disabled={disabled||!writable} onClick={()=>action("Remover suspensões",{cmd:"lift_bans",...selectedArgs})}>Remover suspensões</button><button disabled={disabled||!writable} onClick={()=>action("Inspirar elenco",{cmd:"inspire",morale:20,clear_unhappiness:true,...selectedArgs})}>Inspirar elenco</button></div></div><div className="trainer-table-scroll"><table className="grid"><thead><tr><th><input aria-label="Selecionar todo o elenco" type="checkbox" checked={Boolean(status?.squad?.length)&&selected.length===status?.squad?.length} onChange={e=>setSelected(e.target.checked?(status?.squad??[]).map(p=>p.uid):[])}/></th><th>Nome</th><th>Moral</th><th>Condição</th><th>Lesões</th><th>Suspensões</th></tr></thead><tbody>{status?.squad?.map(p=><tr key={p.uid}><td><input type="checkbox" aria-label={`Selecionar ${p.name}`} checked={selected.includes(p.uid)} onChange={e=>setSelected(old=>e.target.checked?[...old,p.uid]:old.filter(id=>id!==p.uid))}/></td><td>{p.name}</td><td>{p.morale}/20</td><td>{(p.condition/100).toFixed(0)}%</td><td>{Array.isArray(p.injuries)?p.injuries.length:p.injuries}</td><td>{p.bans}</td></tr>)}</tbody></table></div></section>

      </>}
      {status?.warnings.length? <details className="trainer-card"><summary>Alguns dados de treino não estão disponíveis</summary>{status.warnings.map(w=><p className="muted" key={w}>{w}</p>)}</details>:null}
      {log.length>0&&<details className="trainer-card trainer-log"><summary>Atividade de treino</summary><ol>{log.map((line,i)=><li key={i}>{line}</li>)}</ol></details>}
      <p className="trainer-credit">Integração baseada no FM27 Trainer 0.2.8, de Sem Hiel · MIT. Sessões e mensagens avançadas podem aparecer em inglês.</p>
    </div>
  </section>;
}
