import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { AttributeFilters, readAttributeRows, toAttributeBounds, type AttributeRow } from "./AttributeFilters";
import { toPounds } from "./currency";
import { isNumberText, TextInput, textOr, toFmDate } from "./FilterBar";
import { currencySymbol, normalizeMoneyInput, parseMoneyInput } from "./format";
import { PERSONALITY_LABELS, POSITION_LABELS, profileText, type PositionKey } from "./labels";
import { PITCH, SPOTS } from "./PositionPitch";
import { roleValue, useRoleCatalog } from "./ProfileRoleGuide";
import { isRecord } from "./restore";
import { roleName } from "./ScoutParts";
import { CLAUSE_NAMES_EN, TRAIT_NAMES_EN } from "./i18n/en";
import type { PlayerAdvancedFilter } from "./types";

const positions: ReadonlySet<string> = new Set(SPOTS.map(([key]) => key));
const personalityChoices = {
  groups: [{ label: "Personalidade", keys: Object.keys(PERSONALITY_LABELS) }],
  labels: PERSONALITY_LABELS,
};
const numberRanges = {
  maxCurrent: [1, 200],
  maxPotential: [1, 200],
  minHeight: [1, 300],
  maxHeight: [1, 300],
  minReputation: [0, 10_000],
  maxReputation: [0, 10_000],
  expiresWithinMonths: [0, 240],
} as const;
type NumberKey = keyof typeof numberRanges;
const moneyKeys = ["minWage", "maxWage", "minValue", "maxValue", "minAsking", "maxAsking", "maxReleaseFee"] as const;
type MoneyKey = (typeof moneyKeys)[number];
const textKeys = ["secondNation", "continent", "country", "league"] as const;
type TextKey = (typeof textKeys)[number];

export type AdvancedFields = Record<NumberKey | MoneyKey | TextKey, string> & {
  positions: PositionKey[];
  allPositions: boolean;
  positionRating: string;
  contractExpiresFrom: string;
  clause: string;
  traitBit: string;
  personality: AttributeRow[];
  foot: "" | "left" | "right" | "equal";
  role: string;
  roleRating: string;
};

export const NO_ADVANCED_FIELDS: AdvancedFields = {
  positions: [], allPositions: false, positionRating: "15",
  secondNation: "", continent: "", country: "", league: "",
  maxCurrent: "", maxPotential: "",
  minHeight: "", maxHeight: "", minReputation: "", maxReputation: "",
  minWage: "", maxWage: "", minValue: "", maxValue: "", minAsking: "", maxAsking: "",
  expiresWithinMonths: "", contractExpiresFrom: "", maxReleaseFee: "", clause: "",
  traitBit: "", personality: [], foot: "", role: "", roleRating: "12",
};

export function readAdvancedFields(value: unknown, legacyPosition: unknown): AdvancedFields {
  const given = isRecord(value) ? value : {};
  const keys = Array.isArray(given.positions) ? given.positions : [legacyPosition];
  const restored = { ...NO_ADVANCED_FIELDS };
  for (const key of textKeys) restored[key] = textOr(given[key], "");
  for (const key of moneyKeys) restored[key] = textOr(given[key], "");
  for (const key of Object.keys(numberRanges) as NumberKey[]) restored[key] = textOr(given[key], "", isNumberText);
  return {
    ...restored,
    positions: [...new Set(keys.filter((key): key is PositionKey => typeof key === "string" && positions.has(key)))],
    allPositions: given.allPositions === true,
    positionRating: textOr(given.positionRating, "15", isNumberText),
    contractExpiresFrom: textOr(given.contractExpiresFrom, "", value => /^\d{4}-\d{2}-\d{2}$/.test(value)),
    clause: textOr(given.clause, "", value => Object.prototype.hasOwnProperty.call(CLAUSE_NAMES_EN, value)),
    traitBit: textOr(given.traitBit, "", value => Object.prototype.hasOwnProperty.call(TRAIT_NAMES_EN, value)),
    personality: readAttributeRows(given.personality, personalityChoices),
    foot: given.foot === "left" || given.foot === "right" || given.foot === "equal" ? given.foot : "",
    role: textOr(given.role, "", value => /^(inPossession|outOfPossession):[a-z0-9_]+$/i.test(value)),
    roleRating: textOr(given.roleRating, "12", isNumberText),
  };
}

