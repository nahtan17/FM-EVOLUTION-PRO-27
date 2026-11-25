import { useContext, useEffect, useState } from "react";
import { call } from "./api";
import { currency, toPounds } from "./currency";
import { dateFromNumber, numberFromIso, undoBatch } from "./editing";
import { describeError, formatDate, formatMoney, parseMoneyInput } from "./format";
import { fieldLabel, type AttributeKey } from "./labels";
import { GOALKEEPING, HIDDEN, MENTAL, PHYSICAL, TECHNICAL } from "./playerAttributes";
import type { FmDate, PlayerSummary } from "./types";
import { EditorContext } from "./useProfileEditing";

export type ToolKind = "evolve" | "fitness" | "contract" | "copy";
export const TOOL_NAMES: Record<ToolKind, string> = {
  evolve: "Evolução Imediata", fitness: "Central de condição física",
  contract: "Gestor de Contratos", copy: "Copiar atributos",
};
interface PlayerRow {
  summary: PlayerSummary;
  condition: number | null; conditionRaw: number | null; sharpness: number | null; sharpnessRaw: number | null; fatigue: number | null;
  injuriesAvailable: boolean;
  injuries: { name: string | null; backSoonest: FmDate | null; backLatest: FmDate | null }[];
  wage: number | null; expires: FmDate | null; contractType: number | null;
  loan: boolean; marketValue: number | null; attributes: Record<string, number>; reason: string | null;
}
interface Change { field: string; old: number; new: number }
interface ResultRow { uid: number; name: string; club: string | null; status: string; reason: string | null; changes: Change[]; batch: number | null; batchSession: string | null }
interface Preview { token: number; rows: ResultRow[] }
interface Progress { token: number; processed: number; total: number }

const groups = [
  ["Técnicos", TECHNICAL], ["Mentais", MENTAL], ["Físicos", PHYSICAL],
  ["Goleiro", GOALKEEPING], ["Ocultos", HIDDEN],
] as const;
const fitnessPresets = {
  full: ["100", "", "-500"],
  moderate: ["90", "", "-250"],
  match: ["97", "95", "-300"],
  custom: ["", "", ""],
} as const;
const pct = (value: number | null) => value === null ? "—" : `${(value / 100).toLocaleString("pt-BR")}%`;
const money = (value: number | null) => value === null ? "—" : formatMoney(value);
function show(change: Change, value: number, rawFitness: boolean) {
  if (change.field.startsWith("attribute.")) return Math.min(20, Math.max(1, Math.round(value / 5))).toString();
  if (rawFitness && (change.field === "condition" || change.field === "match_sharpness")) return `${value} (${pct(value)})`;
  if (change.field === "condition" || change.field === "match_sharpness") return pct(value);
  if (change.field === "contract.wage") return formatMoney(value);
  if (change.field === "contract.expires") return formatDate(dateFromNumber(value));
  return String(value);
}

const fitnessRawPresets = [10000, 12000, 12479, 12749];
type RawChoice = { choice: string; custom: string };
const rawValue = ({ choice, custom }: RawChoice) =>
  choice === "keep" ? null : choice === "custom" ? (custom === "" ? NaN : Number(custom)) : Number(choice);

function FitnessRawInput({ label, value, onChange }: {
  label: string; value: RawChoice; onChange: (value: RawChoice) => void;
}) {
  return <div>
    <label>{label} <select value={value.choice} onChange={event => onChange({ ...value, choice: event.target.value })}>
      <option value="keep">Manter valor atual</option>
      {fitnessRawPresets.map(raw => <option key={raw} value={raw}>{raw}{raw > 10000 ? " · sem validação para gravação" : ""}</option>)}
      <option value="custom">Personalizado</option>
    </select></label>
    {value.choice === "custom" && <label>{label} personalizado <input type="number" min={0} max={15000} step={1}
      value={value.custom} onChange={event => onChange({ ...value, custom: event.target.value })} /></label>}
  </div>;
}

