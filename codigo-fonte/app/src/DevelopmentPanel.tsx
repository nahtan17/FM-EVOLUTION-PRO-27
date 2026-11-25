import { useContext, useEffect, useRef, useState } from "react";
import { call } from "./api";
import { SortHeader, type ColumnOrder } from "./SortHeader";
import { describeError, fold, formatDateTime } from "./format";
import { fieldLabel, positionLabel } from "./labels";
import type { FmDate } from "./types";
import { DevelopmentWorkspace, DevelopmentChart, samePlayer, type Candidate, type Workspace, type PlayerRef } from "./DevelopmentWorkspace";
import { PlayerBatchTools, TOOL_NAMES, type ToolKind } from "./PlayerBatchTools";
import { EditorContext } from "./useProfileEditing";

interface DevelopmentStatus {
  active: boolean; club: number | null; team: number | null; multiplier: number; weeklyLimit: number | null;
  weekly: boolean; guaranteedWeeklyGrowth: boolean; tracked: number; boosted: number; processed: number; unchanged: number; failures: number;
  meanBonus: number; lastDate: FmDate | null; lastWeek: FmDate | null; event: number; error: string | null;
  reportDate: FmDate | null;
  report: { uid: number; name: string; natural: number; bonus: number; guaranteedGain: number; ca: number | null; caBefore: number | null; pa: number | null;
    group: string | null; multiplier: number; week: FmDate; attemptedAt: number | null; status: string; reason: string | null;
    growthReason: string | null; focus?: string[]; attributes: { key: string; shown: number; rawGain?: number }[] }[];
}

interface Props {
  visible: boolean;
  paused: boolean;
  club?: number;
  clubName?: string;
  team?: number;
  teamName?: string;
  pid?: number;
  gameDate?: FmDate | null;
}

const columnNames = { name: "Jogador", club: "Clube", age: "Idade", ability: "CA", potential: "PA" };
type SortColumn = keyof typeof columnNames;
type SelectionMode = "age" | "all" | "none";

function compareCandidates(a: Candidate, b: Candidate, { by, ascending }: ColumnOrder<SortColumn>) {
  const left = a[by], right = b[by];
  if (left === null || right === null) return Number(left === null) - Number(right === null);
  const order = typeof left === "string" ? left.localeCompare(String(right), "pt-BR") : left - Number(right);
  return ascending ? order : -order;
}

