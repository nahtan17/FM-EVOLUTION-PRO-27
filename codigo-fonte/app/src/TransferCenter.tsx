import { confirmPendingNavigation, usePendingForm } from "./pendingEdits";
import {useCallback,useContext,useEffect,useState} from "react";
import {call} from "./api";
import {toPounds,toShown} from "./currency";
import {numberFromIso,undoChange} from "./editing";
import {currencySymbol,describeError,fold,formatDate,formatMoney,formatMoneyInput,normalizeMoneyInput,parseMoneyInput} from "./format";
import type {LoanDetails,PlayerSummary} from "./types";
import type {PanelIds} from "./ProfileParts";
import {EditorContext} from "./useProfileEditing";
import "./ClubTools.css";
export interface DealValues{fee:number;moveDay:number|null;wage:number|null;expires:number|null;contractType:number|null}
export interface TransferDeal{id:string;revision:string;number:number;player:number;name:string;fromClub:number|null;from:string;toClub:number;to:string;state:number;kind:number;loan:boolean;modality?:string;contractStart?:number|null;referenceDay?:number|null;feeNote?:string;dateNote?:string;values:DealValues;capabilities:{fee:boolean;contract:boolean;date:boolean;kind:boolean};note:string;installments:number;installmentDetails?:Installment[]|null;evidence?:TransferEvidence}
interface Installment {amount:number;months:number;intervalMonths:number}
interface TransferEvidence {game:string;identifiedTeams:boolean;openOffersWithNumber:number;linkedContracts:number;
 contractClass:string|null;schedulesWithNumber:number;writesAvailable:boolean;proposedDay:number|null}
interface LoanPortfolio {loans:{player:PlayerSummary;loan:LoanDetails}[];unread:number}
interface Preview{token:string;before:DealValues;after:DealValues;fields:number}
const states:Record<number,string>={0:"Aguardando clube",1:"Em negociação",2:"Recusada",5:"Clube aceitou",8:"Contrato em negociação",12:"Pronta para assinar",15:"Encerrada",19:"Confirmada",20:"Concluída"};
const visibleStates = new Set([0, 1, 5, 8, 12, 19]);
const kinds:Record<number,string>={0:"Meio período",1:"Integral",2:"Amador",3:"Formação",4:"Sem contrato",10:"Sênior MLS",11:"Sênior MLS"};
const iso=(day:number|null)=>day?`${String(day).slice(0,4)}-${String(day).slice(4,6)}-${String(day).slice(6,8)}`:"";
const date=(day:number|null)=>iso(day).split("-").reverse().join("/")||"—";
const inputs=(v:DealValues)=>({fee:formatMoneyInput(toShown(v.fee)),wage:v.wage===null?"":formatMoneyInput(toShown(v.wage)),moveDay:iso(v.moveDay),expires:iso(v.expires),contractType:v.contractType===null?"":String(v.contractType)});
const names:Record<keyof DealValues,string>={fee:"Valor à vista",wage:"Salário semanal",moveDay:"Data da transferência",expires:"Fim do contrato",contractType:"Tipo de contrato"};
const show=(key:keyof DealValues,value:number|null)=>value===null?"—":key==="fee"||key==="wage"?formatMoney(value):key==="contractType"?kinds[value]??`Tipo ${value}`:date(value);

