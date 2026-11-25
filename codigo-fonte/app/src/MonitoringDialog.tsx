import { useEffect, useRef, useState } from "react";
import { call } from "./api";
import { CopyDiagnostics } from "./CopyDiagnostics";
import { describeError, formatDate } from "./format";
import type { CheckKey, ConnectionInfo } from "./types";
import { useModal } from "./useModal";

const names: Record<CheckKey, string> = {
  gameDate: "Data da carreira", players: "Jogadores", positions: "Posições", attributes: "Atributos",
  personality: "Personalidade", liveValues: "Condição e ritmo", contracts: "Contratos", teams: "Plantéis",
  staff: "Comissão técnica", clubs: "Clubes", cohesion: "Coesão", tactics: "Tática",
};

interface DevelopmentReport {
  failures: number;
  error: string | null;
  report?: { uid: number; name: string; status: string; reason: string | null }[];
}

export function MonitoringDialog({ mode, connection, saveChanged, onClose }: {
  mode: "alerts" | "integrity"; connection: ConnectionInfo | null; saveChanged: boolean; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [development, setDevelopment] = useState<DevelopmentReport>();
  const [error, setError] = useState("");
  useModal(ref, true, onClose);
  const connected = connection !== null;

  useEffect(() => {
    if (!connected || mode !== "alerts") return;
    let active = true;
    const read = () => void call<DevelopmentReport>("development_status").then(
      report => { if (active) { setDevelopment(report); setError(""); } },
      reason => { if (active) setError(describeError(reason)); },
    );
    read();
    const timer = window.setInterval(read, 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, [connected, mode]);

  const checks = connection?.health.results ?? [];
  const alerts = [
    !connected ? "O editor está desconectado do FM." : null,
    saveChanged ? "O FM carregou outro save. Recarregue os dados no editor." : null,
    connection && !connection.knownBuild ? "Esta versão do jogo não tem um perfil reconhecido." : null,
    connection && !connection.writable ? "O processo do FM está disponível apenas para leitura." : null,
    ...checks.filter(check => !check.passed).map(check => `Verificação pendente ou com falha em ${names[check.check]}.`),
    connected ? development?.error : null,
    connected && development?.failures ? `${development.failures} falha(s) na última verificação de desenvolvimento.` : null,
    error,
  ].filter(Boolean);
  const title = mode === "alerts" ? "Central de alertas" : "Verificador de integridade";
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <header className="modal-header"><h2>{title}</h2><button onClick={onClose}>Fechar</button></header>
      <div className="modal-body">
        {mode === "alerts" ? alerts.length ? <ul>{alerts.map((alert, index) => <li key={index}>{alert}</li>)}</ul> :
          <p>Nenhum alerta nas verificações acompanhadas.</p> : <>
          <p>{connection ? `${connection.profile ?? "Perfil não identificado"} · ${formatDate(connection.gameDate) || "Data indisponível"}` :
            "Conecte o FM para ver as verificações da carreira."}</p>
          {checks.length > 0 && <table className="grid">
            <thead><tr><th>Verificação</th><th>Estado</th><th>Registros compatíveis</th></tr></thead>
            <tbody>{checks.map(check => <tr key={check.check}><td>{names[check.check]}</td>
              <td>{check.passed ? "Passou" : "Pendente ou com falha"}</td>
              <td>{check.sampled ? `${check.fit} / ${check.sampled}` : "Sem amostra"}</td></tr>)}</tbody>
          </table>}
        </>}
        {connected && <CopyDiagnostics />}
      </div>
    </div>
  </div>;
}