export function DevelopmentPanel({ visible, paused, club, clubName, team, teamName, pid, gameDate }: Props) {
  const { editable, onEdited } = useContext(EditorContext);
  const [multiplier, setMultiplier] = useState("5");
  const [weekly, setWeekly] = useState(true);
  const [guaranteedWeeklyGrowth, setGuaranteedWeeklyGrowth] = useState(false);
  const [ceiling, setCeiling] = useState("");
  const [workspace, setWorkspace] = useState<Workspace>();
  const [area, setArea] = useState<"weekly" | "settings" | "chart" | ToolKind>("weekly");
  const [exported, setExported] = useState("");
  const [configuration, setConfiguration] = useState(0);
  const [maxAge, setMaxAge] = useState("");
  const [scope, setScope] = useState<"club" | "team">("club");
  const [weeklyLimit, setWeeklyLimit] = useState("");
  const [showSelected, setShowSelected] = useState(false);
  const [keepManual, setKeepManual] = useState(true);
  const [mode, setMode] = useState<SelectionMode>("age");
  const [manual, setManual] = useState<ReadonlyMap<number, boolean>>(new Map());
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<ColumnOrder<SortColumn>>({ by: "name", ascending: true });
  const [refresh, setRefresh] = useState(0);
  const [preview, setPreview] = useState<{ key: string; rows: Candidate[] }>();
  const [previewError, setPreviewError] = useState("");
  const [status, setStatus] = useState<DevelopmentStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lastEvent = useRef<number | undefined>(undefined);
  const inFlight = useRef(false);
  const polling = visible || Boolean(status?.active);
  const age = maxAge === "" ? null : Number(maxAge);
  const validAge = age === null || (Number.isInteger(age) && age >= 1 && age <= 99);
  const factor = Number(multiplier);
  const validFactor = Number.isInteger(factor) && factor >= 1 && factor <= 100;
  const limit = Number(weeklyLimit);
  const validCeiling = !ceiling || (Number.isInteger(Number(ceiling)) && Number(ceiling) >= 1 && Number(ceiling) <= 200);
  const validLimit = !weeklyLimit || (Number.isInteger(limit) && limit >= 1 && limit <= 200);
  const selectedTeam = scope === "team" ? team : null;
  const canApply = editable && !paused && club !== undefined && pid !== undefined && (scope === "club" || team !== undefined);
  const previewKey = JSON.stringify([pid, club, selectedTeam, gameDate, status?.lastDate, refresh, workspace?.label, workspace?.revision, configuration]);
  const rows = preview?.key === previewKey ? preview.rows : null;
  const eligible = rows?.filter(row => row.eligible) ?? [];
  const selection = eligible.filter(row => manual.get(row.uid)
    ?? (mode === "all" || (mode === "age" && (age === null || (validAge && row.age !== null && row.age <= age)))));
  const scopeKey = selectedTeam === null ? String(club) : `${club}/${selectedTeam}`;
  const restore = (refs: PlayerRef[]) => {
    const valid = rows?.filter(row => refs.some(ref => samePlayer(ref, row))) ?? [];
    setMode("none");
    setManual(new Map(valid.map(row => [row.uid, true])));
  };
  const savedRefs = workspace?.selections[scopeKey];
  const selectedIds = new Set(selection.map(row => row.uid));
  const search = fold(query.trim());
  const shownRows = rows?.filter(row => (!showSelected || selectedIds.has(row.uid)) && fold(row.name).includes(search))
    .sort((a, b) => compareCandidates(a, b, order));

  useEffect(() => {
    if (!visible || !canApply) return;
    let cancelled = false;
    setPreviewError("");
    call<Candidate[]>("development_preview", { club, pid, team: selectedTeam }).then(
      next => { if (!cancelled) setPreview({ key: previewKey, rows: next }); },
      reason => { if (!cancelled) setPreviewError(describeError(reason)); },
    );
    return () => { cancelled = true; };
  }, [visible, canApply, club, pid, selectedTeam, previewKey]);

  useEffect(() => {
    setManual(new Map());
    setMode("age");
  }, [club, selectedTeam, pid]);

  useEffect(() => {
    if (!visible || paused || pid === undefined) return;
    let valid = true;
    call<Workspace>("development_workspace", { name: null }).then(
      next => { if (valid) setWorkspace(next); },
      reason => { if (valid) setError(describeError(reason)); },
    );
    return () => { valid = false; };
  }, [visible, paused, pid]);

  useEffect(() => {
    if (!polling) return;
    let closed = false;
    let reading = false;
    const refresh = async () => {
      if (reading || inFlight.current) return;
      reading = true;
      try {
        const next = await call<DevelopmentStatus>("development_status");
        if (closed || inFlight.current) return;
        if (lastEvent.current !== undefined && next.event > lastEvent.current) onEdited();
        lastEvent.current = next.event;
        setStatus(next);
      } catch (reason) {
        if (!closed) setError(describeError(reason));
      } finally {
        reading = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => { closed = true; window.clearInterval(timer); };
  }, [polling, onEdited, paused, club, team]);

  useEffect(() => {
    if (status?.active) setGuaranteedWeeklyGrowth(status.guaranteedWeeklyGrowth);
  }, [status?.active, status?.guaranteedWeeklyGrowth]);

  if (!visible) return null;
  const apply = async (value: number, guaranteed = guaranteedWeeklyGrowth) => {
    const activates = value > 1 || guaranteed;
    if (inFlight.current || (activates && (!validAge || !validLimit || !validCeiling || !canApply || !selection.length))) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await call<DevelopmentStatus>("development_set", {
        multiplier: value,
        club: club ?? 0, pid: pid ?? 0, team: selectedTeam ?? null,
        weeklyLimit: weeklyLimit ? limit : null,
        ceiling: ceiling ? Number(ceiling) : null,
        weekly,
        guaranteedWeeklyGrowth: guaranteed,
        selectedPlayers: [...selectedIds],
      });
      if (lastEvent.current !== undefined && next.event > lastEvent.current) onEdited();
      lastEvent.current = next.event;
      setStatus(next);
      if (activates) {
        setConfiguration(current => current + 1);
        setWorkspace(await call<Workspace>("development_workspace", { name: null }));
      }
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const showDate = (date?: FmDate | null) => date && [date.day, date.month, date.year]
    .map(part => String(part).padStart(2, "0")).join("/");
  const date = showDate(status?.lastDate);
  const report = status?.club === club ? status?.report ?? [] : [];

  return <section className="trainer-card trainer-development" aria-labelledby="development-title">
    <h2 id="development-title">Desenvolvimento dos jogadores</h2>
    <div className="trainer-tabs" role="tablist" aria-label="Ferramentas de desenvolvimento">
      {([["weekly", "Desenvolvimento Avançado"], ["settings", "Grupos, perfis e listas"], ["chart", "Gráfico de evolução"],
        ["evolve", TOOL_NAMES.evolve], ["contract", TOOL_NAMES.contract], ["copy", TOOL_NAMES.copy]] as const).map(([key, text]) =>
        <button key={key} role="tab" aria-selected={area === key} onClick={() => setArea(key)}>{text}</button>)}
    </div>
    {area === "settings" && <DevelopmentWorkspace workspace={workspace} onUpdate={setWorkspace}
      rows={rows ?? []} selection={selection} replaceSelection={refs => { restore(refs); setArea("weekly"); }} busy={busy || paused} />}
    {area === "chart" && <DevelopmentChart candidates={rows ?? []} workspace={workspace} event={status?.reportDate ? Date.UTC(status.reportDate.year, status.reportDate.month - 1, status.reportDate.day) : configuration} />}
    {(area === "evolve" || area === "contract" || area === "copy") &&
      <PlayerBatchTools key={`${area}/${club}`} kind={area} club={club} paused={paused} initialIds={[...selectedIds]} />}
    <div hidden={area !== "weekly"}>
    <p>Acompanhe ganhos reais de CA enquanto o editor estiver aberto. A configuração inicial usa 5× com verificação semanal.</p>
    <div className="trainer-form">
      <label>Multiplicador (1× a 100×)<input type="number" min={1} max={100} step={1} value={multiplier}
        disabled={busy} onChange={event => setMultiplier(event.target.value)} /></label>
      <label>Idade máxima para seleção automática<input type="number" min={1} max={99} step={1} value={maxAge} disabled={busy}
        placeholder="Qualquer idade" aria-invalid={!validAge || undefined} onChange={event => {
          setMaxAge(event.target.value);
          setMode("age");
          if (!keepManual) setManual(new Map());
        }} /></label>
      <label>Abrangência<select value={scope} disabled={busy} onChange={event => setScope(event.target.value as "club" | "team")}>
        <option value="club">Todo o clube{clubName ? ` · ${clubName}` : ""}</option>
        <option value="team" disabled={team === undefined}>Plantel de treino{teamName ? ` · ${teamName}` : ""}</option>
      </select></label>
      <label>Limite semanal opcional<input type="number" min={1} max={200} step={1} value={weeklyLimit} disabled={busy}
        placeholder="Sem limite" onChange={event => setWeeklyLimit(event.target.value)} /></label>
      <label>Teto geral de CA<input type="number" min={1} max={200} value={ceiling} disabled={busy}
        placeholder="Usar PA do jogador" onChange={event => setCeiling(event.target.value)} /></label>
      <label className="trainer-check"><input type="checkbox" checked={weekly || guaranteedWeeklyGrowth} disabled={busy || guaranteedWeeklyGrowth}
        onChange={event => setWeekly(event.target.checked)} /> Verificação semanal</label>
      <label className="trainer-check"><input type="checkbox" checked={guaranteedWeeklyGrowth} disabled={busy}
        aria-describedby="guaranteed-weekly-growth-help"
        onChange={event => setGuaranteedWeeklyGrowth(event.target.checked)} /> Crescimento semanal garantido</label>
    </div>
    <p id="guaranteed-weekly-growth-help" className="muted">A partir da próxima semana do FM, o multiplicador efetivo de cada jogador define o mínimo desejado de CA. O modo garantido faz uma verificação por semana e respeita PA, teto e limite semanal.</p>
    <p className="muted">A idade máxima é inclusiva e pode ser deixada em branco. O limite semanal soma os pontos de habilidade dados pelo editor a cada jogador.</p>
    {canApply && <section className="development-selection" aria-labelledby="development-selection-title">
      <div className="trainer-row trainer-between">
        <h3 id="development-selection-title">Prévia da seleção</h3>
        {rows && <span className="muted">{selection.length} selecionados de {eligible.length} elegíveis</span>}
      </div>
      <div className="trainer-row">
        <button type="button" disabled={busy || !rows} onClick={() => { setMode("all"); setManual(new Map()); }}>Selecionar todos</button>
        <button type="button" disabled={busy || !rows} onClick={() => { setMode("none"); setManual(new Map()); }}>Desmarcar todos</button>
        <button type="button" disabled={busy || !rows || !validAge} onClick={() => {
          setMode("age");
          if (!keepManual) setManual(new Map());
        }}>Selecionar dentro do filtro</button>
        <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Atualizar lista</button>
        {savedRefs?.length ? <button disabled={busy || !rows} onClick={() => restore(savedRefs)}>Restaurar seleção guardada</button> : null}
      </div>
      <div className="trainer-row">
        <label className="trainer-check"><input type="checkbox" checked={keepManual} disabled={busy}
          onChange={event => setKeepManual(event.target.checked)} /> Manter seleções manuais ao usar o filtro</label>
        <label>Exibir <select value={showSelected ? "selected" : "all"} onChange={event => setShowSelected(event.target.value === "selected")}>
          <option value="all">Todos os jogadores</option>
          <option value="selected">Somente selecionados</option>
        </select></label>
        <label>Pesquisar por nome <input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
      </div>
      {!validAge && <p className="error" role="alert">Informe uma idade entre 1 e 99 anos ou deixe em branco.</p>}
      {previewError && <p className="banner" role="alert">{previewError}</p>}
      {!rows && !previewError && <p role="status">Carregando jogadores…</p>}
      {rows && !rows.length && <p>Nenhum jogador encontrado neste plantel.</p>}
      {Boolean(rows?.length) && <div className="trainer-table-scroll"><table className="grid" aria-label="Jogadores para desenvolvimento">
        <thead><tr><th aria-label="Seleção"></th>
          {(["name", "club", "age"] as const).map(by => <SortHeader key={by} by={by} order={order} label={columnNames[by]}
            title={`Ordenar por ${columnNames[by]}`} onSort={() => setOrder({ by, ascending: order.by !== by || !order.ascending })} />)}
          <th>Posição</th>
          {(["ability", "potential"] as const).map(by => <SortHeader key={by} by={by} order={order} label={columnNames[by]}
            title={`Ordenar por ${columnNames[by]}`} onSort={() => setOrder({ by, ascending: order.by === by && !order.ascending })} />)}
          <th>Multiplicador geral</th><th>Foco do bônus</th><th>Situação</th></tr></thead>
        <tbody>{shownRows?.map(row => {
          const marked = selectedIds.has(row.uid);
          const boosted = marked && validFactor && (factor > 1 || guaranteedWeeklyGrowth);
          return <tr key={row.uid}>
            <td><input type="checkbox" aria-label={`Selecionar ${row.name}`} checked={marked} disabled={busy || !row.eligible}
              onChange={event => {
                const checked = event.currentTarget.checked;
                setManual(previous => new Map(previous).set(row.uid, checked));
              }}/></td>
            <td>{row.name}</td><td>{row.club}</td><td>{row.age ?? "—"}</td>
            <td>{row.positions.map(positionLabel).join(", ") || "—"}</td><td>{row.ability}</td><td>{row.potential ?? "—"}</td>
            <td>{boosted ? factor : 1}×</td>
            <td>{row.focus?.map(key => fieldLabel("player", key)).join(" · ") || "—"}</td>
            <td className={boosted ? "development-bonus" : "muted"}>{row.reason ?? (marked ? "Selecionado" : "Fora da seleção")}</td>
          </tr>;
        })}</tbody>
      </table>{shownRows?.length === 0 && <p>Nenhum jogador corresponde à visualização atual.</p>}</div>}
    </section>}
    <div className="trainer-row">
      <button className="primary" disabled={busy || !validFactor || ((factor > 1 || guaranteedWeeklyGrowth) ? !validAge || !validLimit || !validCeiling || !selection.length : !status?.active)}
        onClick={() => void apply(factor)}>{factor > 1 || guaranteedWeeklyGrowth ? "Aplicar aos selecionados" : "Aplicar multiplicador"}</button>
      <button disabled={busy || !status?.active} onClick={() => void apply(1, false)}>Voltar ao padrão (1×)</button>
    </div>
    <p className="trainer-notice" role="status">
      {status?.active
        ? `Ativo em ${status.multiplier}× · ${status.tracked} jogador(es) acompanhado(s)${status.guaranteedWeeklyGrowth ? " · Crescimento semanal garantido" : ""}${status.weeklyLimit ? ` · Limite de +${status.weeklyLimit} por semana` : ""}${date ? ` · ${date}: ${status.boosted} com bônus` : ""}.`
        : "1× · Evolução padrão do FM."}
    </p>
    {(error || status?.error) && <p className="banner" role="alert">{error || status?.error}</p>}
    {!canApply && !status?.active && <p className="muted">Carregue uma carreira editável e selecione o clube na aba Eficácia e treinos.</p>}
    <section className="development-selection" aria-labelledby="development-report-title">
      <div className="trainer-row trainer-between"><h3 id="development-report-title">Diagnóstico de desenvolvimento</h3>
        {Boolean(report.length) && <span className="muted">{showDate(status?.reportDate)}</span>}
        <button disabled={!report.length} onClick={() => {
          setExported("");
          void call<string>("development_export").then(setExported, reason => setError(describeError(reason)));
        }}>Exportar diagnóstico</button></div>
      {exported && <p role="status">Diagnóstico exportado em {exported}.</p>}
      {Boolean(report.length) && status && <p className="muted">Última semana processada {showDate(status.lastWeek) ?? "—"} ·
        {status.processed} processado(s) · {status.boosted} com bônus · {status.unchanged} sem bônus · {status.failures} falha(s) ·
        média de +{(status.meanBonus ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} CA</p>}
      {report.length ? <div className="trainer-table-scroll"><table className="grid" aria-label="Ganhos de desenvolvimento">
        <thead><tr><th>Jogador</th><th>Grupo</th><th>CA antes → depois / PA</th><th>Multiplicador</th><th>Ganho do FM</th><th>Bônus aplicado</th><th>Garantido aplicado</th><th>Semana</th><th>Tentativa</th><th>Situação</th></tr></thead>
        <tbody>{report.map(row => <tr key={row.uid}>
          <td>{row.name}</td><td>{row.group ?? "—"}</td><td>{row.bonus > 0 && row.caBefore != null ? `${row.caBefore} → ` : ""}{row.ca ?? "—"} / {row.pa ?? "—"}</td>
          <td>{row.multiplier ?? status?.multiplier}×</td><td>+{row.natural}</td><td className="development-bonus">+{row.bonus}
            {row.attributes.length > 0 && <div className="muted">{row.attributes.map(({key, shown, rawGain}) => {
              const gain = shown ? `+${shown}` : `+${rawGain ?? 0} na escala interna`;
              return `${fieldLabel("player", `attribute.${key}`)} ${gain}`;
            }).join(" · ")}</div>}
          </td><td>+{row.guaranteedGain ?? 0}</td><td>{showDate(row.week) ?? "—"}</td><td>{row.attemptedAt ? formatDateTime(row.attemptedAt) : "—"}</td>
          <td>{row.status}{row.growthReason && <div className="muted">{row.growthReason}</div>}{row.reason && <div className="muted">{row.reason}</div>}{Boolean(row.focus?.length) && <div className="muted">
            Foco: {row.focus?.map(key => fieldLabel("player", key)).join(", ")}
          </div>}</td>
        </tr>)}</tbody>
      </table></div> : <p className="muted">Ative o desenvolvimento para acompanhar as verificações.</p>}
    </section>
    </div>
  </section>;
}