export function PlayerBatchTools({ kind, club, initialIds = [], paused }: {
  kind: ToolKind; club?: number; initialIds?: number[]; paused: boolean;
}) {
  const { editable, onEdited, openPlayer } = useContext(EditorContext);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [picked, setPicked] = useState(new Set(initialIds));
  const [scope, setScope] = useState<"club" | "all">("club");
  const [query, setQuery] = useState("");
  const [originQuery, setOriginQuery] = useState("");
  const [origins, setOrigins] = useState<PlayerRow[]>([]);
  const [origin, setOrigin] = useState("");
  const [attrs, setAttrs] = useState(new Set<AttributeKey>());
  const [points, setPoints] = useState("5");
  const [absolute, setAbsolute] = useState(false);
  const [ceiling, setCeiling] = useState("");
  const [fitnessMode, setFitnessMode] = useState<"normal" | "advanced">("normal");
  const [advancedCondition, setAdvancedCondition] = useState<RawChoice>({ choice: "10000", custom: "" });
  const [advancedSharpness, setAdvancedSharpness] = useState<RawChoice>({ choice: "keep", custom: "" });
  const [restoreResult, setRestoreResult] = useState("");
  const [restored, setRestored] = useState(false);
  const advancedFitness = kind === "fitness" && fitnessMode === "advanced";
  const [preset, setPreset] = useState<keyof typeof fitnessPresets>("full");
  const [physical, setPhysical] = useState<readonly string[]>(fitnessPresets.full);
  const [expires, setExpires] = useState("");
  const [years, setYears] = useState("");
  const [salary, setSalary] = useState("");
  const [salaryMode, setSalaryMode] = useState("fixed");
  const [preview, setPreview] = useState<Preview>();
  const [results, setResults] = useState<ResultRow[]>();
  const [busy, setBusy] = useState<"read" | "preview" | "apply" | "">("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const canRead = !paused && (club !== undefined || initialIds.length > 0 || scope === "all");

  useEffect(() => {
    if (!canRead || club === undefined) return;
    let live = true;
    call<PlayerRow[]>("player_tools_list", { club }).then(
      rows => { if (live) setPlayers(rows); },
      err => { if (live) setError(describeError(err)); },
    );
    return () => { live = false; };
  }, [canRead, club]);

  useEffect(() => {
    if (busy !== "apply") return;
    const timer = window.setInterval(() => {
      void call<Progress | null>("player_tools_progress").then(value => { if (value) setProgress(value); }, () => {});
    }, 250);
    return () => window.clearInterval(timer);
  }, [busy]);

  function clearReview() { setPreview(undefined); setResults(undefined); setError(""); setRestoreResult(""); setRestored(false); }
  async function perform(label: typeof busy, action: () => Promise<void>) {
    setBusy(label);
    setError("");
    try { await action(); }
    catch (err) { setError(describeError(err)); }
    finally { setBusy(""); }
  }
  function lookup() {
    clearReview();
    void perform("read", async () => {
      const next = await call<PlayerRow[]>("player_tools_list", { club: scope === "club" ? club : null, query });
      setPlayers(next);
    });
  }
  function selectWholeClub() {
    clearReview();
    void perform("read", async () => {
      const next = await call<PlayerRow[]>("player_tools_list", { club, wholeClub: true });
      setQuery("");
      setPlayers(next);
      setPicked(new Set(next.map(row => row.summary.uid)));
    });
  }
  function lookupOrigin() {
    clearReview();
    void perform("read", async () => {
      const next = await call<PlayerRow[]>("player_tools_list", { query: originQuery });
      setOrigins(next);
      setOrigin(next.length === 1 ? String(next[0].summary.uid) : "");
    });
  }
  const number = (value: string) => value === "" ? null : Number(value);
  function settings() {
    switch (kind) {
      case "evolve":
        return { kind, points: Number(points), absolute, ceiling: number(ceiling) };
      case "fitness":
        if (advancedFitness) {
          return { kind: "fitnessAdvanced", conditionRaw: rawValue(advancedCondition),
            sharpness: rawValue(advancedSharpness), club: scope === "club" ? club ?? null : null };
        }
        return { kind, condition: physical[0] ? Math.round(Number(physical[0]) * 100) : null,
          sharpness: physical[1] ? Math.round(Number(physical[1]) * 100) : null, fatigue: number(physical[2]) };
      case "contract": {
        const pay = parseMoneyInput(salary);
        if (salary && salaryMode === "fixed" && (pay === null || pay < 0)) throw Error("Confira o salário informado.");
        return { kind, expires: expires ? numberFromIso(expires) : null, years: number(years),
          wage: salaryMode === "fixed" && salary && pay !== null ? toPounds(pay) : null,
          percent: salaryMode === "percent" ? number(salary) : null };
      }
      case "copy":
        return { kind, origin: Number(origin), attributes: [...attrs] };
    }
  }
  const visibleIds = players.map(row => row.summary.uid);
  const changePicked = (uids: number[], on: boolean) => {
    clearReview();
    setPicked(previous => {
      const next = new Set(previous);
      for (const uid of uids) { if (on) next.add(uid); else next.delete(uid); }
      return next;
    });
  };
  const rawValues = [rawValue(advancedCondition), rawValue(advancedSharpness)];
  const requestedRaw = rawValues.filter((value): value is number => value !== null);
  const validRaw = requestedRaw.length > 0 && requestedRaw.every(value => Number.isInteger(value) && value >= 0 && value <= 15000);
  const ready = editable && !paused && picked.size > 0 && picked.size <= 500
    && (kind !== "copy" || Boolean(origin && attrs.size))
    && (!advancedFitness || validRaw);
  const fitnessBatch = advancedFitness && !restored ? results?.find(row => row.batch != null && row.batchSession) : null;
  const readSelectedRows = () => call<PlayerRow[]>("player_tools_list", { uids: visibleIds });
  const shown = restored ? undefined : results ?? preview?.rows;
  return <section className="trainer-card batch-tools" aria-label={TOOL_NAMES[kind]}>
    <h3>{TOOL_NAMES[kind]}</h3>
    {kind === "copy" ? <p className="muted">Os atributos são avaliados para cada destino. A prévia indica alterações bloqueadas pela regra de compatibilidade do CA e da posição principal.</p> : null}
    {kind === "fitness" && <div className="trainer-row">
      <label>Modo de condição física <select value={fitnessMode} disabled={Boolean(busy)} onChange={event => {
        setFitnessMode(event.target.value as typeof fitnessMode); clearReview();
      }}><option value="normal">Modo normal</option><option value="advanced">Modo avançado experimental</option>
        <option value="tireless" disabled>Modo incansável experimental · indisponível</option>
      </select></label>
    </div>}
    {kind === "fitness" && <p className="muted">{advancedFitness
      ? "10000 equivale a 100%. Faixas validadas: condição física de 0 a 10000 e ritmo de jogo de 3500 a 10000. Valores fora dessas faixas podem ser conferidos na prévia. A gravação é bloqueada."
      : "Os presets definem condição, ritmo e fadiga conforme a prévia. Consulte as lesões e a previsão de recuperação na ficha."}</p>}
    {kind === "contract" ? <p className="muted">Edite salário e vencimento de contratos ativos. Para cláusulas, use a aba Contrato do jogador.</p> : null}
    <fieldset disabled={Boolean(busy)} className="advanced-fields">
      <form className="trainer-row" onSubmit={event => { event.preventDefault(); lookup(); }}>
        <label>Abrangência <select value={scope} onChange={event => { clearReview(); setScope(event.target.value as typeof scope); setPicked(new Set()); setPlayers([]); }}>
          <option value="club">Elenco do clube</option><option value="all">Procurar em todos os clubes</option>
        </select></label>
        <label>Jogador ou UID <input value={query} onChange={event => setQuery(event.target.value)} /></label>
        <button disabled={paused || (scope === "all" ? !query.trim() : club === undefined)}>Carregar jogadores</button>
        {advancedFitness && scope === "club" && <button type="button" disabled={paused || club === undefined}
          onClick={selectWholeClub}>Carregar e selecionar elenco inteiro</button>}
        <button type="button" disabled={!initialIds.length} onClick={() => { clearReview(); setPicked(new Set(initialIds)); }}>Usar seleção anterior</button>
        <button type="button" disabled={!picked.size} onClick={() => { clearReview(); setPicked(new Set()); }}>Limpar seleção</button>
        <span>{picked.size} selecionado(s)</span>
      </form>
      {players.length > 0 && <div className="trainer-table-scroll advanced-scroll"><table className="grid" aria-label="Jogadores para edição">
        <thead><tr><th><input type="checkbox" aria-label="Selecionar jogadores exibidos" checked={visibleIds.every(uid => picked.has(uid))}
          onChange={event => changePicked(visibleIds, event.target.checked)} /></th><th>Jogador</th><th>Clube</th><th>Idade</th>
          {kind === "fitness" ? <><th>Condição (%)</th>{advancedFitness && <th>Condição bruta</th>}<th>Ritmo (%)</th>{advancedFitness && <th>Ritmo bruto</th>}<th>Fadiga</th><th>Lesões e recuperação</th></> :
            kind === "contract" ? <><th>Salário semanal</th><th>Vencimento</th><th>Valor de mercado</th><th>Situação</th></> :
            <><th>CA</th><th>PA</th></>}<th>Leitura</th></tr></thead>
        <tbody>{players.map(row => {
          const player = row.summary;
          return <tr key={player.uid}><td><input type="checkbox" aria-label={`Selecionar ${player.name}`} checked={picked.has(player.uid)}
            onChange={event => changePicked([player.uid], event.target.checked)} /></td>
            <td>{openPlayer ? <button type="button" className="text-button" onClick={() => openPlayer(player)}>{player.name}</button> : player.name}</td>
            <td>{player.club ?? "Sem clube"}</td><td>{player.age ?? "—"}</td>
            {kind === "fitness" ? <><td>{pct(advancedFitness ? row.conditionRaw ?? null : row.condition)}</td>{advancedFitness && <td>{row.conditionRaw ?? "Indisponível"}</td>}<td>{pct(advancedFitness ? row.sharpnessRaw ?? null : row.sharpness)}</td>
              {advancedFitness && <td>{row.sharpnessRaw ?? "Indisponível"}</td>}<td>{row.fatigue ?? "—"}</td>
              <td>{row.reason || !row.injuriesAvailable ? "Leitura indisponível" : row.injuries.length ? row.injuries.map(injury => {
                const range = [formatDate(injury.backSoonest), formatDate(injury.backLatest)].filter(Boolean).join(" a ");
                return `${injury.name ?? "Lesão"}${range ? ` (${range})` : ""}`;
              }).join(" · ") : "Sem lesão registrada"}</td></> :
              kind === "contract" ? <><td>{money(row.wage)}</td><td>{formatDate(row.expires) || "—"}</td><td>{money(row.marketValue)}</td>
                <td>{row.loan ? "Emprestado" : row.contractType === 1 ? "Integral" : row.contractType === 0 ? "Meio período" : row.wage === null ? "Sem contrato disponível" : "Outro tipo"}</td></> :
                <><td>{player.currentAbility}</td><td>{player.potentialAbility > 0 ? player.potentialAbility : "Indefinido"}</td></>}
            <td>{row.reason ?? "Ficha lida"}</td></tr>;
        })}</tbody>
      </table></div>}
      {kind === "evolve" && <div className="trainer-form advanced-form">
        <label>Modo <select value={absolute ? "absolute" : "points"} onChange={event => { setAbsolute(event.target.value === "absolute"); clearReview(); }}>
          <option value="points">Somar pontos</option><option value="absolute">Subir até um CA</option>
        </select></label>
        <label>{absolute ? "CA desejado" : "Pontos de CA"} <input type="number" min={1} max={200} value={points} onChange={event => { setPoints(event.target.value); clearReview(); }} /></label>
        <label>Teto opcional <input type="number" min={1} max={200} value={ceiling} onChange={event => { setCeiling(event.target.value); clearReview(); }} /></label>
      </div>}
      {advancedFitness && <div className="trainer-form advanced-form">
        <FitnessRawInput label="Condição física (valor bruto)" value={advancedCondition}
          onChange={value => { setAdvancedCondition(value); clearReview(); }} />
        <FitnessRawInput label="Ritmo de jogo (valor bruto)" value={advancedSharpness}
          onChange={value => { setAdvancedSharpness(value); clearReview(); }} />
        {!validRaw && <p className="muted">Escolha pelo menos um campo e preencha os valores personalizados com inteiros de 0 a 15000.</p>}
      </div>}
      {kind === "fitness" && !advancedFitness && <div className="trainer-form advanced-form">
        <label>Preset <select value={preset} onChange={event => {
          const key = event.target.value as typeof preset; setPreset(key); setPhysical(fitnessPresets[key]); clearReview();
        }}><option value="full">Recuperação completa</option><option value="moderate">Recuperação moderada</option>
          <option value="match">Preparação para partida</option><option value="custom">Personalizado</option>
        </select></label>
        {["Condição (%)", "Ritmo (%)", "Fadiga (–500 a 1000)"].map((label, index) => <label key={label}>{label}
          <input type="number" min={index === 2 ? -500 : 0} max={index === 2 ? 1000 : 100} step={index === 2 ? 1 : 0.01} placeholder="Manter" value={physical[index]}
            onChange={event => {
              const value = event.target.value; setPreset("custom"); setPhysical(previous => previous.map((item, i) => i === index ? value : item)); clearReview();
            }} /></label>)}
      </div>}
      {kind === "contract" && <div className="trainer-form advanced-form">
        <label>Novo vencimento <input type="date" value={expires} onChange={event => { setExpires(event.target.value); setYears(""); clearReview(); }} /></label>
        <label>Acrescentar anos <input type="number" min={1} max={10} value={years} onChange={event => { setYears(event.target.value); setExpires(""); clearReview(); }} /></label>
        <label>Ajuste salarial <select value={salaryMode} onChange={event => { setSalaryMode(event.target.value); setSalary(""); clearReview(); }}>
          <option value="fixed">Salário semanal fixo</option><option value="percent">Aumento ou redução percentual</option>
        </select></label>
        <label>{salaryMode === "fixed" ? `Novo salário (${currency})` : "Ajuste (%)"} <input inputMode="decimal" placeholder="Manter" value={salary}
          onChange={event => { setSalary(event.target.value); clearReview(); }} /></label>
      </div>}
      {kind === "copy" && <div className="advanced-form">
        <form className="trainer-row" onSubmit={event => { event.preventDefault(); lookupOrigin(); }}>
          <label>Buscar jogador de origem <input value={originQuery} onChange={event => setOriginQuery(event.target.value)} /></label>
          <button disabled={paused || !originQuery.trim()}>Buscar origem</button>
          <label>Origem <select value={origin} onChange={event => { setOrigin(event.target.value); clearReview(); }}>
            <option value="">Selecione</option>{origins.map(row => <option key={row.summary.uid} value={row.summary.uid}>{row.summary.name} · {row.summary.club}</option>)}
          </select></label>
        </form>
        <div className="trainer-row">{groups.map(([name, keys]) => <label key={name} className="trainer-check"><input type="checkbox"
          checked={keys.every(key => attrs.has(key))} onChange={event => {
            const checked = event.target.checked; clearReview(); setAttrs(prev => {
              const next = new Set(prev); keys.forEach(key => { if (checked) next.add(key); else next.delete(key); }); return next;
            });
          }} /> {name}</label>)}</div>
        <details><summary>Atributos individuais</summary><div className="advanced-checkboxes">
          {[...new Set(groups.flatMap(([, keys]) => keys))].map(key => <label className="trainer-check" key={key}>
            <input type="checkbox" checked={attrs.has(key)} onChange={event => {
              const checked = event.target.checked; clearReview(); setAttrs(prev => {
                const next = new Set(prev); if (checked) next.add(key); else next.delete(key); return next;
              });
            }} /> {fieldLabel("player", `attribute.${key}`)}</label>)}</div></details>
      </div>}
    </fieldset>
    <div className="trainer-row">
      <button disabled={!ready || Boolean(busy)} onClick={() => void perform("preview", async () => {
        clearReview();
        setPreview(await call<Preview>("player_tools_preview", { uids: [...picked], tool: settings() }));
      })}>Conferir alterações</button>
      <button className="primary" disabled={!ready || !preview?.rows.some(row => row.status === "Pronto") || Boolean(busy) || Boolean(results)}
        onClick={() => preview && void perform("apply", async () => {
          setProgress(null); setCancelled(false);
          const next = await call<ResultRow[]>("player_tools_apply", { token: preview.token });
          setResults(next);
          if (next.some(row => row.status === "Aplicado e relido")) {
            onEdited();
            if (advancedFitness && visibleIds.length) {
              setPlayers(await readSelectedRows());
            } else if (scope === "club" && club !== undefined) {
              const rows = await call<PlayerRow[]>("player_tools_list", { club, query });
              setPlayers(rows);
            }
          }
        })}>Aplicar alterações conferidas</button>
      {fitnessBatch?.batch != null && fitnessBatch.batchSession && <button disabled={Boolean(busy) || paused || !editable}
        onClick={() => void perform("read", async () => {
          const result = await undoBatch(fitnessBatch.batch!, fitnessBatch.batchSession!);
          setRestored(true);
          setRestoreResult(`${result.undone} campo(s) restaurado(s) · ${result.failed.length} recusado(s).${result.failed.length ? " " + result.failed.map(row => describeError(row.error)).join(" · ") : ""}`);
          if (result.undone > 0) {
            onEdited();
            if (visibleIds.length) setPlayers(await readSelectedRows());
          }
        })}>Restaurar valores anteriores</button>}
      {busy === "apply" && <button disabled={cancelled || !preview} onClick={() => {
        setCancelled(true);
        void call("player_tools_cancel", { token: preview?.token }).catch(err => setError(describeError(err)));
      }}>Cancelar jogadores restantes</button>}
    </div>
    {busy && <p role="status">{busy === "apply" && progress ? `Processados ${progress.processed} de ${progress.total}` :
      busy === "apply" ? "Conferindo e aplicando o lote…" : "Lendo dados do FM…"}</p>}
    {restoreResult && <p className="trainer-notice" role="status">{restoreResult}</p>}
    {results && !restored && <p className="trainer-notice" role="status">{results.filter(row => row.status === "Aplicado e relido").length} aplicado(s) de {results.length} selecionado(s).</p>}
    {error && <p className="banner" role="alert">{error}</p>}
    {shown && <div className="trainer-table-scroll advanced-scroll"><table className="grid" aria-label={results ? "Resultado do lote" : "Prévia do lote"}>
      <thead><tr><th>Jogador</th><th>Clube</th><th>Campo</th><th>Atual</th><th>{kind === "copy" ? "Origem / proposto" : "Proposto"}</th><th>Situação</th></tr></thead>
      <tbody>{shown.flatMap(row => (row.changes.length ? row.changes : [null]).map((change, index) => <tr key={`${row.uid}/${index}`}>
        <td>{row.name}</td><td>{row.club ?? "—"}</td><td>{change ? fieldLabel("player", change.field) : "—"}</td>
        <td>{change ? show(change, change.old, advancedFitness) : "—"}</td><td>{change ? show(change, change.new, advancedFitness) : "—"}</td>
        <td>{row.status}{row.reason && <div className="muted">{row.reason}</div>}</td>
      </tr>))}</tbody>
    </table></div>}
  </section>;
}
