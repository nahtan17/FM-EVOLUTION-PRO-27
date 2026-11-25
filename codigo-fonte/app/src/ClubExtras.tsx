import { useContext, useEffect, useState } from "react";
import { call } from "./api";
import { undoChange } from "./editing";
import { describeError, formatNumber } from "./format";
import { PendingScope, confirmPendingNavigation, usePendingForm } from "./pendingEdits";
import { Fact } from "./ProfileParts";
import { EditorContext } from "./useProfileEditing";

export interface ExtraField {
  key: string;
  label: string;
  group: string;
  value: number;
  min: number;
  max: number;
  kind: string;
}

export interface ExtraView {
  revision: string;
  fields: ExtraField[];
}

const choices: Record<string, Record<number, string>> = {
  Status: { 1: "Profissional", 2: "Semiprofissional", 3: "Amador" },
  ChairpersonTitle: { 1: "Presidente do conselho", 2: "Presidente", 3: "Gerente geral", 4: "Fundador" },
  OwnershipType: {
    1: "Sociedade limitada", 2: "Sociedade anônima", 3: "Sócios com eleições (limitada)",
    4: "Sócios sem eleições (limitada)", 5: "Consórcio privado", 6: "Consórcio público",
    7: "Sócios com eleições (S.A.)", 8: "Sócios sem eleições (S.A.)",
  },
};

const attendanceOrder: Record<string, number> = {
  MaximumAttendance: 0, AverageAttendance: 1, MinimumAttendance: 2,
};

function rgb(value: number): string {
  return `#${(value & 0xFFFFFF).toString(16).padStart(6, "0")}`;
}

export function ClubExtras({ club, version, group, seasonTickets, socialMedia }: {
  club: number;
  version: number;
  group: "overview" | "staff";
  seasonTickets?: number | null;
  socialMedia?: number | null;
}) {
  const editor = useContext(EditorContext);
  const scope = useContext(PendingScope);
  const [view, setView] = useState<ExtraView | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [last, setLast] = useState<number | null>(null);

  const pending = Object.keys(draft).length > 0;
  useEffect(() => {
    if (pending) return;
    let alive = true;
    void call<ExtraView>("club_extra_view", { club }).then(next => {
      if (alive) setView(next);
    }, failure => {
      if (alive) setError(describeError(failure));
    });
    return () => { alive = false; };
  }, [club, version, pending]);

  async function read() {
    try {
      const next = await call<ExtraView>("club_extra_view", { club });
      setView(next);
      setDraft({});
      setError("");
    } catch (failure) {
      setError(describeError(failure));
    }
  }

  const fields = (view?.fields ?? []).filter(field => field.group === group)
    .sort((a, b) => (attendanceOrder[a.key] ?? 3) - (attendanceOrder[b.key] ?? 3));
  const changed = fields.filter(field => draft[field.key] !== undefined && draft[field.key] !== String(field.value));

  function collect() {
    const values: Record<string, number> = {};
    for (const field of changed) {
      const value = Number(draft[field.key]);
      if (!draft[field.key].trim() || !Number.isInteger(value) || value < field.min || value > field.max) {
        throw Error(`${field.label}. Informe um inteiro de ${formatNumber(field.min)} a ${formatNumber(field.max)}.`);
      }
      values[field.key] = value;
    }
    return values;
  }

  async function save() {
    if (!view || !editor.editable) return false;
    setBusy(true);
    setError("");
    try {
      const values = collect();
      const result = await call<{ change: number }>("set_club_extra", { club, revision: view.revision, values });
      setLast(result.change);
      setMessage("Informações do clube salvas.");
      setView({ ...view, fields: view.fields.map(field => ({ ...field, value: values[field.key] ?? field.value })) });
      setDraft({});
      editor.onEdited();
      await read();
      return true;
    } catch (failure) {
      const reason = describeError(failure);
      setError(reason);
      throw Error(reason);
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (last === null) return;
    setBusy(true);
    try {
      await undoChange(last);
      setLast(null);
      setMessage("Informações adicionais restauradas.");
      editor.onEdited();
      await read();
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }

  usePendingForm({
    profile: group === "overview",
    fields: changed.map(field => `club:${club}:extra.${field.key}`),
    count: changed.length,
    busy,
    validate: collect,
    save,
  });
  const fallback = group === "overview" ? [
    ["SeasonTicketHolders", "Ingressos de temporada", seasonTickets],
    ["SocialMediaFollowers", "Seguidores nas redes sociais", socialMedia],
  ] as const : [];
  const facts = fallback.filter(([key, , value]) => value != null && !fields.some(field => field.key === key));

  return <section className="profile-group club-extra">
    <h3>{group === "staff" ? "Funcionários adicionais permitidos" : "Informações administrativas"}</h3>
    {!view && !error && <p className="note">Lendo informações do clube…</p>}
    {view && fields.length === 0 && !facts.length && <p className="note">Nenhum campo disponível nesta versão do jogo.</p>}
    {view && fields.length > 0 && <div className="club-extra-fields">
      {fields.map(field => {
        const value = draft[field.key] ?? String(field.value);
        const options = choices[field.key];
        const disabled = busy || !editor.editable;
        const change = (value: string) => setDraft(current => {
          const next = { ...current };
          if (value === String(field.value)) delete next[field.key];
          else next[field.key] = value;
          return next;
        });
        return <label key={field.key}>
          <span>{field.label}</span>
          {field.kind === "colour"
            ? <input type="color" aria-label={field.label} disabled={disabled} value={rgb(Number(value))}
                onChange={event => change(String((Number(value) >>> 24) * 0x1000000 + Number.parseInt(event.target.value.slice(1), 16)))} />
            : options
              ? <select aria-label={field.label} disabled={disabled} value={value} onChange={event => change(event.target.value)}>
                  {options[Number(value)] === undefined && <option value={value}>Código {value}</option>}
                  {Object.entries(options).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                </select>
              : <input aria-label={field.label} disabled={disabled} type="number" min={field.min} max={field.max} step="1"
                  value={value} onChange={event => change(event.target.value)} />}
        </label>;
      })}
    </div>}
    {facts.length > 0 && <dl className="stats">{facts.map(([key, label, value]) =>
      <Fact key={key} label={label}>{formatNumber(value ?? 0)}</Fact>)}</dl>}
    {group === "staff" && <p className="note">Valores adicionais ao limite normal. A quantidade permitida depende das regras do jogo e da reputação do clube.</p>}
    {(error || pending || last !== null) && <div className="club-toolbar">
      {(error || pending) && <button type="button" disabled={busy}
        onClick={() => { if (!pending || confirmPendingNavigation(false, scope)) void read(); }}>
        {pending ? "Descartar e reler informações" : "Reler informações"}
      </button>}
      {last !== null && <button type="button" disabled={busy || !editor.editable || pending} onClick={() => void undo()}>
        Desfazer informações adicionais
      </button>}
    </div>}
    {message && <p role="status">{message}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
