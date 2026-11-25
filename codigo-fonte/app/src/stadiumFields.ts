import type { EditField, FmDate } from "./types";

export interface StadiumPlace {
  stadiumName: string;
  stadiumUid: number | null;
  city: string | null;
  country: string | null;
}

export interface StadiumStand {
  index: number;
  capacity: number;
  roof: boolean;
  seats: boolean;
  tunnel: boolean;
}

export type StadiumValue = number | boolean | FmDate;

export interface StadiumDetails extends StadiumPlace {
  key: string;
  owner: string | null;
  nearby: string | null;
  fields: Record<string, StadiumValue>;
  stands: StadiumStand[] | null;
}

export const standPositions = [
  { area: "south", name: "Inferior central" },
  { area: "southwest", name: "Inferior esquerda" },
  { area: "west", name: "Lateral esquerda" },
  { area: "northwest", name: "Superior esquerda" },
  { area: "north", name: "Superior central" },
  { area: "northeast", name: "Superior direita" },
  { area: "east", name: "Lateral direita" },
  { area: "southeast", name: "Inferior direita" },
] as const;

export const standProperties = {
  roof: "Cobertura",
  seats: "Assentos",
  tunnel: "Túnel",
};

const fieldNames: Record<string, string> = {
  allSeater: "Capacidade em competições com todos sentados",
  environment: "Ambiente",
  ownerType: "Tipo de proprietário",
  seatColour: "Cor dos assentos",
  decay: "Estado de conservação",
  built: "Data de construção",
  rebuilt: "Data de reconstrução",
  latitude: "Latitude",
  longitude: "Longitude",
  trainingGround: "Campo de treino",
  noContinentalFinal: "Não utilizado em final continental",
  extinct: "Extinto",
  covered: "Possui cobertura",
  retractableRoof: "Teto retrátil",
  undersoilHeating: "Aquecimento subterrâneo",
  digitalBoards: "Placas de publicidade digitais",
  national: "Seleção principal",
  nationalU21: "Seleção Sub-21",
  nationalU19: "Seleção Sub-19",
  pitchType: "Tipo de campo",
  pitchCondition: "Condição do gramado",
  deterioration: "Taxa de deterioração",
  recovery: "Taxa de recuperação",
  pitchRelaid: "Última substituição do gramado",
  pitchRelay: "Substituição programada",
  length: "Comprimento atual",
  width: "Largura atual",
  internationalLength: "Comprimento internacional",
  internationalWidth: "Largura internacional",
  minLength: "Comprimento mínimo",
  minWidth: "Largura mínima",
  maxLength: "Comprimento máximo",
  maxWidth: "Largura máxima",
};

export const dimensions = [
  ["minLength", "length", "maxLength", "internationalLength"],
  ["minWidth", "width", "maxWidth", "internationalWidth"],
] as const;

export const isPitchDimension = (field: string) =>
  dimensions.some(axis => axis.some(key => field === `stadium.${key}`));

const nationalUse = {
  0: "Sem jogos",
  1: "Todos os jogos",
  2: "Jogos grandes",
  3: "Jogos médios",
  4: "Jogos pequenos",
  5: "Jogos grandes e alguns médios",
  6: "Jogos pequenos e alguns médios",
};

const choices: Record<string, Record<number, string>> = {
  environment: { 3: "Padrão", 4: "Alto nível", 5: "Estado da arte" },
  ownerType: { 1: "Clube", 2: "Prefeitura", 3: "Privado" },
  deterioration: { 1: "Rápida", 2: "Média", 3: "Lenta" },
  pitchType: {
    1: "Grama natural", 2: "Sintético macio", 3: "Sintético duro", 4: "Cascalho, argila ou areia",
    5: "Cascalho", 6: "Argila", 7: "Areia", 8: "Grama natural e sintética",
  },
  national: nationalUse,
  nationalU21: nationalUse,
  nationalU19: nationalUse,
};

function stadiumKey(field: string): string | undefined {
  return field.startsWith("stadium.") ? field.slice("stadium.".length) : undefined;
}

export function stadiumChoiceLabel(field: string, value: number) {
  const key = stadiumKey(field);
  return key === undefined ? undefined : choices[key]?.[value];
}

export function stadiumFieldLabel(field: string): string | undefined {
  const key = stadiumKey(field);
  if (key === undefined) return undefined;
  const [, position, property] = /^stand\.(\d+)\.(\w+)$/.exec(key) ?? [];
  const stand = standPositions[Number(position)];
  if (!stand) return fieldNames[key];
  const name = property === "capacity" ? "Capacidade" : standProperties[property as keyof typeof standProperties];
  return name && `${name} · ${stand.name}`;
}

export function demoStadiumFieldTable(): EditField[] {
  const field = (key: string, kind: EditField["kind"], min: number, max: number, options: number[] | null = null): EditField =>
    ({ key: `stadium.${key}`, kind, min, max, choices: options, entity: "club", scale: "plain", mass: false, blank: null });
  const enumerated = Object.entries(choices).map(([key, values]) => {
    const codes = key.startsWith("national") ? [0, 1, 2, 6] : Object.keys(values).map(Number);
    return field(key, "u8", Math.min(...codes), Math.max(...codes), codes);
  });
  return [
    field("allSeater", "u32", 0, 250_000),
    field("seatColour", "rgb", 0, 0xFFFFFF),
    field("latitude", "coordinate", -90_000_000, 90_000_000),
    field("longitude", "coordinate", -180_000_000, 180_000_000),
    field("decay", "u8", 0, 20),
    field("pitchCondition", "u16", 0, 200),
    field("recovery", "u8", 0, 20),
    ...enumerated,
    ...["pitchRelaid", "pitchRelay", "built", "rebuilt"].map(key => field(key, "date", 18500101, 21001231)),
    ...["trainingGround", "noContinentalFinal", "extinct", "covered", "retractableRoof", "undersoilHeating", "digitalBoards"]
      .map(key => field(key, "flag", 0, 1)),
    ...dimensions.flatMap(([minimum, current, maximum, international], axis) =>
      [minimum, current, maximum, international].map(key => field(key, "u16", axis === 0 ? 800 : 400, axis === 0 ? 1_300 : 1_000))),
    ...standPositions.flatMap((_, index) => [
      field(`stand.${index}.capacity`, "u32", 0, 200_000),
      ...Object.keys(standProperties).map(key => field(`stand.${index}.${key}`, "flag", 0, 1)),
    ]),
  ];
}
