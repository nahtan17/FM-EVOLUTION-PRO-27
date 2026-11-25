// Sample data for the browser preview only; native builds call the real Rust engine.
import { DEFAULT_SETTINGS, defaultEffectiveness, type Effectiveness, type TrainerPlayer, type TrainerStatus, type TrainingPlan, type TrainerAutomation } from "../trainerApi";
let eff = defaultEffectiveness();
let automation:TrainerAutomation={generation:0,event:0,error:""};
type DemoDate = { year: number; month: number; day: number };
type DemoReport = { uid: number; name: string; natural: number; bonus: number; guaranteedGain: number; caBefore: number; ca: number; pa: number;
  week: DemoDate; status: string; growthReason: string | null; attributes: {key: string; shown: number}[] };
let reportPending: DemoReport[] = [];
let development = {
  active: false, multiplier: 1, tracked: 0, boosted: 0, event: 0,
  guaranteedWeeklyGrowth: false,
  team: null as number | null, weeklyLimit: null as number | null,
  club: null as number | null,
  lastDate: null as DemoDate | null, reportDate: null as DemoDate | null, report: [] as DemoReport[], error: null,
};

export function mockDevelopment(command: string, args?: Record<string, unknown>) {
  const candidates = squad.map((player,index) => ({
    uid:player.uid, name:player.name, age:16+index, born:{ year:2010-index, month:1, day:1 }, ability:95+index, potential:150+index,
    club: status.club.name, positions: [index === 0 ? "gk" : index % 2 ? "mc" : "st"],
    eligible: true, reason: null,
  })).filter(row=>args?.team!==1 || row.age<=20);
  if (command === "development_preview") return candidates;
  if (command === "development_set") {
    const multiplier = Number(args?.multiplier);
    const weeklyLimit = typeof args?.weeklyLimit === "number" ? args.weeklyLimit : null;
    const guaranteedWeeklyGrowth = args?.guaranteedWeeklyGrowth === true;
    const included = candidates.filter(row => row.eligible &&
      (Array.isArray(args?.selectedPlayers) && args.selectedPlayers.includes(row.uid)));
    const active = multiplier > 1 || guaranteedWeeklyGrowth;
    reportPending = active ? included.map((row, index) => {
      const natural = index % 2;
      const caBefore = row.ability + natural;
      const total = Math.max(natural * multiplier, guaranteedWeeklyGrowth ? multiplier : 0);
      const bonus = Math.min(total - natural, weeklyLimit ?? 200, row.potential - caBefore);
      const guaranteedGain = guaranteedWeeklyGrowth && !natural ? bonus : 0;
      return { uid: row.uid, name: row.name, natural, bonus, guaranteedGain, caBefore, ca: caBefore + bonus, pa: row.potential,
        week: { year: 2026, month: 11, day: 23 }, status: bonus ? "Evolução aplicada" : "Sem alteração",
        growthReason: bonus ? natural ? "Amplificação do ganho natural" : "Crescimento semanal garantido" : null,
        attributes: bonus && natural ? [{key:"passing",shown:1}] : [] };
    }) : [];
    development = { ...development, active, multiplier, guaranteedWeeklyGrowth, report: [],
      club: Number(args?.club), team: typeof args?.team === "number" ? args.team : null, weeklyLimit,
      tracked: active ? included.length : 0,
      lastDate: active ? { year: 2026, month: 11, day: 20 } : null,
    };
  } else if (reportPending.length) {
    const date = reportPending[0].week;
    const boosted = reportPending.filter(row => row.bonus > 0).length;
    development = { ...development, report:reportPending, reportDate:date,lastDate:date,
      boosted,event:development.event + Number(boosted > 0) };
    reportPending = [];
  }
  return { ...development };
}
const demoSessions: [number,string][] = [[0,"Passing Style"],[3,"In Possession Shape"],[100,"Press Avoidance"],[106,"Corners"],
  [200,"Individual Development"],[300,"Rest"],[301,"Recovery"],[400,"Team Bonding"]];
