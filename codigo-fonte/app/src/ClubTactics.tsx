import {useContext,useEffect,useState} from "react";
import {call} from "./api";
import {ClubCareToggle} from "./ClubCareToggle";
import {teamAction} from "./editing";
import {describeError,formatDate} from "./format";
import {teamLabel} from "./labels";
import type {FmDate} from "./types";
import type {PanelIds} from "./ProfileParts";
import {trainerCall,type TrainingPlan} from "./trainerApi";
import {EditorContext} from "./useProfileEditing";
import "./ClubTools.css";

// The club editor reports these areas in its own order, independently of the training engine.
const AREAS = ["Linha de pressão", "Intensidade de pressão", "Armadilha de pressão", "Estilo de passe", "Construção", "Criação de chances", "Estrutura com a bola", "Estrutura sem a bola"];

interface Member { uid:number; name:string; cohesion:number|null; reason:string|null; tacticalRecord:boolean }
interface TacticalTeam {index:number;kind:number;ageLimit:number|null;record:(number|null)[];training:(number|null)[];cohesion:number|null;knownPlayers:number;players:number;members?:Member[];tacticsError?:string|null}
interface TacticalSummary {teams:TacticalTeam[];session?:string;date?:FmDate|null}
interface CohesionSample { date:FmDate; week:FmDate; cohesion:number|null; measured:number; players:number }
interface CohesionWatch { enabled:boolean; samples:CohesionSample[]; error:string|null }

function CohesionHistory({club,team}:{club:number;team:number}) {
  const [watch,setWatch]=useState<CohesionWatch>();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{
    if(busy)return;
    let active=true;
    const read=()=>void call<CohesionWatch>("club_cohesion_watch",{club,team}).then(
      result=>{if(active){setWatch(result);setError("");}},
      reason=>{if(active)setError(describeError(reason));},
    );
    read();
    const timer=window.setInterval(read,4000);
    return()=>{active=false;window.clearInterval(timer);};
  },[club,team,busy]);
  const toggle=async(enabled:boolean)=>{
    setBusy(true);
    try {
      setWatch(await call<CohesionWatch>("club_cohesion_watch",{club,team,enabled}));
      setError("");
    } catch(reason) {
      setError(describeError(reason));
    } finally {
      setBusy(false);
    }
  };
  const samples=watch?.samples??[];
  const last=samples[samples.length-1];
  return <div>
    <div className="club-toolbar">
      <label><input type="checkbox" checked={watch?.enabled??false} disabled={!watch||busy}
        onChange={event=>void toggle(event.target.checked)}/> Monitorar coesão semanalmente em segundo plano</label>
      {last&&<span className="note">Última leitura em {formatDate(last.date)} · {last.measured}/{last.players} jogadores</span>}
    </div>
    {watch?.enabled&&<p className="note">A coleta continua com o editor conectado, mesmo em outra aba. Ao reconectar, ative de novo.</p>}
    {(error||watch?.error)&&<p role="alert" className="error">{error||watch?.error}</p>}
    {samples.length>0&&<details><summary>Leituras semanais de coesão · {samples.length}</summary>
      <ul>{samples.map((entry,index)=>{
        const previous=samples[index-1]?.cohesion;
        const delta=entry.cohesion===null||previous===null||previous===undefined?null:entry.cohesion-previous;
        return <li key={formatDate(entry.week)}>{formatDate(entry.date)} · {entry.cohesion===null?"Indisponível":`${Math.round(entry.cohesion)}%`}
          {` · ${entry.measured}/${entry.players} jogadores`}
          {delta===null?"":` · variação ${delta>0?"+":""}${Math.round(delta)} p.p.`}</li>;
      })}</ul>
    </details>}
  </div>;
}

function Meter({value}:{value:number|null}) {
  return <div className="club-meter"><div><span style={{width:`${Math.max(0,Math.min(100,value??0))}%`}}/></div><output>{value===null?"—":`${Math.round(value)}%`}</output></div>;
}

