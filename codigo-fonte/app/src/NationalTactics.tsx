import { useContext, useRef, useState } from "react";
import { call } from "./api";
import { changeLog, undoBatch } from "./editing";
import { describeError } from "./format";
import { massEditText, nationalTeamLabel } from "./labels";
import { undoFailureLines } from "./massDraft";
import { ResultLine, type Result, type Undo } from "./SquadTab";
import type { MassReport } from "./types";
import { EditorContext } from "./useProfileEditing";

const AREAS = 6;
const MAXIMUM = 100;
const TARGETS = Array.from({ length: AREAS }, () => MAXIMUM);
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

function hasChange(player: PlayerExposure): boolean {
  return player.exposure.some((value) => value !== null && value !== MAXIMUM * 100);
}

export function NationalTactics({ uid, kind }: { uid: number; kind: number }) {
  const editor = useContext(EditorContext);
  const [statusNote, setStatusNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const resultBox = useRef<HTMLDivElement>(null);

  async function run(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setStatusNote("");
    try {
      await task();
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setBusy(false);
    }
  }

  function maximize() {
    if (!editor.editable) return;
    void run(async () => {
      const preview = await call<Preview>("preview_national_tactics", { uid, kind, targets: TARGETS });
      if (!preview.activeTactic) {
        setStatusNote("Nenhuma tática ativa encontrada para esta categoria.");
        return;
      }
      if (preview.locked) {
        setStatusNote(describeError(preview.locked));
        return;
      }
      const selected = preview.players.filter(hasChange).map((player) => player.uid);
      if (preview.id === null || selected.length === 0) {
        setStatusNote("Nenhum registro confirmado com valor abaixo de 100%.");
        return;
      }
      const confirmed = window.confirm(
        `Maximizar o entendimento tático para ${selected.length} convocado(s)? O clube também pode usar esses registros.`,
      );
      if (!confirmed) return;

      const report = await call<Applied>("apply_national_tactics", { uid, kind, id: preview.id, selected });
      setResult({
        team: kind,
        message: `Tática da seleção maximizada para ${report.applied} convocado(s).`,
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
      if (done.undone) editor.onEdited();
    });
  }

  return (
    <section className="squad-ratings" aria-label={`Entendimento tático · ${nationalTeamLabel(kind)}`}>
      <div className="club-toolbar">
        <h3>Entendimento tático da seleção</h3>
        <button
          type="button"
          disabled={busy || !editor.editable}
          title={editor.editable ? undefined : editor.readOnlyNote}
          onClick={maximize}
        >
          Maximizar tática da seleção
        </button>
      </div>
      {busy && <p role="status">Conferindo dados da seleção…</p>}
      {statusNote && <p className="note" role="status">{statusNote}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <ResultLine ref={resultBox} result={result} busy={busy} onUndo={undo} />
    </section>
  );
}