const demoCalendar = new Map<string, number[]>();
const sessionLabel = (code:number) => demoSessions.find(entry=>entry[0]===code)?.[1] ?? "Match";
const squad: TrainerPlayer[] = Array.from({length:18},(_,i)=>({uid:90000+i,name:["Bruno Silva","Lucas Pereira","Rafael Costa","Pedro Souza","João Alves"][i%5]+(i>=5?` ${i+1}`:""),morale:12+i%5,condition:8500+i*50,sharpness:8000,injuries:i===2?[{name:"Lesão de demonstração"}]:[],bans:i===3?1:0}));
const status: TrainerStatus = {club:{uid:27,name:"Clube de demonstração"},ping:{pid:2700,known_build:true,untested_writes:false,build_label:"Dados fictícios do navegador"},flags:{supported:true,registration_anytime:false,numbers_anytime:false},squad,understanding:{team:{PassingStyle:6500,BuildUp:7200,ChanceCreation:5500,InPossessionShape:8000,LineOfEngagement:6100,PressingIntensity:7500,PressingTrap:6800,OutOfPossessionShape:7000},without_record:0},teams:{managers:[
  {club_uid:27,club:"Clube de demonstração",selected:true},
  {club_uid:50,club:"Segundo clube de demonstração",selected:false},
],teams:[
  {index:0,kind:0,age_limit:100,players:18,own:true,selected:true},
  {index:1,kind:1,age_limit:20,players:17,own:false,selected:false},
]},context:"2700:27:0",warnings:[]};
export async function mockTrainer(request: Record<string, unknown>): Promise<unknown> {
  await new Promise(r=>setTimeout(r,80));
  const cmd=request.cmd;
  if(cmd==="automation_state")return structuredClone(automation);
  if(cmd==="automation_config"){
    const generation=automation.generation+1;
    automation={...automation,generation,error:""};
    if(request.training||request.understanding||request.read_screen){
      void (async()=>{
        let effectiveness=(request.effectiveness as Effectiveness)??eff;
        if(request.read_screen)effectiveness=((await mockTrainer({cmd:"read_screen"})) as {effectiveness:Effectiveness}).effectiveness;
        if(request.understanding)await mockTrainer({cmd:"max_understanding"});
        const plan=request.training?await mockTrainer({...request,cmd:"training_apply"}) as TrainingPlan:null;
        if(automation.generation===generation)automation={generation,event:automation.event+1,error:"",effectiveness,settings:request.settings as typeof DEFAULT_SETTINGS,plan,understanding:status.understanding,last_check:Date.now(),changed:Boolean(plan?.written_days||request.understanding),activity:"Verificação automática simulada concluída."};
      })().catch(e=>{if(automation.generation===generation)automation={...automation,error:String(e)}});
    }
    return structuredClone(automation);
  }
  if(cmd==="status")return structuredClone(status);
  if(cmd==="select"&&status.teams){
    if(typeof request.club==="number"){
      for(const manager of status.teams.managers)manager.selected=manager.club_uid===request.club;
      const selected=status.teams.managers.find(manager=>manager.selected);
      if(selected)status.club={uid:selected.club_uid,name:selected.club};
    }
    const index=typeof request.team==="number"?request.team:0;
    for(const team of status.teams.teams)team.selected=team.index===index;
    status.context=[2700,status.club.uid,index].join(":");
    return structuredClone(status.teams);
  }
  if(cmd==="effectiveness")return structuredClone(eff);
  if(cmd==="save_effectiveness"){eff=structuredClone(request.effectiveness as Effectiveness);return eff;}
  if(cmd==="read_screen"||cmd==="read_image"){eff={...defaultEffectiveness(),factors:defaultEffectiveness().factors.map(([k],i)=>[k,40+(i*7)%55]),source:cmd==="read_image"?"DEMONSTRAÇÃO: captura PNG simulada":"DEMONSTRAÇÃO: leitura simulada; nenhum jogo conectado"};return {effectiveness:eff,doubts:[],missing_bars:0};}
  if(cmd==="relationship_focus")return {enabled:request.on};
  if(cmd==="training_preview"||cmd==="training_apply"||cmd==="bonding_preview"||cmd==="bonding_apply"){
    const write=cmd==="training_apply"||cmd==="bonding_apply";
    const start = new Date(Date.UTC(2026,10,23));
    const weeks: TrainingPlan["weeks"] = [];
    const edits = request.session_overrides as Record<string, (number | null)[]> | undefined;
    for (let w=0;w<4;w++) {
      let written=0;
      const weekStart=new Date(start);
      weekStart.setUTCDate(start.getUTCDate()+w*7);
      const startDate=weekStart.toISOString().slice(0,10);
      const protectedWeek=Array.isArray(request.protected_weeks)&&request.protected_weeks.includes(startDate);
      const days=Array.from({length:7},(_,d)=>{
        const day=new Date(weekStart);
        day.setUTCDate(weekStart.getUTCDate()+d);
        const date=day.toISOString().slice(0,10);
        const dayKey=[status.context,date].join("|");
        const locked=Array.isArray(request.protected_days)&&request.protected_days.includes(date);
        const editable=d!==5&&!protectedWeek;
        const current=demoCalendar.get(dayKey)??(d===5?[300,500,300]:[300,300,300]);
        let planned=!editable||locked?current:(d===6?[301,300,300]:[3,400,300]);
        if(cmd==="bonding_preview"||cmd==="bonding_apply")planned=editable&&!locked&&d===0?[300,300,400]:current;
        if(editable&&edits?.[date])planned=planned.map((code,index)=>edits[date]?.[index]??code);
        if(write&&planned.some((code,index)=>code!==current[index])){demoCalendar.set(dayKey,planned);written++;}
        const visibleCurrent=write?planned:current;
        return {date,editable,protected:locked,current:visibleCurrent.map(sessionLabel),planned:planned.map(sessionLabel),
          current_codes:visibleCurrent,planned_codes:planned};
      });
      weeks.push({start:startDate,protected:protectedWeek,name:"Plano de demonstração",rest:false,matches:1,
        focus:protectedWeek?"Semana protegida":"Construção e criação de chances",written,days});
    }
    return {today:"2026-11-20",weeks,sessions:demoSessions,written_days:weeks.reduce((total,week)=>total+week.written,0)};
  }
  if(cmd==="set_human_flags"){if(status.flags){if(typeof request.registration_anytime==="boolean")status.flags.registration_anytime=request.registration_anytime;if(typeof request.numbers_anytime==="boolean")status.flags.numbers_anytime=request.numbers_anytime;}return status.flags;}
  if(cmd==="allow_untested"){status.ping.untested_writes=Boolean(request.on);return {untested_writes:status.ping.untested_writes};}
  if(cmd==="max_understanding"){if(status.understanding)status.understanding.team=Object.fromEntries(Object.keys(status.understanding.team).map(key=>[key,10000]));return {players:18};}
  if(cmd==="heal"||cmd==="lift_bans"||cmd==="inspire"){for(const p of squad){if(Array.isArray(request.uids)&&!request.uids.includes(p.uid))continue;if(cmd==="heal")p.injuries=[];if(cmd==="lift_bans")p.bans=0;if(cmd==="inspire")p.morale=20;}return {players:squad.length};}
  if(cmd==="tactics_report")return {current:0,tactics:[{index:0,style:"4-3-3 · demonstração",enough_players:true,rows:Array.from({length:11},(_,i)=>({slot:i+1,line:i===0?"Keeper":i<5?"CentreBack":i<8?"CentreMid":"Striker",side:"Centre",in_possession:i===0?"Goalkeeper":"Playmaker",out_of_possession:"Defend",current:{...squad[i],fit:62+i},best:{...squad[(i+1)%11],fit:72+i},alternative:{...squad[11+i%7],fit:75+i},suggested_role:null}))}]};
  if(cmd==="export_plan")return {html:"Demonstração: exportação disponível no aplicativo Windows",weeks:request.weeks,folder:"Demonstração"};
  if(cmd==="backup")return {path:"Demonstração: o navegador não copia arquivos do computador"};
  if(cmd==="undo")return {undone:"Última ação simulada"};
  throw new Error("Ação não simulada: "+cmd);
}
