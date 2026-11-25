import { useContext, useEffect, useState } from "react";
import { call } from "./api";
import { numberFromDate } from "./editing";
import { describeError, formatDate } from "./format";
import type { PanelIds } from "./ProfileParts";
import { youthIntakes } from "./scoutApi";
import type { GoldenGenerationPreview, MassReport, YouthIntakes } from "./types";
import { EditorContext } from "./useProfileEditing";
import "./ClubTools.css";

export function GoldenGeneration({ club, version, panel }: { club: number; version: number; panel: PanelIds }) {
  const editor = useContext(EditorContext);
  const [intakes, setIntakes] = useState<YouthIntakes>();
  const [loadError, setLoadError] = useState("");
  const [day, setDay] = useState<number | null>(null);
  const [minimum, setMinimum] = useState("160");
  const [reviewed, setPreview] = useState<GoldenGenerationPreview>();
  const [report, setReport] = useState<MassReport>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);

  useEffect(() => {
    let active = true;
    void youthIntakes(club).then(result => {
      if (!active) return;
      setIntakes(result);
      setLoadError("");
    }, reason => {
      if (!active) return;
      setIntakes(undefined);
      setLoadError(describeError(reason));
    });
    return () => { active = false; };
  }, [club, version]);

  const dated = intakes?.intakes.flatMap(intake => intake.joined ? [{ ...intake, key: numberFromDate(intake.joined) }] : []) ?? [];
  const selected = dated.find(intake => intake.key === day) ?? dated[0];
  const preview = reviewed?.day === selected?.key ? reviewed : undefined;
  const value = Number(minimum);
  const valid = Number.isInteger(value) && value >= 1 && value <= 200;
  const changed = preview?.rows.filter(row => row.proposedPa !== null && row.proposedPa !== row.previousPa).length ?? 0;

  const clearReview = () => {
    setPreview(undefined);
    setReport(undefined);
    setError("");
  };

  async function review() {
    if (!selected || !valid || !intakes?.marked || !editor.editable || busy) return;
    clearReview();
    setBusy("preview");
    try {
      setPreview(await call<GoldenGenerationPreview>("plan_golden_generation", { club, day: selected.key, minimum: value }));
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!preview || !changed || !selected || !intakes?.marked || !editor.editable || busy) return;
    setBusy("apply");
    setError("");
    try {
      const result = await call<MassReport>("apply_golden_generation", { club, id: preview.id });
      setReport(result);
      if (result.applied > 0) editor.onEdited();
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setPreview(undefined);
      setBusy(null);
    }
  }

  return <section className="club-tools" role="tabpanel" id={panel.id} aria-labelledby={panel.labelledBy}>
    <p className="note">Eleve o potencial (PA) dos jovens já gerados pelo FM na fornada escolhida. Os jogadores que já atingem o mínimo conservam seu PA.</p>
    {loadError && <p className="error" role="alert">{loadError}</p>}
    {!intakes && !loadError && <p role="status">Lendo as fornadas do clube…</p>}
    {intakes && !intakes.marked && <p className="note">A Geração de Ouro requer que esta versão do FM permita identificar os jogadores gerados pelo jogo.</p>}
    {intakes?.marked && !selected && <p className="note">Nenhuma fornada já admitida foi identificada neste clube.</p>}
    {intakes?.marked && selected && <>
      <div className="club-toolbar">
        <label>Fornada
          <select value={selected.key} disabled={busy !== null} onChange={e => {
            setDay(Number(e.currentTarget.value));
            clearReview();
          }}>
            {dated.map(intake => <option key={intake.key} value={intake.key}>
              {formatDate(intake.joined)} · {intake.players.length} jovem(ns)
            </option>)}
          </select>
        </label>
        <label>PA mínimo
          <input type="number" className="edit-input" style={{ width: "5.5em" }} min={1} max={200} step={1} value={minimum}
            aria-invalid={!valid || undefined} disabled={!editor.editable || busy !== null}
            onChange={e => { setMinimum(e.currentTarget.value); clearReview(); }} />
        </label>
        <button type="button" disabled={!valid || !editor.editable || busy !== null} onClick={() => void review()}>
          Gerar prévia de PA
        </button>
      </div>
      {!editor.editable && <p className="note">{editor.readOnlyNote}</p>}
      {!valid && <p className="note">Informe um PA inteiro de 1 a 200.</p>}
    </>}
    {busy && <p role="status">{busy === "preview" ? "Conferindo a fornada…" : "Aplicando o potencial…"}</p>}
    {preview && <>
      <div className="transfer-list">
        <table className="grid" aria-label="Prévia de PA da fornada">
          <thead><tr><th scope="col">Jogador</th><th scope="col">CA atual</th><th scope="col">PA atual</th>
            <th scope="col">PA proposto</th><th scope="col">Situação</th></tr></thead>
          <tbody>{preview.rows.map(row => <tr key={row.uid}>
            <th scope="row">{row.name}</th><td>{row.ca ?? "—"}</td><td>{row.previousPa ?? "—"}</td>
            <td>{row.proposedPa ?? "—"}</td>
            <td>{row.reason ?? (row.proposedPa === row.previousPa ? "Sem alteração" : "Elevar PA")}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="club-toolbar">
        <span>{changed > 0 ? `${changed} jogador(es) com alteração de PA` : "Nenhuma alteração de PA para aplicar."}</span>
        {changed > 0 && <button type="button" className="primary" disabled={!editor.editable || !intakes?.marked || !selected || busy !== null}
          onClick={() => void apply()}>Confirmar e aplicar PA</button>}
      </div>
    </>}
    {error && <p className="error" role="alert">{error}</p>}
    {report && <>
      <p role="status">{report.applied} jogador(es) com PA alterado.{report.applied > 0 && " Lote registrado no Histórico como Geração de Ouro."}</p>
      {report.failed.length > 0 && <ul className="error" aria-label="Alterações recusadas">
        {report.failed.map(issue => <li key={issue.uid}>{issue.name} · {describeError(issue.error)}</li>)}
      </ul>}
    </>}
  </section>;
}