export function ClubTactics({club,version,panel}:{club:number;version:number;panel:PanelIds}) {
  const editor=useContext(EditorContext);
  const [summary,setSummary]=useState<TacticalSummary|null>(null);
  const [teamIndex,setTeamIndex]=useState(0);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [level,setLevel]=useState("keep");
  const [excluded,setExcluded]=useState(new Set<number>());
  useEffect(()=>{
    let cancelled=false;
    call<TacticalSummary>("club_tactical_summary",{club}).then(s=>{if(!cancelled){setSummary(s);setError("")}},e=>{if(!cancelled)setError(describeError(e))});
    return()=>{cancelled=true};
  },[club,version]);
  const team=summary?.teams.find(t=>t.index===teamIndex)??summary?.teams[0];
  useEffect(() => {setExcluded(new Set());}, [club,team?.index,summary?.session]);
  const members=team?.members??[];
  const targets=members.filter(member=>!excluded.has(member.uid));
  const apply=async(action:"maxTactics"|"maxCohesion")=>{
    if(!team||(team.members&&!targets.length))return;
    const cohesion=action==="maxCohesion";
    const value=cohesion ? Number(level) : undefined;
    const label=cohesion ? `definir coesão em ${value}%` : "aplicar o máximo à tática atual";
    if(!window.confirm(`Confirma ${label} para ${team.members ? targets.length : team.players} jogador(es) de ${teamLabel(team)}?`))return;
    setBusy(true);setError("");setMessage("");
    try {
      const report=await teamAction(club,team.index,action,team.members?targets.map(member=>member.uid):undefined,value);
      const fresh=await call<TacticalSummary>("club_tactical_summary",{club});
      setSummary(fresh);
      const readback=fresh.teams.find(row=>row.index===team.index);
      const confirmed=cohesion&&readback?.members&&value!==undefined
        ? ` · ${readback.members.filter(member=>targets.some(target=>target.uid===member.uid)&&member.cohesion===value).length} no nível solicitado após releitura` : "";
      setMessage(`${report.applied} atualizado(s)${confirmed} · ${report.failed.length} indisponível(is) ou com falha.`);
      if(report.failed.length)setError(report.failed.map(f=>`${f.name} · ${describeError(f.error)}`).join("\n"));
      if(report.applied)editor.onEdited();
    }catch(e){setError(describeError(e))}finally{setBusy(false)}
  };
  return <section className="club-tools" role="tabpanel" id={panel.id} aria-labelledby={panel.labelledBy}>
    <div className="club-toolbar"><h3>Central de Entrosamento</h3>{summary&&<label>Plantel <select aria-label="Plantel do entendimento tático" value={team?.index??0} onChange={e=>setTeamIndex(Number(e.target.value))}>{summary.teams.map(t=><option key={t.index} value={t.index}>{teamLabel(t)}</option>)}</select></label>}<button disabled={!editor.editable||busy||!team||!team.knownPlayers||(team.members&&!targets.length)} onClick={()=>void apply("maxTactics")}>Melhorar entendimento tático</button></div>
    <p className="note">Médias dos jogadores deste plantel. “—” indica informação indisponível. Exposição e contribuição do treino são lidas separadamente.</p>
    {team&&<>
      <div className="club-tactics-grid"><span>Área</span><strong>Exposição em jogo</strong><strong>Contribuição do treino</strong>
        {AREAS.map((area,i)=><div className="club-area" key={area}><span>{area}</span><Meter value={team.record[i]??null}/><Meter value={team.training[i]??null}/></div>)}
      </div>
      <p className="note">Registros táticos: {team.knownPlayers} de {team.players} jogadores.</p>
      {team.tacticsError && <p className="note">{team.tacticsError}</p>}
      <div className="club-toolbar"><h3>Coesão da equipe</h3>
        <label>Nível <select value={level} onChange={event=>setLevel(event.target.value)}>
          <option value="keep">Manter atual</option><option value="60">Intermediário (60%)</option><option value="85">Alto (85%)</option><option value="100">Máximo (100%)</option>
        </select></label>
        <button disabled={!editor.editable||busy||level==="keep"||!targets.some(member=>member.cohesion!==null&&member.cohesion!==Number(level))}
          onClick={()=>void apply("maxCohesion")}>Aplicar coesão conferida</button>
      </div>
      <Meter value={team.cohesion}/>
      {members.length ? <details><summary>Jogadores e prévia · {targets.length} selecionado(s)</summary>
        <div className="club-toolbar">
          <button disabled={busy} onClick={()=>setExcluded(new Set())}>Selecionar todos</button>
          <button disabled={busy} onClick={()=>setExcluded(new Set(members.map(member=>member.uid)))}>Desmarcar todos</button>
        </div>
        <div className="trainer-table-scroll advanced-scroll"><table className="grid" aria-label="Prévia de coesão">
          <thead><tr><th>Seleção</th><th>Jogador</th><th>Coesão atual</th><th>Coesão proposta</th><th>Tática</th></tr></thead>
          <tbody>{members.map(member=><tr key={member.uid}>
            <td><input type="checkbox" aria-label={`Selecionar ${member.name}`} disabled={busy} checked={!excluded.has(member.uid)}
              onChange={event=>{
                const checked=event.target.checked;
                setExcluded(old=>{const next=new Set(old); if(checked)next.delete(member.uid);else next.add(member.uid);return next;});
              }}/></td><td>{member.name}</td>
            <td>{member.cohesion===null?member.reason??"Sem registro":`${member.cohesion}%`}</td>
            <td>{member.cohesion===null||level==="keep"||excluded.has(member.uid)?"—":`${level}%`}</td>
            <td>{member.tacticalRecord?"Registro encontrado":"Indisponível"}</td>
          </tr>)}</tbody>
        </table></div>
      </details> : null}
      <CohesionHistory key={`${club}:${team.index}:${summary?.session??""}`} club={club} team={team.index}/>
      <ClubCareToggle club={club} team={team.index}/>
    </>}
    {!summary&&!error&&<p>Lendo entendimento tático…</p>}
    {message&&<p role="status">{message}</p>}{error&&<p className="error" role="alert">{error}</p>}
  </section>;
}

