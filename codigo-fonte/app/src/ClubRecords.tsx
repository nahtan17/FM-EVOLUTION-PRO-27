import { confirmPendingNavigation, usePendingForm } from "./pendingEdits";
import { useContext, useEffect, useId, useState } from "react";
import { call } from "./api";
import { toPounds, toShown } from "./currency";
import { currencySymbol, describeError, formatMoney, formatMoneyInput, normalizeMoneyInput, formatNumber, parseMoneyInput } from "./format";
import { undoChange } from "./editing";
import { EditorContext } from "./useProfileEditing";
import "./ClubTools.css";

export type RecordSection = "debts" | "affiliations" | "clauses";
export interface RecordField {
  key: string;
  label: string;
  value: number;
  format: "date" | "money" | "optionalMoney" | "percent" | "boolean" | "debtSource" | "number" | "code";
  editable: boolean;
}
export interface ClubRecord {
  slot: number;
  revision: string;
  title: string;
  fields: RecordField[];
}
interface RecordsView {
  rows: ClubRecord[];
  unrecognized: number;
}
interface StatementPeriod {
  index: number;
  income: Record<string, number>;
  expenditure: Record<string, number>;
}

const DEBT_SOURCES: Record<number, string> = {
  1: "Empréstimo bancário",
  2: "Empréstimo do presidente",
  5: "Empréstimo estatal",
  6: "Empréstimo de associação de torcedores",
  7: "Empréstimo como doação",
  8: "Doação reembolsável na saída do presidente",
  9: "Doação sem reembolso",
  10: "Empréstimo a pagar no acesso à primeira divisão",
  11: "Empréstimo a pagar após se estabelecer na primeira divisão",
  12: "Empréstimo de diretor",
  13: "Empréstimo com juros capitalizados (PIK)",
  15: "Outras dívidas",
};

const SECTIONS = {
  debts: { title: "Dívidas e empréstimos", empty: "O clube não tem dívidas ou empréstimos registrados nesta lista.", keys: ["original", "payment", "end"] },
  affiliations: { title: "Clubes afiliados", empty: "O clube não tem acordos de afiliação registrados.", keys: ["fee", "start", "end"] },
  clauses: { title: "Central de cláusulas", empty: "O clube não tem cláusulas de transferência registradas nesta lista.", keys: ["percent", "amount", "threshold"] },
} as const;

const COLUMNS: Record<string, string> = {
  original: "Valor original", payment: "Prestação ou vencimento (PIK)", start: "Início",
  end: "Vencimento", fee: "Taxa anual", percent: "Revenda", amount: "Valor", threshold: "Meta",
};

