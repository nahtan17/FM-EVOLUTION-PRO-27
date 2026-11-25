import { call } from "./api";

export const FACTORS = [
  ["InPossessionShape", "Estrutura com a bola"], ["PassingStyle", "Estilo de passe"],
  ["BuildUp", "Construção das jogadas"], ["ChanceCreation", "Criação de chances"],
  ["OutOfPossessionShape", "Estrutura sem a bola"], ["LineOfEngagement", "Linha de pressão"],
  ["PressingIntensity", "Intensidade de pressão"], ["PressingTrap", "Armadilha de pressão"],
  ["PlayerTacticalAbility", "Capacidade tática dos jogadores"], ["TacticalComplexity", "Complexidade tática"],
  ["PlayerCapability", "Capacidade dos jogadores"], ["PlayerRoleSuitability", "Adequação às funções"],
  ["ManagerialSupport", "Apoio ao treinador"], ["TeammatesAndStaffRelationships", "Relacionamentos no elenco"],
  ["ManagerTendencies", "Tendências do treinador"], ["QualityOfNextOppositionReport", "Relatório do próximo adversário"],
  ["OppositionPlayerKnowledge", "Conhecimento do adversário"],
] as const;
export interface Effectiveness { factors: [string, number][]; components: [string, number][]; source: string; game_date: string | null }
export interface EffectivenessReading { effectiveness: Effectiveness; doubts: string[]; missing_bars: number }
export interface TrainerSettings { bonding_below: number; set_pieces_every: number; gain_per_session: number; decay_per_week: number; replan_every_weeks: number; load: "Light" | "Balanced" | "Intense"; no_tactical: boolean }
export const DEFAULT_SETTINGS: TrainerSettings = { bonding_below: 60, set_pieces_every: 0, gain_per_session: 2.2, decay_per_week: 0.8, replan_every_weeks: 4, load: "Balanced", no_tactical: false };
export const defaultEffectiveness = (): Effectiveness => ({ factors: FACTORS.map(([key]) => [key, 50]), components: [], source: "Valores manuais iniciais", game_date: null });
export interface TrainerPlayer { uid: number; name: string; morale: number; condition: number; sharpness: number; injuries: number | unknown[]; bans: number; wage?: number }
export interface TrainingTeam { index: number; kind: number; age_limit: number; players: number; own: boolean; selected: boolean }
export interface TrainingTeams { managers: { club_uid: number; club: string; selected: boolean }[]; teams: TrainingTeam[] }
export interface TrainingUnderstanding { team: Record<string, number>; without_record: number }
export interface TrainerStatus {
  club: { uid: number; name: string };
  ping: { pid: number; known_build: boolean; untested_writes: boolean; build_label?: string };
  flags: { supported: boolean; registration_anytime: boolean; numbers_anytime: boolean } | null;
  squad: TrainerPlayer[] | null;
  understanding: TrainingUnderstanding | null;
  teams: TrainingTeams | null; context: string | null; warnings: string[];
}
export type SessionSlots = [number | null, number | null, number | null];
export type SessionOverrides = Record<string, SessionSlots>;
export interface TrainingDay {
  date: string; editable: boolean; protected: boolean;
  current: string[]; planned: string[]; current_codes: number[]; planned_codes: number[];
}
export interface TrainingWeek {
  start: string; name: string; rest: boolean; protected: boolean;
  matches: number; focus: string; written: number; days: TrainingDay[];
}
export interface TrainingPlan { today: string; written_days: number; weeks: TrainingWeek[]; sessions: [number, string][] }
export interface TrainerAutomation { generation:number; event:number; error:string; warning?:string; plan?:TrainingPlan|null; effectiveness?:Effectiveness; settings?:TrainerSettings; activity?:string; changed?:boolean; last_check?:number; understanding?:TrainerStatus["understanding"] }
export const planKey = (eff:Effectiveness,s:TrainerSettings) => JSON.stringify([eff.factors,eff.components,eff.game_date,s.bonding_below,s.set_pieces_every,s.gain_per_session,s.decay_per_week,s.replan_every_weeks,s.load,s.no_tactical]);
export interface FitPlayer { uid: number; name: string; fit: number }
export interface TacticsReport { current: number; tactics: { index: number; style: string; enough_players: boolean; rows: { slot: number; line: string; side: string; in_possession: string; out_of_possession: string; current: FitPlayer | null; best: FitPlayer | null; alternative: FitPlayer | null; suggested_role: { role: string; score: number; old: number } | null }[] }[] }
export function trainerCall<T>(request: Record<string, unknown>): Promise<T> { return call<T>("trainer_call", { request }); }
