import { confirmPendingNavigation, usePendingForm } from "./pendingEdits";
import {useContext,useEffect,useState} from "react";
import {call} from "./api";
import {toShown,toPounds} from "./currency";
import {currencySymbol,describeError,formatMoney,formatMoneyInput,normalizeMoneyInput,parseMoneyInput} from "./format";
import {undoChange} from "./editing";
import {EditorContext} from "./useProfileEditing";
export const SPONSOR_KINDS:Record<number,string>={1:"Patrocinador do uniforme",3:"Estádio",4:"Patrocínio geral",5:"Acordo individual de TV",7:"Sócio-torcedor",8:"Uniforme de visitante",9:"Patrocínio adicional de uniforme",11:"Costas da camisa",12:"Calções",13:"Uniforme de treino",14:"Equipe de base",15:"Campo de treinos",16:"Competição continental",19:"Manga da camisa",22:"Fabricante de uniformes",23:"Estádio (outro acordo)"};
export interface SponsorRow{index:number;kind:number;total:number;perSeason:number;start:number;end:number;percent:number;renew:boolean|null;fixed:boolean|null}
export interface SponsorView{revision:string;rows:SponsorRow[];editable:boolean;today?:{year:number;month:number;day:number}|null}
const iso=(n:number)=>n?`${String(n).slice(0,4)}-${String(n).slice(4,6)}-${String(n).slice(6,8)}`:"";
type Draft={kind:string;total:string;perSeason:string;start:string;end:string;percent:string;renew:boolean;fixed:boolean};
const form=(r:SponsorRow):Draft=>({kind:String(r.kind),total:formatMoneyInput(toShown(r.total)),perSeason:formatMoneyInput(toShown(r.perSeason)),start:iso(r.start),end:iso(r.end),percent:String(r.percent),renew:r.renew??false,fixed:r.fixed??false});
export function SponsorEditor({club}:{club:number}){
 const editor=useContext(EditorContext);const [view,setView]=useState<SponsorView|null>(null),[index,setIndex]=useState<number|null>(null),[draft,setDraft]=useState<Draft|null>(null),[adding,setAdding]=useState(false),[removing,setRemoving]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[last,setLast]=useState<number|null>(null);
 const read=async()=>{try{const v=await call<SponsorView>("sponsor_editor",{club});setView(v);setDraft(null);setIndex(null);setAdding(false);setRemoving(false);setError("")}catch(e){setError(describeError(e))}};
 useEffect(()=>{void read()},[club]);
 const choose=(row:SponsorRow)=>{setIndex(row.index);setDraft(form(row));setAdding(false);setRemoving(false);setError("")};
 const add=()=>{const d=view?.today;const start=d?`${d.year}-${String(d.month).padStart(2,"0")}-${String(d.day).padStart(2,"0")}`:"";setIndex(null);setAdding(true);setDraft({kind:"1",total:"",perSeason:"",start,end:d?`${d.year+3}-06-30`:"",percent:"0",renew:false,fixed:false});setRemoving(false);setError("")};
 const prior=view?.rows.find(row=>row.index===index);
 const dirty=Boolean(draft&&(adding||prior&&JSON.stringify(draft)!==JSON.stringify(form(prior))));
 const collect=()=>{
   if(!draft)throw Error("Selecione um patrocínio.");
   const amounts = (["total", "perSeason"] as const).map(key => {
     const amount = parseMoneyInput(draft[key]);
     if (amount === null || amount < 0) throw Error("Preencha os valores do patrocínio com números válidos.");
     return prior && amount === toShown(prior[key]) ? prior[key] : toPounds(amount);
   });
   const [total, perSeason] = amounts;
   if (!draft.percent.trim() || !Number.isInteger(Number(draft.percent)) || Number(draft.percent) < 0) {
     throw Error("Preencha a variação do patrocínio com um percentual válido.");
   }
   if(!draft.start||!draft.end)throw Error("Preencha as datas do patrocínio.");
   return {kind:Number(draft.kind),total,perSeason,start:Number(draft.start.replace(/-/g,"")),end:Number(draft.end.replace(/-/g,"")),percent:Number(draft.percent),renew:prior?.renew===null?null:draft.renew,fixed:prior?.fixed===null?null:draft.fixed};
 };
 const save=async(action:"add"|"update"|"remove")=>{
  if(!view||!draft||!editor.editable)return false;
  setBusy(true);setError("");
  try{
   const input=action==="remove"?null:collect();
  const result=await call<{change:number}>("set_sponsor",{club,revision:view.revision,action,index,input});setLast(result.change);setMessage(action==="add"?"Patrocínio adicionado.":action==="remove"?"Patrocínio removido.":"Patrocínio atualizado.");editor.onEdited();await read();return true;
 }catch(e){setError(describeError(e));return false}finally{setBusy(false)}};
 usePendingForm({count:dirty?1:0,busy,validate:collect,save:()=>save(adding?"add":"update")});
 const change=(key:keyof Draft,value:string|boolean)=>{setDraft(d=>d?{...d,[key]:value}:d);setRemoving(false);setMessage("")};
 return <section className="club-tools sponsor-editor"><div className="club-toolbar"><h3>Patrocínios e outros</h3><button disabled={busy||!editor.editable||!view?.editable} onClick={()=>{if(!dirty||confirmPendingNavigation(true))add()}}>Adicionar patrocínio</button><button disabled={busy} onClick={()=>{if(!dirty||confirmPendingNavigation(true))void read()}}>Atualizar patrocínios</button></div>
 <div className="transfer-list"><table className="grid" aria-label="Patrocínios do clube"><thead><tr><th>Tipo de receita</th><th>Valor total</th><th>Por temporada</th><th>Início</th><th>Fim</th></tr></thead><tbody>{view?.rows.map(r=><tr key={r.index} tabIndex={0} className={index===r.index?"selected":""} onClick={()=>{if(index!==r.index&&(!dirty||confirmPendingNavigation(true)))choose(r)}} onKeyDown={e=>{if(e.key==="Enter"&&index!==r.index&&(!dirty||confirmPendingNavigation(true))){choose(r)}}}><td>{SPONSOR_KINDS[r.kind]??`Tipo ${r.kind}`}</td><td>{formatMoney(r.total)}</td><td>{formatMoney(r.perSeason)}</td><td>{iso(r.start).split("-").reverse().join("/")}</td><td>{iso(r.end).split("-").reverse().join("/")}</td></tr>)}</tbody></table></div>
 {view&&!view.rows.length&&<p>Nenhum patrocínio identificado neste clube.</p>}{draft&&<div className="transfer-form"><h3>{adding?"Novo patrocínio":"Detalhes do patrocínio"}</h3><div className="transfer-fields"><label>Tipo de receitas<select aria-label="Tipo de patrocinador" value={draft.kind} disabled={busy||!editor.editable} onChange={e=>change("kind",e.target.value)}>{!SPONSOR_KINDS[Number(draft.kind)]&&<option value={draft.kind}>Tipo {draft.kind}</option>}{Object.entries(SPONSOR_KINDS).map(([id,label])=><option value={id} key={id}>{label}</option>)}</select></label>
 <label>Valor total ({currencySymbol})<input aria-label="Valor total do patrocínio" type="text" inputMode="decimal" value={draft.total} onChange={e=>change("total",e.target.value)} onBlur={e=>{const v=normalizeMoneyInput(e.currentTarget.value);if(v!==e.currentTarget.value)change("total",v)}} disabled={busy||!editor.editable}/></label><label>Valor por temporada ({currencySymbol})<input aria-label="Valor do patrocínio por temporada" type="text" inputMode="decimal" value={draft.perSeason} onChange={e=>change("perSeason",e.target.value)} onBlur={e=>{const v=normalizeMoneyInput(e.currentTarget.value);if(v!==e.currentTarget.value)change("perSeason",v)}} disabled={busy||!editor.editable}/></label><label>Data de início<input aria-label="Início do patrocínio" type="date" value={draft.start} onChange={e=>change("start",e.target.value)} disabled={busy||!editor.editable}/></label><label>Data de fim<input aria-label="Fim do patrocínio" type="date" value={draft.end} onChange={e=>change("end",e.target.value)} disabled={busy||!editor.editable}/></label><label>Variação por acesso/rebaixamento (%)<input aria-label="Variação do patrocínio" type="number" min="0" max="100" value={draft.percent} onChange={e=>change("percent",e.target.value)} disabled={busy||!editor.editable}/></label></div>
 <div className="club-toolbar"><label><input type="checkbox" checked={draft.renew} disabled={busy||!editor.editable||(index!==null&&view?.rows.find(r=>r.index===index)?.renew===null)} onChange={e=>change("renew",e.target.checked)}/> Renovar receitas</label><label><input type="checkbox" checked={draft.fixed} disabled={busy||!editor.editable||(index!==null&&view?.rows.find(r=>r.index===index)?.fixed===null)} onChange={e=>change("fixed",e.target.checked)}/> Valor fixo</label>{!adding&&<button disabled={busy||!editor.editable} onClick={()=>setRemoving(true)}>Remover patrocínio</button>}</div>
 {removing&&<div className="club-toolbar" role="alert"><span>Remover este contrato da lista do clube?</span><button disabled={busy} onClick={()=>void save("remove")}>Confirmar remoção do patrocínio</button><button onClick={()=>setRemoving(false)}>Cancelar</button></div>}</div>}
 <p className="note">A receita registrada segue o processamento do jogo. Confira o resultado no FM após avançar a data.</p>{error&&<p className="error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}{last!==null&&<button disabled={busy||!editor.editable} onClick={()=>{setBusy(true);void undoChange(last).then(()=>{setLast(null);setMessage("Alteração de patrocínio desfeita.");editor.onEdited();return read()}).catch(e=>setError(describeError(e))).finally(()=>setBusy(false))}}>Desfazer alteração do patrocínio</button>}
 </section>;
}
