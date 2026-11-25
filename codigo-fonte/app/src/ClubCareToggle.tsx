import { useContext, useEffect, useRef, useState } from "react";
import { call } from "./api";
import { describeError } from "./format";
import type { FitnessTargets } from "./types";
import { EditorContext } from "./useProfileEditing";
import "./ClubTools.css";

interface CareStatus {
  enabled: boolean;
  relationships: boolean;
  event: number;
  error: string;
  activity: string;
  fitness: FitnessTargets;
}

const EMPTY: CareStatus = {
  enabled: false, relationships: false, event: 0, error: "", activity: "",
  fitness: { condition: 10000, sharpness: 10000 },
};

type FitnessDraft = { condition: string; sharpness: string };

/** Both settings are shared by every squad whose native maintenance is on. */
export function ClubCareToggle({ club, team, relationships = false, national = false }: {
  club: number;
  team: number;
  relationships?: boolean;
  national?: boolean;
}) {
  const editor = useContext(EditorContext);
  const edited = useRef(editor.onEdited);
  edited.current = editor.onEdited;
  const [status, setStatus] = useState<CareStatus>(EMPTY);
  const [draft, setDraft] = useState<FitnessDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const event = useRef<number | null>(null);
  const request = useRef(0);
  useEffect(() => {
    let cancelled = false;
    event.current = null;
    setStatus(EMPTY);
    setDraft(null);
    setError("");
    const read = async () => {
      const stamp = request.current;
      try {
        const next = await call<CareStatus>("club_care_status", { club, team, national });
        if (cancelled || stamp !== request.current || stamp % 2 !== 0) return;
        if (event.current !== null && event.current !== next.event) edited.current();
        event.current = next.event;
        setStatus(next);
      } catch (e) {
        if (!cancelled && stamp === request.current) setError(describeError(e));
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [club, team, national]);

  const displayed = draft ?? { condition: String(status.fitness.condition), sharpness: String(status.fitness.sharpness) };
  const fitness = { condition: Number(displayed.condition), sharpness: Number(displayed.sharpness) };
  const conditionValid = displayed.condition !== "" && Number.isInteger(fitness.condition)
    && fitness.condition >= 0 && fitness.condition <= 12749;
  const sharpnessValid = displayed.sharpness !== "" && Number.isInteger(fitness.sharpness)
    && fitness.sharpness >= 3500 && fitness.sharpness <= 12749;
  const valid = conditionValid && sharpnessValid;
  const dirty = fitness.condition !== status.fitness.condition || fitness.sharpness !== status.fitness.sharpness;

  const set = async (options: { enabled?: boolean; relationships?: boolean; fitness?: FitnessTargets }) => {
    request.current++;
    setBusy(true);
    setError("");
    try {
      const next = await call<CareStatus>("club_care_set", { club, team, national, ...options });
      setStatus(next);
      if (options.fitness) setDraft(null);
    } catch (e) {
      setError(describeError(e));
    } finally {
      request.current++;
      setBusy(false);
    }
  };

  return <div className="club-care" aria-label="Manutenção do elenco">
    <label>
      <input type="checkbox" checked={status.enabled}
        disabled={busy || (!status.enabled && (!editor.editable || !valid))}
        onChange={e => {
          const enabled = e.currentTarget.checked;
          void set({ enabled, ...(enabled && dirty && { fitness }) });
        }} />
      Manter melhorias do elenco
    </label>
    <div className="club-care-fitness" role="group" aria-label="Valores globais da manutenção">
      <label>Condição física (valor bruto)
        <input type="number" min="0" max="12749" step="1" value={displayed.condition}
          disabled={busy || !editor.editable} aria-invalid={!conditionValid || undefined}
          onChange={e => setDraft({ ...displayed, condition: e.currentTarget.value })} />
      </label>
      <label>Ritmo de jogo (valor bruto)
        <input type="number" min="3500" max="12749" step="1" value={displayed.sharpness}
          disabled={busy || !editor.editable} aria-invalid={!sharpnessValid || undefined}
          onChange={e => setDraft({ ...displayed, sharpness: e.currentTarget.value })} />
      </label>
      <button type="button" disabled={busy || !editor.editable || !valid || !dirty}
        onClick={() => void set({ fitness })}>Aplicar valores à manutenção</button>
    </div>
    {!valid && <p className="note">Informe a condição entre 0 e 12749 e o ritmo entre 3500 e 12749.</p>}
    <p className="note">10000 equivale a 100%. Os valores são compartilhados por todos os plantéis com a manutenção ativa e reaplicados a cada 3 segundos.</p>
    {valid && (fitness.condition > 10000 || fitness.sharpness > 10000) &&
      <p className="note">Valores acima de 10000 são experimentais.</p>}
    <p className="note">{national ? "Mantém moral e condição física e cura lesões da seleção principal." : "Mantém inspiração, condição física, cura de lesões, coesão e entendimento tático."}</p>
    {relationships && team === 0 && <>
      <label>
        <input type="checkbox" checked={status.relationships}
          disabled={busy || (!editor.editable && !status.relationships)}
          onChange={e => void set({ relationships: e.currentTarget.checked })} />
        Manter treino coletivo de entrosamento
      </label>
      <p className="note">Programa uma sessão de convívio por semana em um horário livre de descanso do clube selecionado no Trainer. O efeito vem do treino no jogo.</p>
    </>}
    {(status.enabled || status.relationships) && <span className="club-live">● Ativo em segundo plano</span>}
    {busy && <span className="note" role="status">Atualizando manutenção…</span>}
    {status.activity && <span className="note" role="status">{status.activity}</span>}
    {(error || status.error) && <p className="error" role="alert">{error || status.error}</p>}
  </div>;
}