const isMoney = (format: RecordField["format"]) => format === "money" || format === "optionalMoney";
const dateInput = (value: number) => {
  const date = String(value);
  return date.length === 8 ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}` : "";
};

function displayField(field: RecordField | undefined): string {
  if (!field) return "—";
  if (field.format === "date") return dateInput(field.value).split("-").reverse().join("/") || "—";
  if (field.format === "debtSource") return DEBT_SOURCES[field.value] ?? `Tipo ${field.value}`;
  if (field.format === "boolean") return field.value ? "Sim" : "Não";
  if (field.format === "optionalMoney" && field.value === -1) return "—";
  if (isMoney(field.format)) return formatMoney(field.value);
  if (field.format === "percent") return `${formatNumber(field.value)}%`;
  return formatNumber(field.value);
}

function inputValue(field: RecordField): string {
  if (field.format === "date") return dateInput(field.value);
  if (field.format === "optionalMoney" && field.value === -1) return "";
  return isMoney(field.format) ? formatMoneyInput(toShown(field.value)) : String(field.value);
}

function parseInput(field: RecordField, value: string): number {
  if (field.format === "date") {
    const digits = value.replace(/-/g, "");
    if (digits === "" || /^\d{8}$/.test(digits)) return Number(digits);
  } else if (field.format === "optionalMoney" && value.trim() === "") {
    return -1;
  } else if (value.trim() !== "") {
    if (isMoney(field.format)) {
      const parsed = parseMoneyInput(value);
      if (parsed !== null) return parsed === toShown(field.value) ? field.value : toPounds(parsed);
    } else {
      const parsed = Number(value);
      if (Number.isSafeInteger(parsed)) return parsed;
    }
  }
  throw new Error(`Confira o valor de ${field.label}.`);
}

export function ClubRecordsPanel({ club, section }: { club: number; section: RecordSection }) {
  const { editable, onEdited } = useContext(EditorContext);
  const canEdit = editable;
  const config = SECTIONS[section];
  const titleId = useId();
  const [view, setView] = useState<RecordsView>();
  const [selected, setSelected] = useState<ClubRecord>();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [last, setLast] = useState<number>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    call<RecordsView>("club_records", { club, section }).then(
      (value) => { if (active) { setView(value); setBusy(false); } },
      (err: unknown) => { if (active) { setError(describeError(err)); setBusy(false); } },
    );
    return () => { active = false; };
  }, [club, section]);

  function select(row: ClubRecord) {
    setSelected(row);
    setDraft(Object.fromEntries(row.fields.map((field) => [field.key, inputValue(field)])));
    setError("");
  }

  async function refresh(slot?: number) {
    const next = await call<RecordsView>("club_records", { club, section });
    setView(next);
    const row = next.rows.find((row) => row.slot === slot);
    if (row) select(row);
    else setSelected(undefined);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      return true;
    } catch (err) {
      setError(describeError(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const changed = selected?.fields.filter((field) => field.editable && draft[field.key] !== inputValue(field)) ?? [];

  const collect = () => Object.fromEntries(changed.map((field) => [field.key, parseInput(field, draft[field.key])]));
  usePendingForm({ count: changed.length, busy, validate: collect, save });

  async function save() {
    if (!selected || !canEdit) return false;
    return run(async () => {
      const values = collect();
      const result = await call<{ change: number }>("set_club_record", {
        club, section, slot: selected.slot, revision: selected.revision, values,
      });
      setLast(result.change);
      setMessage("Alterações salvas.");
      onEdited();
      await refresh(selected.slot);
    });
  }

  function undo() {
    if (last === undefined || !canEdit) return;
    void run(async () => {
      await undoChange(last);
      setLast(undefined);
      setMessage("Alteração desfeita.");
      onEdited();
      await refresh(selected?.slot);
    });
  }

  function control(field: RecordField) {
    const value = draft[field.key] ?? "";
    const change = (next: string) => setDraft((previous) => ({ ...previous, [field.key]: next }));
    if (!canEdit || !field.editable) return <output>{displayField(field)}</output>;
    if (field.format === "boolean") {
      return <input type="checkbox" checked={value === "1"} disabled={busy} onChange={(event) => change(event.target.checked ? "1" : "0")} />;
    }
    if (field.format === "debtSource") {
      return <select value={value} disabled={busy} onChange={(event) => change(event.target.value)}>
        {Object.entries(DEBT_SOURCES).filter(([id]) => id !== "13").map(([id, label]) => (
          <option key={id} value={id}>{label}</option>
        ))}
      </select>;
    }
    return <input type={field.format === "date" ? "date" : isMoney(field.format) ? "text" : "number"}
      inputMode={isMoney(field.format) ? "decimal" : undefined} value={value} disabled={busy}
      onChange={(event) => change(event.target.value)}
      onBlur={isMoney(field.format) ? (event) => {
        const raw = event.currentTarget.value;
        const normalized = normalizeMoneyInput(raw);
        if (raw !== normalized) change(normalized);
      } : undefined} />;
  }

  return <section className="club-tools club-records" aria-labelledby={titleId} aria-busy={busy}>
    <header className="club-toolbar">
      <h3 id={titleId}>{config.title}</h3>
      <button type="button" disabled={busy} onClick={() => { if (!changed.length || confirmPendingNavigation(true)) void run(() => refresh(selected?.slot)); }}>Atualizar lista</button>
    </header>
    {busy && !view && <p role="status">Lendo dados do clube…</p>}
    {view && view.rows.length > 0 && <div className="transfer-list">
      <table className="grid" aria-label={config.title}>
        <thead><tr><th>{section === "debts" ? "Tipo de dívida" : section === "affiliations" ? "Clube" : "Jogador e cláusula"}</th>
          {config.keys.map((key) => <th key={key}>{COLUMNS[key]}</th>)}
        </tr></thead>
        <tbody>{view.rows.map((row) => <tr key={row.slot} className={row.slot === selected?.slot ? "selected" : undefined}>
          <td><button type="button" className="name name-link" onClick={() => { if (row.slot !== selected?.slot && (!changed.length || confirmPendingNavigation(true))) select(row); }} disabled={busy}
            aria-pressed={row.slot === selected?.slot}>
            {section === "debts" ? displayField(row.fields.find((field) => field.key === "source")) : row.title}
          </button></td>
          {config.keys.map((key) => <td key={key}>{displayField(row.fields.find((field) => field.key === key))}</td>)}
        </tr>)}</tbody>
      </table>
    </div>}
    {view && view.rows.length === 0 && <p>{view.unrecognized ? "Nenhum registro pôde ser identificado nesta lista." : config.empty}</p>}
    {!!view?.unrecognized && <p className="note">{view.unrecognized} registro(s) sem mapeamento neste perfil.</p>}
    {selected && <div className="transfer-form">
      <h4>{section === "debts" ? displayField(selected.fields.find((field) => field.key === "source")) : selected.title}</h4>
      <div className="transfer-fields">
        {selected.fields.map((field) => <label key={field.key}>
          {field.label}{isMoney(field.format) && canEdit && field.editable ? ` (${currencySymbol})` : ""}{field.format === "percent" ? " (%)" : ""}
          {control(field)}
        </label>)}
      </div>
    </div>}
    {last !== undefined && <button type="button" disabled={busy || !canEdit} onClick={undo}>Desfazer última alteração</button>}
    {message && <p role="status">{message}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}

const INCOME = [
  ["gateReceipts", "Bilheteria"], ["seasonTickets", "Ingressos de temporada"], ["sponsorship", "Patrocínios"],
  ["matchDayIncome", "Receitas em dias de jogo"], ["merchandising", "Venda de produtos"], ["playersSold", "Venda de jogadores"],
  ["investments", "Investimentos"], ["interest", "Juros recebidos"], ["grants", "Subvenções"], ["other", "Outras receitas"],
] as const;
const EXPENDITURE = [
  ["playerWages", "Salários dos jogadores"], ["staffWages", "Salários dos funcionários"], ["bonuses", "Bônus"],
  ["loyaltyBonuses", "Bônus de fidelidade"], ["transferExpenditure", "Compra de jogadores"], ["loanRepayment", "Pagamento de empréstimos"],
  ["groundMaintenance", "Manutenção do estádio"], ["leagueFines", "Multas da liga"], ["vat", "Imposto sobre valor agregado"],
  ["niEmployerTax", "Contribuições patronais"], ["other", "Outras despesas"],
] as const;
const sum = (values: Record<string, number>) => Object.values(values).reduce((total, value) => total + value, 0);

export function ClubFinancialStatement({ club, version }: { club: number; version: number }) {
  const [periods, setPeriods] = useState<StatementPeriod[]>();
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  useEffect(() => {
    let active = true;
    call<StatementPeriod[]>("club_statements", { club }).then(
      (rows) => { if (active) { setPeriods(rows); setError(""); } },
      (err: unknown) => { if (active) { setPeriods(undefined); setError(describeError(err)); } },
    );
    return () => { active = false; };
  }, [club, version]);

  const period = periods?.find((item) => item.index === index) ?? periods?.[0];
  return <section className="club-tools club-records">
    <header className="club-toolbar"><h3>Demonstrativo financeiro</h3>
      {period && <label>Período <select value={period.index} onChange={(event) => setIndex(Number(event.target.value))}>
        {periods?.map(({ index }) => <option key={index} value={index}>
          {index === 0 ? "Mais recente" : index === 1 ? "1 mês anterior" : `${index} meses anteriores`}
        </option>)}
      </select></label>}
    </header>
    {error && <p className="error" role="alert">{error}</p>}
    {!periods && !error && <p role="status">Lendo demonstrativo…</p>}
    {periods?.length === 0 && <p>O clube ainda não tem lançamentos nos períodos disponíveis.</p>}
    {period && <>
      <p className="note">Consulta das rubricas identificadas no jogo. O saldo deste quadro considera apenas os valores exibidos.</p>
      <div className="club-statement-tables">
        {([["Receitas", INCOME, period.income], ["Despesas", EXPENDITURE, period.expenditure]] as const).map(([name, fields, values]) =>
          <table className="grid" key={name}>
            <caption>{name}</caption>
            <thead><tr><th>Rubrica</th><th className="num">Valor</th></tr></thead>
            <tbody>{fields.filter(([key]) => key in values).map(([key, label]) =>
              <tr key={key}><td>{label}</td><td className="num">{formatMoney(values[key])}</td></tr>)}</tbody>
            <tfoot><tr><th>Subtotal</th><td className="num">{formatMoney(sum(values))}</td></tr></tfoot>
          </table>)}
      </div>
      <p><strong>Resultado das rubricas exibidas</strong> {formatMoney(sum(period.income) - sum(period.expenditure))}</p>
    </>}
  </section>;
}
