// Browser-only fixtures. The Windows application dispatches to the native Rust commands.
import type {TransferDeal,DealValues} from "../TransferCenter";
import type {ExtraView} from "../ClubExtras";
import type {SponsorView,SponsorRow} from "../SponsorEditor";
let serial=900000,pending:{token:string;row:TransferDeal;after:DealValues}|null=null;
const undo=new Map<number,()=>void>();
const transfers=new Map<number,TransferDeal[]>(),extras=new Map<number,ExtraView>(),sponsors=new Map<number,SponsorView>();
function log(back:()=>void){const change=serial++;undo.set(change,back);return {change}}
function deals(club:number){if(!transfers.has(club)){const caps={fee:true,contract:true,date:true,kind:true};const values={fee:2000000,moveDay:20270701,wage:2500,expires:20300630,contractType:1};transfers.set(club,[{id:"90001-21-101",revision:"1",number:21,player:90001,name:"Jogador confirmado de demonstração",fromClub:club,from:"Clube acompanhado",toClub:999,to:"Clube comprador",state:19,kind:2,loan:false,values:{...values},capabilities:{...caps},note:"Dados fictícios: proposta, contrato e agendamento simulados.",installments:1},{id:"90002-22-102",revision:"1",number:22,player:90002,name:"Jogador com proposta de demonstração",fromClub:club,from:"Clube acompanhado",toClub:998,to:"Outro comprador",state:0,kind:2,loan:false,values:{...values,moveDay:null,wage:null,expires:null,contractType:null},capabilities:{fee:true,contract:false,date:false,kind:false},note:"Contrato futuro ainda não existe.",installments:0},{id:"90003-23-103",revision:"1",number:23,player:90003,name:"Transferência encerrada de demonstração",fromClub:997,from:"Outro clube",toClub:club,to:"Clube acompanhado",state:20,kind:2,loan:false,values:{...values},capabilities:{fee:false,contract:false,date:false,kind:false},note:"Proposta encerrada: somente leitura.",installments:0}])}return transfers.get(club)!}
function clubExtras(club:number){if(!extras.has(club)){const spec:[string,string,number,number,number][]=[["AverageAttendance","Público médio",80000,0,1000000],["MinimumAttendance","Público mínimo",50000,0,1000000],["MaximumAttendance","Público máximo",100000,0,1000000],["Status","Situação",1,1,3],["Morale","Moral do clube",18,0,20],["ChairmanStatus","Status do presidente",6426,0,10000],["YearFounded","Ano de fundação",1895,0,2300],["YouthImportance","Importância da juventude",15,0,20],["SocialMediaFollowers","Seguidores nas redes sociais",8517606,-1,2147483647],["OwnershipType","Tipo de propriedade",3,0,255],["ChairpersonTitle","Título do presidente",2,0,255]];extras.set(club,{revision:"1",fields:[...spec.map(([key,label,value,min,max])=>({key,label,value,min,max,kind:"int32",group:"overview"})),{key:"BackgroundColour",label:"Cor de fundo",value:0xffd72020,min:0,max:0xffffffff,kind:"colour",group:"overview"},{key:"staff_0",label:"Preparadores — Principal",value:0,min:0,max:10,kind:"byte",group:"staff"}]})}return extras.get(club)!}
function sponsorList(club:number){if(!sponsors.has(club))sponsors.set(club,{revision:"1",editable:true,today:{year:2026,month:10,day:17},rows:[{index:0,kind:1,total:10000000,perSeason:2500000,start:20250701,end:20290630,percent:0,renew:true,fixed:false},{index:1,kind:3,total:20000000,perSeason:4000000,start:20260701,end:20310630,percent:10,renew:false,fixed:true}]});return sponsors.get(club)!}
export function mockV4Undo(id:number):unknown|undefined{const back=undo.get(id);if(!back)return undefined;back();undo.delete(id);return {id,undoneAt:Date.now()}}
export async function mockToolsV4(command:string,args:Record<string,unknown>={}):Promise<unknown>{
 await new Promise(r=>setTimeout(r,45));const club=Number(args.club);
 if(command==="rating_context")return {save:"preview-fictional-career",connection:"preview-v4"};
 if(command==="transfer_center")return structuredClone(deals(club));
 if(command==="preview_transfer_deal"){
  const row=deals(club).find(r=>r.id===args.id);if(!row||row.revision!==args.revision)throw Error("A proposta mudou. Atualize a lista.");const edit=args.edit as Partial<DealValues>;if(!Object.keys(edit).length)throw Error("Nenhuma alteração para aplicar.");
  if(row.state===20)throw Error("Proposta encerrada.");const after={...row.values,...edit};if(after.fee<0||after.fee>2147483647)throw Error("Valor fora do limite.");if(edit.moveDay!==undefined&&(!row.capabilities.date||edit.moveDay!<=20261017))throw Error("Data indisponível ou anterior ao dia atual.");if(after.moveDay&&after.expires&&after.expires<=after.moveDay)throw Error("O contrato precisa terminar depois da transferência.");
  const token=`preview-${serial++}`;pending={token,row,after};return {token,before:row.values,after,fields:Object.keys(edit).length};
 }
 if(command==="apply_transfer_deal"){
  if(!pending||pending.token!==args.token)throw Error("Prévia expirada.");const {row,after}=pending;pending=null;const before=structuredClone(row);const result=log(()=>Object.assign(row,before));row.values=after;row.revision=String(Number(row.revision)+1);return {...result,deal:structuredClone(row)};
 }
 if(command==="club_extra_view")return structuredClone(clubExtras(club));
 if(command==="set_club_extra"){
  const view=clubExtras(club);if(args.revision!==view.revision)throw Error("Os dados mudaram. Atualize antes de salvar.");const changes=args.values as Record<string,number>,values=Object.fromEntries(view.fields.map(f=>[f.key,f.value]));Object.assign(values,changes);if(values.MinimumAttendance>values.AverageAttendance||values.AverageAttendance>values.MaximumAttendance)throw Error("Mantenha público mínimo ≤ médio ≤ máximo.");
  const before=structuredClone(view);for(const [key,value] of Object.entries(changes)){const field=view.fields.find(f=>f.key===key);if(!field||value<field.min||value>field.max)throw Error("Valor fora do limite.");field.value=value}view.revision=String(Number(view.revision)+1);return log(()=>extras.set(club,before));
 }
 if(command==="sponsor_editor")return structuredClone(sponsorList(club));
 if(command==="set_sponsor"){
  const view=sponsorList(club);if(args.revision!==view.revision)throw Error("A lista mudou. Atualize antes de salvar.");const before=structuredClone(view),input=args.input as SponsorRow;
  if(args.action!=="remove"&&(!input||input.total<0||input.perSeason<0||input.start>input.end))throw Error("Valores ou datas inválidos.");
  if(args.action==="remove")view.rows=view.rows.filter(r=>r.index!==Number(args.index));else if(args.action==="add")view.rows.push({...input,index:view.rows.length});else{const at=view.rows.findIndex(r=>r.index===Number(args.index));if(at<0)throw Error("Patrocínio não encontrado.");view.rows[at]={...input,index:Number(args.index)}}view.rows.forEach((r,i)=>r.index=i);view.revision=String(Number(view.revision)+1);return log(()=>sponsors.set(club,before));
 }
 throw Error("Comando não simulado: "+command);
}