function ClubLoans({club,version}:{club:number;version:number}) {
 const {openPlayer}=useContext(EditorContext);
 const [expanded,setExpanded]=useState(false);
 const [result,setResult]=useState<LoanPortfolio>();
 const [error,setError]=useState("");
 const [direction,setDirection]=useState("all");
 useEffect(()=>{
   if(!expanded)return;
   let active=true;setResult(undefined);setError("");
   void call<LoanPortfolio>("club_loan_portfolio",{club}).then(
     data=>{if(active)setResult(data);},
     reason=>{if(active)setError(describeError(reason));},
   );
   return()=>{active=false;};
 },[club,version,expanded]);
 const loans=result?.loans.filter(({loan})=>direction==="all"||(direction==="in"?loan.clubUid===club:loan.parentUid===club));
 return <details onToggle={event=>setExpanded(event.currentTarget.open)} className="transfer-filters">
   <summary>Gestor de empréstimos ativos</summary>
   <div className="club-toolbar"><label>Sentido <select aria-label="Sentido do empréstimo" value={direction} onChange={e=>setDirection(e.target.value)}>
     <option value="all">Entradas e saídas</option><option value="in">Entradas</option><option value="out">Saídas</option></select></label></div>
   {error&&<p className="error" role="alert">{error}</p>}
   {expanded&&!result&&!error&&<p role="status">Lendo empréstimos do plantel…</p>}
   {result&&result.unread>0&&<p className="note">{result.unread} registro(s) de empréstimo sem contrato confirmado.</p>}
   {loans?.length===0&&<p>Nenhum empréstimo ativo identificado neste filtro.</p>}
   {Boolean(loans?.length)&&<div className="transfer-list"><table className="grid" aria-label="Empréstimos ativos">
     <thead><tr><th>Jogador</th><th>De</th><th>Para</th><th>Vencimento</th><th>Opção de compra</th><th>Taxa mensal em uso</th><th>Taxa mensal sem uso</th></tr></thead>
     <tbody>{loans?.map(({player,loan})=><tr key={player.uid}>
       <td>{openPlayer?<button className="cell-button" onClick={()=>openPlayer(player)}>{player.name}</button>:player.name}</td>
       <td>{loan.parent??"—"}</td><td>{loan.club??"—"}</td><td>{loan.until?formatDate(loan.until):"—"}</td>
       {[loan.terms?.optionFee,loan.terms?.monthlyFee,loan.terms?.unusedFee].map((value,index)=>
         <td key={index}>{value==null?"—":formatMoney(value)}</td>)}
     </tr>)}</tbody>
   </table></div>}
 </details>;
}

function OfferEvidence({deal}:{deal:TransferDeal}) {
 const [message,setMessage]=useState("");
 const evidence=deal.evidence;
 if(!evidence)return null;
 const copy=async()=>{
   try {
     await navigator.clipboard.writeText(JSON.stringify({
       proposta:deal.number,jogador:deal.name,uid:deal.player,de:deal.from,para:deal.to,
       estado:deal.state,tipo:deal.kind,modalidade:deal.modality,campos:deal.values,permissoes:deal.capabilities,
       motivoValor:deal.feeNote,motivoData:deal.dateNote,evidencia:evidence,
     },null,2));
     setMessage("Diagnóstico copiado.");
   } catch (reason) { setMessage(describeError(reason)); }
 };
 return <details className="transfer-filters">
   <summary>Diagnóstico desta proposta</summary>
   <p className="note">{evidence.game} · estado {deal.state} · tipo {deal.kind}</p>
   <dl className="transfer-fields">
     <div><dt>Vínculo dos clubes</dt><dd>{evidence.identifiedTeams?"Identificado":"Inconclusivo"}</dd></div>
     <div><dt>Propostas abertas com este número</dt><dd>{evidence.openOffersWithNumber}</dd></div>
     <div><dt>Contratos compatíveis</dt><dd>{evidence.linkedContracts} · {evidence.contractClass??"sem classe confirmada"}</dd></div>
     <div><dt>Registros no agendamento</dt><dd>{evidence.schedulesWithNumber}</dd></div>
     <div><dt>Data no registro da proposta</dt><dd>{date(evidence.proposedDay)}</dd></div>
     <div><dt>Acesso à gravação</dt><dd>{evidence.writesAvailable?"Disponível na conexão":"Somente leitura"}</dd></div>
   </dl>
   <button onClick={()=>void copy()}>Copiar diagnóstico da proposta</button>
   {message&&<span role="status"> {message}</span>}
 </details>;
}

