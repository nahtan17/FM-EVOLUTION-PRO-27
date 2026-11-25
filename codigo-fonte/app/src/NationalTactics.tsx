import { useContext, useRef, useState } from "react";
import { call } from "./api";
import { changeLog, undoBatch } from "./editing";
import { describeError, formatPercent } from "./format";
import { massEditText, nationalTeamLabel } from "./labels";
import { undoFailureLines } from "./massDraft";
import { ResultLine, type Result, type Undo } from "./SquadTab";
import type { MassReport } from "./types";
import { EditorContext } from "./useProfileEditing";

const AREAS = [
  "Linha de pressão", "Intensidade de pressão", "Armadilha de pressão",
  "Estilo de passe", "Construção", "Criação de chances",
];
const MAXIMUM = 100;
type Applied = MassReport & { session: string };

interface PlayerExposure {
  uid: number;
  name: string;
  exposure: (number | null)[];
  problem: string | null;
}

interface Preview {
  id: number | null;
  activeTactic: boolean;
  squadSize: number;
  players: PlayerExposure[];
  locked: unknown;
}

function hasChange(player: PlayerExposure, targets: (number | null)[]): boolean {
  return player.exposure.some((value, i) => value !== null && targets[i] !== null && value !== targets[i] * 100);
}

export function NationalTactics({ uid, kind }: { uid: number; kind: number }) {
  const editor = useContext(EditorContext);
  const [inputs, setInputs] = useState(() => AREAS.map(() => String(MAXIMUM)));
  const targets = inputs.map((value) => value === "" ? null : Number(value));
  const valid = targets.some((value) => value !== null) && targets.every((value) => value === null || (Number.isInteger(value) && value >= 0 && value <= MAXIMUM));
  const maximizing = targets.every((value) => value === MAXIMUM);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const resultBox = useRef<HTMLDivElement>(null);

  async function run(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setBusy(false);
    }
  }

  function showPreview(requested = targets) {
    void run(async () => {
      setPreview(null);
      const preview = await call<Preview>("preview_national_tactics", { uid, kind, targets: requested });
      setPreview(preview);
      setSelected(preview.players.filter((player) => hasChange(player, requested)).map((player) => player.uid));
    });
  }

  function apply() {
    if (!editor.editable || preview?.id == null || selected.length === 0) return;
    const id = preview.id;
    const confirmed = window.confirm(
      `Aplicar os valores de exposição para ${selected.length} convocado(s)? O clube também pode usar esses registros.`,
    );
    if (!confirmed) return;

    void run(async () => {
      setPreview(null);
      const report = await call<Applied>("apply_national_tactics", { uid, kind, id, selected });
      setResult({
        team: kind,
        message: `Exposição tática atualizada para ${report.applied} convocado(s).`,
        failed: false,
        problems: [],
        undo: report.applied > 0 ? () => undoBatch(report.batch, report.session) : null,
      });
      editor.onEdited();
    });
  }

  function undo(take: Undo) {
    void run(async () => {
      const done = await take();
      const log = done.failed.length ? await changeLog().catch(() => []) : [];
      setResult({
        team: kind,
        message: massEditText.undone(done.undone),
        failed: false,
        problems: undoFailureLines(done.failed, log),
        undo: done.failed.length ? take : null,
      });
      setPreview(null);
      if (done.undone) editor.onEdited();
    });
  }

  return (
    <section className="squad-ratings" aria-label={`Entendimento tático · ${nationalTeamLabel(kind)}`}>
      <div className="club-toolbar">
        <h3>Entendimento tático da seleção</h3>
        <button type="button" disabled={busy} onClick={() => {
          setInputs(AREAS.map(() => String(MAXIMUM)));
          showPreview(AREAS.map(() => MAXIMUM));
        }}>Preparar maximização a 100%</button>
        <button type="button" onClick={() => showPreview()} disabled={busy || !valid}>Ver prévia da tática ativa</button>
      </div>
      <p className="note">Informe valores de 0 a 100%. Deixe uma área vazia para manter seu valor. Os registros são compartilhados com o clube.</p>
      <div className="club-toolbar">
        {AREAS.map((area, i) => (
          <label key={area}>
            {area}
            <input type="number" min="0" max="100" step="1" value={inputs[i]} disabled={busy} onChange={(event) => {
              const value = event.currentTarget.value;
              setInputs((old) => old.map((current, index) => index === i ? value : current));
              setPreview(null);
            }} />
          </label>
        ))}
      </div>
      {preview && !preview.activeTactic && <p role="status">Nenhuma tática ativa encontrada para esta categoria.</p>}
      {preview?.activeTactic && (
        <>
          <p className="note">Tática ativa · {preview.players.length} de {preview.squadSize} convocado(s) lido(s).
            {" "}“—” indica área sem registro confirmado.</p>
          {preview.players.length > 0 && (
            <div className="squad-table-wrap">
              <table className="grid" aria-label="Prévia de entendimento tático da seleção">
                <thead>
                  <tr><th scope="col">Editar</th><th scope="col">Jogador</th>
                    {AREAS.map((area) => <th scope="col" className="num" key={area}>{area}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {preview.players.map((player) => {
                    const checked = selected.includes(player.uid);
                    return (
                      <tr key={player.uid}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Selecionar ${player.name}`}
                            disabled={busy || preview.id === null || !editor.editable || !hasChange(player, targets)}
                            checked={checked}
                            onChange={(event) => {
                              const include = event.currentTarget.checked;
                              setSelected((old) => include ? [...old, player.uid] : old.filter((uid) => uid !== player.uid));
                            }}
                          />
                        </td>
                        <th scope="row">{player.name}{player.problem && <div className="note">{player.problem}</div>}</th>
                        {player.exposure.map((value, i) => (
                          <td key={AREAS[i]} className="num">
                            {value === null ? "—" : formatPercent(value / 100, { maximumFractionDigits: 2 })}
                            {value !== null && targets[i] !== null && value !== targets[i] * 100 && checked && preview.id !== null && editor.editable && ` → ${targets[i]}%`}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="club-toolbar">
            <button
              type="button"
              disabled={busy || !editor.editable || preview.id === null || selected.length === 0}
              title={editor.editable ? undefined : editor.readOnlyNote}
              onClick={apply}
            >
              {maximizing ? "Maximizar entendimento tático" : "Aplicar ajustes por área"}
            </button>
            {preview.id !== null && editor.editable && <span>{selected.length} convocado(s) selecionado(s)</span>}
          </div>
          {Boolean(preview.locked) && <p className="note">{describeError(preview.locked)}</p>}
          {!preview.locked && !preview.players.some((player) => hasChange(player, targets)) && (
            <p className="note">Nenhum registro confirmado com valor diferente do solicitado.</p>
          )}
        </>
      )}
      {busy && <p role="status">Conferindo dados da seleção…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <ResultLine ref={resultBox} result={result} busy={busy} onUndo={undo} />
    </section>
  );
}
