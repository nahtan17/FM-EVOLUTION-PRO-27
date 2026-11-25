import type { AttributeKey } from "./labels";

type RatingKey = AttributeKey | "weaker_foot";
type Weights = readonly [number, readonly RatingKey[]][];

// Measured relative CA costs by position, from lance101's editor experiments on the SI forum.
// See docs/ca-recomendada.md for the data, calibration and limits. These are independent of tactical roles.
const GOALKEEPER: Weights = [
  [2.5, ["handling", "reflexes"]],
  [1.65, ["aerial_reach", "command_of_area", "communication", "kicking", "one_on_ones",
    "bravery", "concentration", "decisions", "positioning", "agility"]],
  [.92, ["throwing", "acceleration", "strength"]],
  [.6, ["weaker_foot"]],
  [.35, ["anticipation", "composure", "leadership", "teamwork", "balance", "pace"]],
  [.125, ["first_touch", "vision", "work_rate", "jumping_reach", "stamina", "technique"]],
];
const FULL_BACK: Weights = [
  [2.15, ["tackling", "concentration", "decisions", "positioning", "acceleration", "pace"]],
  [1.2, ["marking", "anticipation", "agility", "stamina", "strength", "weaker_foot"]],
  [.53, ["crossing", "first_touch", "heading", "passing", "technique", "bravery", "composure",
    "vision", "teamwork", "work_rate", "balance", "jumping_reach"]],
  [.125, ["corners", "dribbling", "finishing", "free_kicks", "long_shots", "long_throws", "penalty_taking",
    "leadership", "off_the_ball"]],
];
const CENTRE_BACK: Weights = [
  [1.9, ["heading", "marking", "tackling", "concentration", "decisions", "positioning",
    "acceleration", "jumping_reach", "pace", "strength"]],
  [1.5, ["weaker_foot"]],
  [1.05, ["anticipation", "agility", "stamina"]],
  [.42, ["first_touch", "passing", "bravery", "composure", "leadership", "work_rate", "balance"]],
  [.125, ["corners", "crossing", "dribbling", "finishing", "free_kicks", "long_shots", "long_throws",
    "penalty_taking", "technique", "vision", "off_the_ball", "teamwork"]],
];
const CENTRAL_MIDFIELDER: Weights = [
  [2.25, ["weaker_foot"]],
  [2, ["passing", "vision", "acceleration", "pace"]],
  [1.15, ["first_touch", "long_shots", "tackling", "technique", "anticipation", "composure",
    "decisions", "work_rate", "agility", "stamina", "strength"]],
  [.47, ["dribbling", "finishing", "marking", "concentration", "off_the_ball", "positioning", "teamwork", "balance"]],
  [.125, ["corners", "crossing", "free_kicks", "heading", "long_throws", "penalty_taking", "bravery", "leadership", "jumping_reach"]],
];
const ATTACKING_MIDFIELDER: Weights = [
  [2.7, ["acceleration", "pace"]],
  [2.25, ["weaker_foot"]],
  [1.8, ["passing", "vision"]],
  [1, ["dribbling", "finishing", "first_touch", "long_shots", "technique", "anticipation", "composure",
    "decisions", "off_the_ball", "work_rate", "agility", "stamina", "strength"]],
  [.37, ["tackling", "concentration", "positioning", "teamwork", "balance"]],
  [.125, ["corners", "crossing", "free_kicks", "heading", "long_throws", "marking", "penalty_taking",
    "bravery", "leadership", "jumping_reach"]],
];
const WINGER: Weights = [
  [3.55, ["acceleration", "pace"]],
  [1.8, ["crossing", "dribbling"]],
  [1.63, ["weaker_foot"]],
  [1.05, ["first_touch", "technique", "anticipation", "composure", "vision", "work_rate", "agility", "stamina"]],
  [.42, ["finishing", "long_shots", "passing", "tackling", "concentration", "decisions",
    "off_the_ball", "teamwork", "balance", "strength"]],
  [.125, ["corners", "free_kicks", "heading", "long_throws", "marking", "penalty_taking",
    "bravery", "leadership", "positioning", "jumping_reach"]],
];
const STRIKER: Weights = [
  [3.2, ["acceleration", "pace"]],
  [2.15, ["weaker_foot"]],
  [1.55, ["finishing", "first_touch", "heading", "composure", "off_the_ball", "jumping_reach", "strength"]],
  [.85, ["dribbling", "technique", "anticipation", "agility"]],
  [.32, ["crossing", "long_shots", "passing", "concentration", "vision", "decisions", "positioning", "work_rate", "balance", "stamina"]],
  [.125, ["corners", "free_kicks", "long_throws", "marking", "penalty_taking", "tackling", "bravery", "leadership", "teamwork"]],
];

const POSITION_WEIGHTS: Partial<Record<string, Weights>> = {
  gk: GOALKEEPER,
  dl: FULL_BACK, dr: FULL_BACK,
  dc: CENTRE_BACK,
  mc: CENTRAL_MIDFIELDER,
  amc: ATTACKING_MIDFIELDER,
  aml: WINGER, amr: WINGER,
  st: STRIKER,
};

export function estimateAbility(position: string, attribute: (key: AttributeKey) => number | undefined): number | null {
  const groups = POSITION_WEIGHTS[position];
  if (!groups) return null;
  const left = attribute("left_foot");
  const right = attribute("right_foot");
  const weakerFoot = left === undefined || right === undefined ? undefined : Math.min(left, right);
  let score = 0;
  let totalWeight = 0;
  for (const [weight, keys] of groups) {
    for (const key of keys) {
      const value = key === "weaker_foot" ? weakerFoot : attribute(key);
      if (value === undefined || !Number.isInteger(value) || value < 1 || value > 20) return null;
      score += weight * value;
      totalWeight += weight;
    }
  }
  // Two historical editor observations give the scale: uniform ratings of 8 ~ 39 CA and 16 ~ 199 CA.
  const estimate = 39 + (score / totalWeight - 8) * ((199 - 39) / (16 - 8));
  return Math.max(1, Math.min(200, Math.round(estimate)));
}
