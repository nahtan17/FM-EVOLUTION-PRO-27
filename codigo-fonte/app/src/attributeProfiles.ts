import { judge, type InputState } from "./editDraft";
import type { FieldValues, PlayerDetails, StaffDetails } from "./types";
import { isRecord } from "./restore";

export type AttributeEntity = "player" | "staff";
export const MAX_ATTRIBUTE_PROFILE_BYTES = 64 * 1024;
const FORMAT = "fmlibre-attributes";
const VERSION = 1;
const fieldKey = /^(attribute|personality)\.[a-z][a-z0-9_]*$/;

export interface AttributeProfile {
  format: typeof FORMAT;
  version: typeof VERSION;
  entity: AttributeEntity;
  source: { uid: number; name: string };
  values: FieldValues;
}

export function createAttributeProfile(entity: AttributeEntity, details: PlayerDetails | StaffDetails): AttributeProfile {
  const attributes = Object.entries(details.attributes).map(([key, value]) => [`attribute.${key}`, value.raw] as const);
  const personality = Object.entries(details.personality).map(([key, value]) => [`personality.${key}`, value] as const);
  return {
    format: FORMAT,
    version: VERSION,
    entity,
    source: { uid: details.uid, name: details.name },
    values: Object.fromEntries([...attributes, ...personality]),
  };
}

export function parseAttributeProfile(text: string, entity: AttributeEntity): AttributeProfile {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    throw Error("O arquivo não contém um JSON válido.");
  }
  if (!isRecord(file) || file.format !== FORMAT) {
    throw Error("Selecione um arquivo JSON de atributos exportado pelo Evolution.");
  }
  if (file.version !== VERSION) throw Error("Esta versão do arquivo de atributos não é compatível.");
  if (file.entity !== "player" && file.entity !== "staff") throw Error("O tipo de perfil no arquivo é inválido.");
  if (file.entity !== entity) {
    throw Error(entity === "player"
      ? "Este arquivo é da comissão técnica. Abra a ficha de um membro da comissão para importá-lo."
      : "Este arquivo é de um jogador. Abra a ficha de um jogador para importá-lo.");
  }

  const source = file.source;
  if (!isRecord(source) || typeof source.uid !== "number" || !Number.isSafeInteger(source.uid)
      || source.uid < 0 || source.uid > 0xffffffff || typeof source.name !== "string" || !source.name.trim()
      || !isRecord(file.values)) {
    throw Error("O arquivo está sem a identificação de origem ou a lista de atributos.");
  }
  const entries = Object.entries(file.values);
  if (!entries.length || entries.length > 256) throw Error("O arquivo contém uma quantidade inválida de atributos.");

  const values: FieldValues = {};
  for (const [key, value] of entries) {
    if (!fieldKey.test(key)) throw Error("O arquivo contém campos fora dos atributos e da personalidade.");
    const maximum = key.startsWith("personality.") ? 20 : 100;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > maximum) {
      throw Error(`Valor inválido no arquivo para ${key}.`);
    }
    values[key] = value;
  }
  return { format: FORMAT, version: VERSION, entity, source: { uid: source.uid, name: source.name }, values };
}

export function previewAttributeImport(values: FieldValues, inputFor: (key: string) => InputState | null) {
  const changes: { input: InputState; value: number; shown: number }[] = [];
  let unchanged = 0;
  let unavailable = 0;
  let pending = 0;

  for (const [key, value] of Object.entries(values)) {
    const input = inputFor(key);
    if (!input) {
      unavailable++;
      continue;
    }
    if (input.status !== "same") {
      pending++;
      continue;
    }
    const verdict = judge(input.field, input.stored, value);
    if (verdict.status === "invalid") unavailable++;
    else if (verdict.status === "same") unchanged++;
    else changes.push({ input, value, shown: verdict.shown });
  }

  return { changes, unchanged, unavailable, pending };
}