function fieldNumber(raw: string, min: number, max: number) {
  if (raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

function fieldMoney(raw: string) {
  if (raw.trim() === "") return undefined;
  const value = parseMoneyInput(raw);
  return value !== null && value >= 0 ? toPounds(value) : null;
}

export function toAdvancedFilter(fields: AdvancedFields): PlayerAdvancedFilter | undefined {
  const filter: PlayerAdvancedFilter = {};
  for (const key of textKeys) {
    const value = fields[key].trim();
    if (value) filter[key] = value;
  }
  for (const key of Object.keys(numberRanges) as NumberKey[]) {
    const [min, max] = numberRanges[key];
    const value = fieldNumber(fields[key], min, max);
    if (value === null) filter.invalid = true;
    else if (value !== undefined) filter[key] = value;
  }
  for (const key of moneyKeys) {
    const value = fieldMoney(fields[key]);
    if (value === null) filter.invalid = true;
    else if (value !== undefined) filter[key] = value;
  }
  if (fields.positions.length) {
    filter.positions = fields.positions;
    if (fields.allPositions) filter.allPositions = true;
  }
  if (fields.positions.length || fields.role) {
    const rating = fieldNumber(fields.positionRating, 1, 20);
    if (rating === null) filter.invalid = true;
    else if (rating !== undefined && rating !== 15) filter.positionRating = rating;
  }
  if (fields.role) {
    const [phase, key] = fields.role.split(":");
    const minRating = fieldNumber(fields.roleRating, 1, 20);
    if (minRating === null || !key || (phase !== "inPossession" && phase !== "outOfPossession")) filter.invalid = true;
    else filter.role = { phase, key, minRating: minRating ?? 12 };
  }
  const from = toFmDate(fields.contractExpiresFrom);
  if (from) filter.contractExpiresFrom = from;
  if (fields.clause) filter.clause = Number(fields.clause);
  if (fields.traitBit) filter.traitBit = Number(fields.traitBit);
  if (fields.foot) filter.foot = fields.foot;
  const personality = toAttributeBounds(fields.personality);
  if (personality) filter.personality = personality;
  return Object.keys(filter).length ? filter : undefined;
}

function PitchControls({ fields, set }: {
  fields: AdvancedFields;
  set: <K extends keyof AdvancedFields>(key: K, value: AdvancedFields[K]) => void;
}) {
  return <div className="advanced-pitch-controls">
    <div className="advanced-pitch" role="group" aria-label="Selecionar posições em campo">
      <span className="pitch-midline" aria-hidden="true" />
      <span className="pitch-centre" aria-hidden="true" />
      <span className="pitch-area pitch-area-top" aria-hidden="true" />
      <span className="pitch-area pitch-area-bottom" aria-hidden="true" />
      {SPOTS.map(([key, x, y]) => {
        const picked = fields.positions.includes(key);
        return <button type="button" key={key} aria-pressed={picked}
          style={{ "--x": x / PITCH.width * 100 + "%", "--y": y / PITCH.height * 100 + "%" } as CSSProperties}
          onClick={() => set("positions", picked ? fields.positions.filter(position => position !== key) : [...fields.positions, key])}>
          {POSITION_LABELS[key]}
        </button>;
      })}
    </div>
    <div className="advanced-grid">
      <label className="filter-field">Combinar posições
        <select value={fields.allPositions ? "all" : "any"} onChange={event => set("allPositions", event.currentTarget.value === "all")}>
          <option value="any">Qualquer uma das selecionadas</option>
          <option value="all">Todas as selecionadas</option>
        </select>
      </label>
      <label className="filter-field">Familiaridade mínima com a posição
        <input type="number" min={1} max={20} value={fields.positionRating}
          onChange={event => set("positionRating", event.currentTarget.value)} />
      </label>
      <button type="button" onClick={() => set("positionRating", fields.positionRating === "20" ? "15" : "20")}
        aria-pressed={fields.positionRating === "20"}>Somente posições naturais (20)</button>
    </div>
  </div>;
}

const categories = { general: "Informações gerais", ability: "Habilidade", contract: "Contrato", profile: "Características" };
type Category = keyof typeof categories;

export function AdvancedPlayerControls({ fields, onChange, basic }: {
  fields: AdvancedFields;
  onChange: (fields: AdvancedFields) => void;
  basic: Record<Category, ReactNode>;
}) {
  const [category, setCategory] = useState<Category>("general");
  const id = useId();
  const { catalog, failed } = useRoleCatalog(category === "profile");
  const roles = catalog?.[1] ?? [];
  const set = <K extends keyof AdvancedFields>(key: K, value: AdvancedFields[K]) => onChange({ ...fields, [key]: value });
  const numeric = (key: NumberKey, label: string) => {
    const [min, max] = numberRanges[key];
    return <label className="filter-field">{label}
      <input type="number" min={min} max={max} step={1} value={fields[key]}
        aria-invalid={fieldNumber(fields[key], min, max) === null || undefined}
        onChange={event => set(key, event.currentTarget.value)} />
    </label>;
  };
  const money = (key: MoneyKey, label: string) => (
    <label className="filter-field">{label} ({currencySymbol})
      <input inputMode="decimal" value={fields[key]} aria-invalid={fieldMoney(fields[key]) === null || undefined}
        onChange={event => set(key, event.currentTarget.value)}
        onBlur={event => set(key, normalizeMoneyInput(event.currentTarget.value))} />
    </label>
  );
  const name = (key: TextKey, label: string) => (
    <TextInput label={label} value={fields[key]} onChange={value => set(key, value)} />
  );
  return <div className="advanced-player-filters">
    <div className="advanced-categories" role="group" aria-label="Categorias de busca">
      {(Object.entries(categories) as [Category, string][]).map(([key, label]) => (
        <button type="button" aria-pressed={category === key} aria-controls={id} key={key} onClick={() => setCategory(key)}>{label}</button>
      ))}
    </div>
    <div id={id} className="advanced-grid">
      {basic[category]}
      {category === "general" && <>
        {name("secondNation", "Segunda nacionalidade")}
        {name("continent", "Continente da nacionalidade")}
        {name("country", "País do clube")}
        {name("league", "Liga do clube")}
        {numeric("minHeight", "Altura mínima (cm)")}{numeric("maxHeight", "Altura máxima (cm)")}
        {numeric("minReputation", "Reputação atual mínima")}{numeric("maxReputation", "Reputação atual máxima")}
        <PitchControls fields={fields} set={set} />
      </>}
      {category === "ability" && <>
        {numeric("maxCurrent", "CA máximo")}{numeric("maxPotential", "PA máximo")}
      </>}
      {category === "contract" && <>
        {money("minWage", "Salário semanal mínimo")}{money("maxWage", "Salário semanal máximo")}
        {money("minValue", "Valor de mercado mínimo")}{money("maxValue", "Valor de mercado máximo")}
        {money("minAsking", "Preço pedido mínimo")}{money("maxAsking", "Preço pedido máximo")}
        {numeric("expiresWithinMonths", "Meses até o fim do contrato")}
        <label className="filter-field">Contrato termina a partir de
          <input type="date" value={fields.contractExpiresFrom}
            onChange={event => set("contractExpiresFrom", event.currentTarget.value)} />
        </label>
        {money("maxReleaseFee", "Multa rescisória máxima")}
        <label className="filter-field">Cláusula contratual
          <select value={fields.clause} onChange={event => set("clause", event.currentTarget.value)}>
            <option value="">Qualquer</option>
            {Object.keys(CLAUSE_NAMES_EN).map(key => <option key={key} value={key}>{profileText.clauseName(Number(key))}</option>)}
          </select>
        </label>
      </>}
      {category === "profile" && <>
        <label className="filter-field">Movimento preferido
          <select value={fields.traitBit} onChange={event => set("traitBit", event.currentTarget.value)}>
            <option value="">Qualquer</option>
            {TRAIT_NAMES_EN.map((_, bit) => <option key={bit} value={bit}>{profileText.traitName(bit)}</option>)}
          </select>
        </label>
        <label className="filter-field">Pé dominante
          <select value={fields.foot} onChange={event => set("foot", event.currentTarget.value as AdvancedFields["foot"])}>
            <option value="">Qualquer</option>
            <option value="left">Esquerdo mais forte</option>
            <option value="right">Direito mais forte</option>
            <option value="equal">Pés com a mesma nota</option>
          </select>
        </label>
        <label className="filter-field">Função por adequação
          <select value={fields.role} disabled={!catalog} onChange={event => set("role", event.currentTarget.value)}>
            <option value="">{failed ? "Catálogo indisponível" : !catalog ? "Carregando catálogo…" : "Qualquer"}</option>
            {fields.role && !roles.some(role => roleValue(role) === fields.role) && <option value={fields.role}>{fields.role}</option>}
            <optgroup label="Com a bola">{roles.filter(role => role.phase === "inPossession").map(role =>
              <option key={roleValue(role)} value={roleValue(role)}>{roleName(role.key)}</option>)}</optgroup>
            <optgroup label="Sem a bola">{roles.filter(role => role.phase === "outOfPossession").map(role =>
              <option key={roleValue(role)} value={roleValue(role)}>{roleName(role.key)}</option>)}</optgroup>
          </select>
        </label>
        {fields.role && <label className="filter-field">Nota mínima dos atributos da função
          <input type="number" min={1} max={20} value={fields.roleRating}
            onChange={event => set("roleRating", event.currentTarget.value)} />
        </label>}
        <AttributeFilters headingLabel="Personalidade" rows={fields.personality} choices={personalityChoices}
          onChange={rows => set("personality", rows)} />
      </>}
    </div>
    {toAdvancedFilter(fields)?.invalid && <p className="error" role="alert">Corrija os valores dos filtros destacados antes de buscar.</p>}
  </div>;
}
