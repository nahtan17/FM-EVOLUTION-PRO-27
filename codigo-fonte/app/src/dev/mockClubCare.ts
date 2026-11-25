// Fictitious browser-preview data only. Windows uses the native commands.
import {mockInvoke} from "./mock";
import type {ClubTeam,FitnessTargets,MassReport} from "../types";
interface Care {enabled:boolean;relationships:boolean;event:number;changed:boolean;error:string;activity:string;lastCheck:number}
const watches=new Map<string,boolean>();
const statuses=new Map<string,Care>();
let fitness: FitnessTargets = { condition: 10000, sharpness: 10000 };
const empty=():Care=>({enabled:false,relationships:false,event:0,changed:false,error:"",activity:"",lastCheck:0});
export async function mockClubCare(command:string,args:Record<string,unknown>={}):Promise<unknown>{
  const club=Number(args.club),team=Number(args.team??0),national=args.national===true,key=`${national}:${club}:${team}`;
  if(command==="club_cohesion_watch"){
    if(typeof args.enabled==="boolean")watches.set(key,args.enabled);
    return {enabled:watches.get(key)??false,samples:[],error:null};
  }
  if(command==="club_tactical_summary"){
    const teams=await mockInvoke<ClubTeam[]>("club_squads",{uid:club});
    const status=statuses.get(key);
    return {teams:teams.map(t=>({index:t.index,kind:t.kind,ageLimit:t.ageLimit,record:Array.from({length:8},(_,i)=>status?.enabled?100:45+i*5),training:Array.from({length:8},(_,i)=>status?.enabled?100:60+i*4),cohesion:status?.enabled?100:72,knownPlayers:t.players.length,players:t.players.length}))};
  }
  const value=statuses.get(key)??empty();
  const read = command === "club_care_status";
  if (!read) {
    if (args.fitness) {
      const next = args.fitness as FitnessTargets;
      if (!Number.isInteger(next.condition) || next.condition < 0 || next.condition > 12749
          || !Number.isInteger(next.sharpness) || next.sharpness < 3500 || next.sharpness > 12749) {
        throw Error("Informe a condição entre 0 e 12749 e o ritmo entre 3500 e 12749.");
      }
      fitness = structuredClone(next);
    }
    if (typeof args.enabled === "boolean") value.enabled = args.enabled;
    if (typeof args.relationships === "boolean") value.relationships = args.relationships;
    value.activity = value.enabled || value.relationships ? "Demonstração: manutenção simulada ativa." : "Manutenção desativada.";
    value.error = "";
    statuses.set(key, value);
  }
  const now = Date.now() / 1000;
  if (value.enabled && (!read || now - value.lastCheck >= 3)) {
    value.lastCheck = now;
    value.changed = false;
    const actions = national ? ["inspire", "refresh", "heal"] : ["inspire", "refresh", "heal", "maxCohesion", "maxTactics"];
    for (const action of actions) {
      const report = await mockInvoke<MassReport>(national ? "national_team_action" : "team_action",
        national ? { uid: club, action, fitness } : { club, team, action, fitness });
      value.changed ||= report.applied > 0;
    }
    if (value.changed) value.event++;
  }
  return structuredClone({ ...value, fitness });
}