export function ClubPartnerships({club,panel}:{club:number;panel:PanelIds}) {
  const editor=useContext(EditorContext);
  const [plan,setPlan]=useState<TrainingPlan|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const run=async(write:boolean)=>{
    setBusy(true);setError("");setMessage("");
    try {
      const next=await trainerCall<TrainingPlan>({cmd:write?"bonding_apply":"bonding_preview",club_uid:club});
      setPlan(next);
      if(write){setMessage(next.written_days?`Convívio programado em ${next.written_days} dias.`:"Nenhuma alteração: já há convívio nas semanas disponíveis ou não existe horário livre.");if(next.written_days)editor.onEdited()}
    }catch(e){setError(describeError(e))}finally{setBusy(false)}
  };
  return <section className="club-tools" role="tabpanel" id={panel.id} aria-labelledby={panel.labelledBy}>
    <h3>Parcerias em campo</h3>
    <p>Use o treino coletivo de convívio para trabalhar o entrosamento do elenco. Ele usa o calendário do time principal do clube selecionado no Trainer.</p>
    <p className="note">As linhas verdes no esquema tático mostram parcerias entre duplas. A edição direta dessas parcerias está indisponível nesta versão. O convívio usa sessões de treino do clube.</p>
    <div className="club-toolbar"><button disabled={busy} onClick={()=>void run(false)}>Ver plano de entrosamento</button><button disabled={busy||!editor.editable} onClick={()=>void run(true)}>Programar convívio agora</button></div>
    <p className="note">Adiciona no máximo uma sessão de convívio por semana, substituindo somente um horário de descanso futuro. Preserva dias de jogo, viagem e semanas de férias. A alteração do calendário pode ser desfeita no Trainer.</p>
    <ClubCareToggle club={club} team={0} relationships/>
    {plan&&<div className="club-bonding-weeks">{plan.weeks.map(week=><article key={week.start}><h4>Semana de {week.start.split("-").reverse().join("/")}</h4><span className="note">{week.rest?"Semana de descanso preservada":`${week.matches} jogo(s)`}</span>{week.days.filter(d=>d.planned.some(s=>/bond|convívio|entros|teamgeest/i.test(s))).map(d=><p key={d.date}>{d.date.split("-").reverse().join("/")} · Convívio da equipe</p>)}</article>)}</div>}
    {busy&&<p role="status">Lendo calendário do clube…</p>}{message&&<p role="status">{message}</p>}{error&&<p className="error" role="alert">{error}</p>}
  </section>;
}
