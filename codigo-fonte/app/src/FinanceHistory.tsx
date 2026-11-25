import { useEffect, useState } from "react";
import { call } from "./api";
import { describeError, formatDate, formatMoney } from "./format";
import type { FmDate } from "./types";

interface Snapshot {
  date: FmDate;
  balance: number;
  transferBudget: number;
  wageBudget: number;
}
interface History {
  profile: string | null;
  rows: Snapshot[];
}

export function FinanceHistory({ club, version }: { club: number; version: number }) {
  const [history, setHistory] = useState<History>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setHistory(undefined);
    setError("");
    void call<History>("club_finance_history", { club }).then(
      result => { if (active) setHistory(result); },
      reason => { if (active) setError(describeError(reason)); },
    );
    return () => { active = false; };
  }, [club, version]);

  async function capture() {
    setBusy(true);
    setError("");
    try {
      setHistory(await call<History>("club_finance_history", { club, capture: true, profile: history?.profile }));
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setBusy(false);
    }
  }

  const rows = history?.rows ?? [];
  return <section className="club-tools">
    <div className="club-toolbar">
      <h3>Histórico financeiro</h3>
      <button disabled={!history?.profile || busy} onClick={() => void capture()}>Registrar valores da data atual</button>
    </div>
    {history?.profile ? <p className="note">Carreira {history.profile}. Uma nova leitura da mesma data atualiza o registro.</p> :
      history && <p className="note">Associe um perfil da carreira em Treino → Desenvolvimento para guardar as leituras.</p>}
    {busy && <p role="status">Lendo os valores do FM…</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {rows.length > 0 && <div className="transfer-list"><table className="grid" aria-label="Registros financeiros por data do FM">
      <thead><tr><th>Data no FM</th><th>Saldo</th><th>Variação desde a leitura anterior</th>
        <th>Orçamento de transferências</th><th>Orçamento salarial semanal</th></tr></thead>
      <tbody>{rows.map((entry, index) => {
        const previous = rows[index - 1];
        return <tr key={formatDate(entry.date)}>
          <td>{formatDate(entry.date)}</td><td>{formatMoney(entry.balance)}</td>
          <td>{previous ? formatMoney(entry.balance - previous.balance) : "—"}</td>
          <td>{entry.transferBudget < 0 ? "—" : formatMoney(entry.transferBudget)}</td><td>{formatMoney(entry.wageBudget)}</td>
        </tr>;
      })}</tbody>
    </table></div>}
  </section>;
}