export function TransferCenter({club,version,panel}:{club:number;version:number;panel:PanelIds}){
 const editor=useContext(EditorContext);
 const [rows,setRows]=useState<TransferDeal[]>([]),[selected,setSelected]=useState<TransferDeal|null>(null);
 const [draft,setDraft]=useState<ReturnType<typeof inputs>|null>(null),[preview,setPreview]=useState<Preview|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const [query,setQuery]=useState(""),[direction,setDirection]=useState("all"),[closed,setClosed]=useState(false),[last,setLast]=useState<number|null>(null);
 const [type,setType]=useState(""),[state,setState]=useState(""),[when,setWhen]=useState(""),[minFee,setMinFee]=useState("");
 const keyOf=(row:TransferDeal)=>`${row.id}/${row.revision}`;
 const choose=(row:TransferDeal)=>{setSelected(row);setDraft(inputs(row.values));setPreview(null);setError("")};
 const selectedId = selected?.id;
 const selectedRevision = selected?.revision;
 const load = useCallback(async () => {
   setBusy(true);
   try {
     const next = await call<TransferDeal[]>("transfer_center", { club });
     const matches = next.filter(item => item.id === selectedId);
     const row = matches.length === 1 ? matches[0] : matches.find(item => item.revision === selectedRevision) ?? null;
     setRows(next);
     setSelected(row);
     setDraft(row ? inputs(row.values) : null);
     setPreview(null);
     setError("");
   } catch (e) { setError(describeError(e)); }
   finally { setBusy(false); }
 }, [club, selectedId, selectedRevision]);
 useEffect(()=>{let alive=true;setBusy(true);call<TransferDeal[]>("transfer_center",{club}).then(next=>{if(alive){setRows(next);setError("")}},e=>alive&&setError(describeError(e))).finally(()=>alive&&setBusy(false));return()=>{alive=false}},[club,version]);
 const stale=Boolean(selected&&!rows.some(r=>r.id===selected.id&&r.revision===selected.revision));
 const modality = (row:TransferDeal) => row.modality ?? (row.loan ? "Empréstimo" : "Transferência");
 const amount = minFee ? parseMoneyInput(minFee) : null;
 const listed = rows.filter(row => (closed || visibleStates.has(row.state))
   && (direction === "all" || (direction === "in" ? row.toClub === club : row.fromClub === club))
   && (!type || modality(row) === type) && (!state || row.state === Number(state))
   && (!when || iso(row.values.moveDay ?? row.referenceDay ?? null) === when)
   && (amount === null || toShown(row.values.fee) >= amount)
   && fold(`${row.name} ${row.from} ${row.to} ${row.number} ${row.id}`).includes(fold(query.trim())));
 const dirty = Boolean(selected && draft && JSON.stringify(draft) !== JSON.stringify(inputs(selected.values)));
 const collect = () => {
   if (!selected || !draft || stale) throw Error("A proposta mudou. Atualize os dados antes de salvar.");
   if (!editor.editable) throw Error(editor.readOnlyNote || "A conexão está somente para leitura.");
   const edit: Partial<DealValues> = {};
   const before = inputs(selected.values);
   const { fee, contract, date, kind } = selected.capabilities;
   const allowed = { fee, moveDay: date, wage: contract, expires: contract, contractType: kind };
   for (const key of Object.keys(draft) as (keyof DealValues)[]) {
     if (draft[key] === before[key]) continue;
     if (!allowed[key]) throw Error(names[key] + " está disponível somente para leitura.");
     const raw = draft[key];
     const money = key === "fee" || key === "wage";
     const value = money ? parseMoneyInput(raw)
       : key === "contractType" ? (/^\d+$/.test(raw) ? Number(raw) : null)
       : numberFromIso(raw);
     if (value === null || value < 0) throw Error("Confira o campo " + names[key] + ".");
     const current = selected.values[key];
     if (money && current !== null && value === toShown(current)) continue;
     const stored = money ? toPounds(value) : value;
     if (stored !== current) edit[key] = stored;
   }
   if (!Object.keys(edit).length) throw Error("Nenhuma alteração para aplicar.");
   return edit;
 };
 const plan = () => {
   const edit = collect();
   return call<Preview>("preview_transfer_deal", { club, id: selected!.id, revision: selected!.revision, edit });
 };
 const check = async () => {
   setBusy(true);
   setError("");
   setMessage("");
   try {
     setPreview(await plan());
   } catch (err) {
     setError(describeError(err));
   } finally {
     setBusy(false);
   }
 };
 const apply = async () => {
   if (!selected || !dirty || busy || stale || !editor.editable) return false;
   setBusy(true);
   setError("");
   setMessage("");
   try {
     // Revalidate against the current offer immediately before applying, including after a manual preview.
     const validated = await plan();
     const { change, deal } = await call<{ change: number; deal: TransferDeal }>("apply_transfer_deal", { token: validated.token });
     setLast(change);
     setRows(previous => previous.map(row => row.id === deal.id ? deal : row));
     choose(deal);
     setMessage("Proposta atualizada.");
     editor.onEdited();
     return true;
   } catch (err) {
     setError(describeError(err));
     setPreview(null);
     return false;
   } finally {
     setBusy(false);
   }
 };
 usePendingForm({ count: dirty ? 1 : 0, busy, validate: collect, save: apply });
 const select=(row:TransferDeal)=>{if(!busy&&(!selected||keyOf(row)!==keyOf(selected)||stale)&&(!dirty||confirmPendingNavigation(true)))choose(row)};
 const change=(key:keyof DealValues,value:string)=>{setDraft(d=>d?{...d,[key]:value}:d);setPreview(null);setMessage("")};
 return <section className="club-tools transfer-center" role="tabpanel" id={panel.id} aria-labelledby={panel.labelledBy}>
  <div className="club-toolbar"><h3>Centro de Transferências</h3><button disabled={busy} onClick={()=>{if(!dirty||confirmPendingNavigation(true)){void load()}}}>Atualizar propostas</button></div>
  <ClubLoans key={club} club={club} version={version}/>
  <div className="club-toolbar"><input aria-label="Buscar proposta" placeholder="Jogador, clube ou nº da proposta" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Sentido da transferência" value={direction} onChange={e=>setDirection(e.target.value)}><option value="all">Entradas e saídas</option><option value="in">Entradas</option><option value="out">Saídas</option></select><label><input type="checkbox" checked={closed} onChange={e=>setClosed(e.target.checked)}/> Mostrar encerradas</label></div>
  <details className="transfer-filters"><summary>Mais filtros</summary><div className="club-toolbar">
   <label>Tipo <select value={type} onChange={e=>setType(e.target.value)}><option value="">Todos</option>
    {[...new Set(rows.map(modality))].sort().map(value=><option key={value}>{value}</option>)}</select></label>
   <label>Situação <select value={state} onChange={e=>setState(e.target.value)}><option value="">Todas</option>
    {[...new Set(rows.map(row=>row.state))].sort((a,b)=>a-b).map(value=><option key={value} value={value}>{states[value]??`Estado ${value}`}</option>)}</select></label>
   <label>Data exibida <input type="date" value={when} onChange={e=>setWhen(e.target.value)}/></label>
   <label>Valor à vista mínimo ({currencySymbol}) <input inputMode="decimal" value={minFee} onChange={e=>setMinFee(e.target.value)}/></label>
  </div></details>
  <div className="transfer-list"><table className="grid"><thead><tr><th>Tipo</th><th>Jogador</th><th>De</th><th>Para</th><th>Valor à vista</th><th>Data da proposta</th><th>Transferência</th><th>Situação</th></tr></thead><tbody>
   {listed.map(row => <tr key={keyOf(row)} className={selected && keyOf(selected) === keyOf(row) ? "selected" : ""} tabIndex={0}
    aria-selected={Boolean(selected && keyOf(selected) === keyOf(row))} onClick={()=>select(row)}
    onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();select(row)}}}>
    <td>{modality(row)}</td><td>{row.name} <small className="muted">#{row.number}</small></td><td>{row.from}</td><td>{row.to}</td>
    <td>{formatMoney(row.values.fee)}</td><td>{date(row.referenceDay ?? null)}</td><td>{date(row.values.moveDay)}</td><td>{states[row.state]??`Estado ${row.state}`}</td>
   </tr>)}
  </tbody></table></div>
  {!busy&&!listed.length&&!error&&<p>Nenhuma proposta encontrada com estes filtros.</p>}
  {selected&&draft&&<div className="transfer-form"><h3>{selected.name} · Proposta {selected.number}</h3><p className="note">{editor.editable ? selected.note : editor.readOnlyNote || selected.note}</p>{stale&&<p role="alert" className="error">Esta proposta mudou. Selecione a linha atualizada antes de editar.</p>}
   <div className="transfer-fields"><label>Valor à vista ({currencySymbol})<input aria-label="Valor à vista da proposta" type="text" inputMode="decimal" disabled={busy||stale||!editor.editable||!selected.capabilities.fee} className={draft.fee!==inputs(selected.values).fee?"edit-input changed":undefined} value={draft.fee} onChange={e=>change("fee",e.target.value)} onBlur={e=>{const v=normalizeMoneyInput(e.currentTarget.value);if(v!==e.currentTarget.value)change("fee",v)}}/>{selected.feeNote && <small className="muted">{selected.feeNote}</small>}</label><label>Data da transferência<input aria-label="Data da transferência" type="date" disabled={busy||stale||!editor.editable||!selected.capabilities.date} className={draft.moveDay!==inputs(selected.values).moveDay?"edit-input changed":undefined} value={draft.moveDay} onChange={e=>change("moveDay",e.target.value)}/>{selected.dateNote && <small className="muted">{selected.dateNote}</small>}</label>
   <label>Salário semanal ({currencySymbol})<input aria-label="Salário do contrato futuro" type="text" inputMode="decimal" disabled={busy||stale||!editor.editable||!selected.capabilities.contract} className={draft.wage!==inputs(selected.values).wage?"edit-input changed":undefined} value={draft.wage} onChange={e=>change("wage",e.target.value)} onBlur={e=>{const v=normalizeMoneyInput(e.currentTarget.value);if(v!==e.currentTarget.value)change("wage",v)}}/></label><label>Fim do contrato<input aria-label="Fim do contrato futuro" type="date" disabled={busy||stale||!editor.editable||!selected.capabilities.contract} className={draft.expires!==inputs(selected.values).expires?"edit-input changed":undefined} value={draft.expires} onChange={e=>change("expires",e.target.value)}/></label><label>Tipo de contrato<select aria-label="Tipo do contrato futuro" disabled={busy||stale||!editor.editable||!selected.capabilities.kind} className={draft.contractType!==inputs(selected.values).contractType?"edit-input changed":undefined} value={draft.contractType} onChange={e=>change("contractType",e.target.value)}><option value="">Indisponível</option>{Object.entries(kinds).map(([key,value])=><option value={key} key={key}>{value}</option>)}{draft.contractType&&!kinds[Number(draft.contractType)]&&<option value={draft.contractType}>Tipo {draft.contractType}</option>}</select></label></div>
   {selected.contractStart != null && <p className="note">Início do contrato no jogo: {date(selected.contractStart)}.</p>}
   <p className="note">O valor editável corresponde à parcela à vista.</p>
   {selected.installmentDetails?.length ? <table className="grid transfer-preview" aria-label="Parcelamento da proposta">
     <thead><tr><th>Total parcelado</th><th>Duração</th><th>Intervalo</th></tr></thead>
     <tbody>{selected.installmentDetails.map((item,index)=><tr key={index}><td>{formatMoney(item.amount)}</td>
       <td>{item.months} meses</td><td>A cada {item.intervalMonths} meses</td></tr>)}</tbody>
   </table> : null}
   <OfferEvidence key={keyOf(selected)} deal={selected}/>
   <div className="club-toolbar"><button disabled={busy||stale||!editor.editable||!dirty} onClick={()=>void check()}>Conferir alterações</button><button className="primary" disabled={busy||stale||!editor.editable||!dirty} onClick={()=>void apply()}>Aplicar na proposta</button></div>
   {preview&&<table className="grid transfer-preview" aria-label="Prévia das alterações"><thead><tr><th>Campo</th><th>Atual</th><th>Novo</th></tr></thead><tbody>{(Object.keys(names) as (keyof DealValues)[]).filter(k=>preview.before[k]!==preview.after[k]).map(k=><tr key={k}><td>{names[k]}</td><td>{show(k,preview.before[k])}</td><td>{show(k,preview.after[k])}</td></tr>)}</tbody></table>}
  </div>}
  {busy&&<p role="status">Lendo ou atualizando propostas… A primeira leitura pode demorar.</p>}{message&&<p role="status">{message}</p>}{error&&<p className="error" role="alert">{error}</p>}
  {last!==null&&<button disabled={busy||!editor.editable} onClick={()=>{setBusy(true);void undoChange(last).then(()=>{setLast(null);setMessage("Alteração da proposta desfeita.");editor.onEdited();return load()}).catch(e=>setError(describeError(e))).finally(()=>setBusy(false))}}>Desfazer última alteração da proposta</button>}
 </section>;
}
