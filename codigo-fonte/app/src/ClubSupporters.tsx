import { useContext, useEffect, useState } from "react";
import { call } from "./api";
import { undoChange } from "./editing";
import { describeError } from "./format";
import { clubProfileText as text, SUPPORTER_MIX_LABELS, SUPPORTER_TRAIT_LABELS } from "./labels";
import { tierClass } from "./ProfileParts";
import { usePendingForm } from "./pendingEdits";
import type { ClubDetails } from "./types";
import { EditorContext } from "./useProfileEditing";

// The native command takes arrays in FM's layout order, independent of the interface language.
const traits = (["loyalty", "passion", "patience", "affluence", "temperament", "expectations"] as const)
  .map(key => [key, SUPPORTER_TRAIT_LABELS[key]] as const);
const mix = (["hardcore", "core", "family", "fair_weather", "corporate", "casual"] as const)
  .map(key => [key, SUPPORTER_MIX_LABELS[key]] as const);
type Group = "traits" | "mix";
type Values = Record<string, number>;
type Draft = Partial<Record<Group, Record<string, string>>>;

function wholeNumber(raw: string, min: number, max: number): number | null {
  const value = Number(raw);
  return /^\d+$/.test(raw.trim()) && value >= min && value <= max ? value : null;
}

export function ClubSupporters({ details }: { details: ClubDetails }) {
  const { editable, onEdited, readOnlyNote } = useContext(EditorContext);
  const [draft, setDraft] = useState<Draft>({});
  const [revision, setRevision] = useState<string>();
  const [saved, setSaved] = useState<Partial<Record<Group, Values>>>();
  const [reviewing, setReviewing] = useState(false);
  const [last, setLast] = useState<number>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const access = details.supporterAccess;

  useEffect(() => { setSaved(undefined); }, [details]);

  const values = { traits: saved?.traits ?? details.supporterTraits, mix: saved?.mix ?? details.supporterMix };
  const canEdit = (group: Group) => editable && !!access?.[group];
  const stale = revision !== undefined && revision !== access?.revision;
  const shown = (group: Group, key: string) => draft[group]?.[key] ?? String(values[group][key]);
  const number = (group: Group, key: string) => wholeNumber(shown(group, key), group === "traits" ? 1 : 0, group === "traits" ? 20 : 100);
  const changed = (group: Group, key: string) => number(group, key) !== values[group][key];
  const dirty = (group: Group) => Object.keys(draft[group] ?? {}).filter(key => changed(group, key));
  const changedTraits = dirty("traits");
  const changedMix = dirty("mix");
  const shares = mix.map(([key]) => number("mix", key));
  const total = shares.some(share => share === null) ? null : shares.reduce<number>((sum, share) => sum + (share ?? 0), 0);

  const collect = () => {
    if (stale) throw Error("Os dados da torcida mudaram. Descarte o rascunho e confira os valores atuais.");
    const edit: Partial<Record<Group, number[]>> = {};
    if (changedTraits.length) {
      if (!canEdit("traits")) throw Error("Os atributos da torcida estão somente para leitura.");
      const next = traits.map(([key]) => number("traits", key));
      if (next.some(value => value === null)) throw Error("Use números inteiros de 1 a 20 nos atributos da torcida.");
      edit.traits = next as number[];
    }
    if (changedMix.length) {
      if (!canEdit("mix")) throw Error("O perfil da torcida está somente para leitura.");
      if (total !== 100) throw Error("Use percentuais inteiros de 0 a 100 e mantenha a soma em 100%.");
      edit.mix = shares as number[];
    }
    return edit;
  };

  async function save() {
    if (!access || busy) return false;
    setBusy(true);
    setError("");
    try {
      const edit = collect();
      const result = await call<{ id: number }>("set_club_supporters", { uid: details.uid, revision: access.revision, edit });
      setLast(result.id);
      setMessage("Alterações da torcida aplicadas.");
      setReviewing(false);
      setSaved({
        ...edit.traits && { traits: Object.fromEntries(traits.map(([key], index) => [key, edit.traits![index]])) },
        ...edit.mix && { mix: Object.fromEntries(mix.map(([key], index) => [key, edit.mix![index]])) },
      });
      setDraft({});
      setRevision(undefined);
      onEdited();
      return true;
    } catch (err) {
      setError(describeError(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const count = changedTraits.length + changedMix.length;
  usePendingForm({ count, profile: true, busy, validate: collect, save });

  const discard = () => {
    setDraft({});
    setRevision(undefined);
    setError("");
    setReviewing(false);
  };
  function review() {
    try {
      collect();
      setError("");
      setReviewing(true);
    } catch (err) {
      setError(describeError(err));
    }
  }
  async function undo() {
    if (last === undefined || busy) return;
    setBusy(true);
    setError("");
    try {
      await undoChange(last);
      setLast(undefined);
      setMessage("Alteração da torcida desfeita.");
      onEdited();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }
  const input = (group: Group, key: string, label: string) => (
    <input
      type="text"
      inputMode="numeric"
      className={"edit-input" + (number(group, key) === null ? " invalid" : changed(group, key) ? " changed" : "")}
      style={{ width: "4ch" }}
      aria-label={label}
      aria-invalid={number(group, key) === null || undefined}
      value={shown(group, key)}
      disabled={busy || stale || !!saved}
      onFocus={event => event.currentTarget.select()}
      onChange={event => {
        const raw = event.currentTarget.value;
        if (!count) setRevision(access?.revision);
        setDraft(previous => ({ ...previous, [group]: { ...previous[group], [key]: raw } }));
        setError("");
        setReviewing(false);
        setMessage("");
      }}
    />
  );

  const hasTraits = traits.some(([key]) => values.traits[key] !== undefined);
  const hasMix = mix.some(([key]) => values.mix[key] > 0);
  return (
    <section className="profile-group">
      <h3>{text.supporters}</h3>
      {hasTraits && (
        <dl className="stats ratings">
          {traits.filter(([key]) => values.traits[key] !== undefined).map(([key, label]) => (
            <div key={key} className="stat">
              <dt>{label}</dt>
              <dd className={canEdit("traits") ? "edit-cell" : "value " + tierClass(values.traits[key])}>
                {canEdit("traits") ? input("traits", key, label) : values.traits[key]}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {hasMix && (
        <div className="mix">
          <h4>{text.supporterMix}</h4>
          <div className="mix-bar" aria-hidden="true">
            {mix.map(([key, label]) => {
              const value = (canEdit("mix") ? number("mix", key) : values.mix[key]) ?? 0;
              return value > 0 && <span key={key} className={"mix-" + key} style={{ flexGrow: value }} title={text.mixTooltip(label, text.percent(value))} />;
            })}
          </div>
          <ul className="legend mix-legend">
            {mix.filter(([key]) => values.mix[key] !== undefined).map(([key, label]) => (
              <li key={key} className={"mix-" + key}>
                <span className="swatch" />
                {label}
                <span className="range">{canEdit("mix") ? <>{input("mix", key, label)}%</> : text.percent(values.mix[key])}</span>
              </li>
            ))}
          </ul>
          {canEdit("mix") && <p role="status" className={changedMix.length && total !== 100 ? "note error" : "note"}>
            {total === null ? "Use percentuais inteiros de 0 a 100." : "Total " + total + "% de 100%"}
          </p>}
        </div>
      )}
      {!hasTraits && !hasMix && <p className="note">Dados da torcida indisponíveis para este clube.</p>}
      {(hasTraits || hasMix) && !editable && <p className="note">{readOnlyNote || "Torcida disponível somente para leitura."}</p>}
      {editable && hasTraits && !access?.traits && <p className="note">Os atributos desta torcida estão disponíveis somente para leitura.</p>}
      {editable && hasMix && !access?.mix && <p className="note">O perfil desta torcida está disponível somente para leitura.</p>}
      {reviewing && count > 0 && !stale && <table className="grid" aria-label="Conferência das alterações da torcida">
        <thead><tr><th>Campo</th><th>Valor original</th><th>Novo valor</th></tr></thead>
        <tbody>{([["traits", traits, changedTraits], ["mix", mix, changedMix]] as const).flatMap(
          ([group, labels, keys]) => labels.filter(([key]) => keys.includes(key)).map(([key, label]) => {
            const unit = group === "mix" ? "%" : "";
            return <tr key={key}><td>{label}</td><td>{values[group][key]}{unit}</td><td>{number(group, key)}{unit}</td></tr>;
          }),
        )}</tbody>
      </table>}
      <div className="club-toolbar">
        {(count > 0 || stale) && <button type="button" disabled={busy} onClick={discard}>Restaurar valores originais</button>}
        {count > 0 && !stale && !reviewing &&
          <button type="button" disabled={busy} onClick={review}>Conferir alterações</button>}
        {count > 0 && !stale && reviewing &&
          <button className="primary" type="button" disabled={busy || !editable} onClick={() => void save()}>Aplicar alterações</button>}
        {last !== undefined && count === 0 && <button type="button" disabled={busy || !editable || !!saved}
          onClick={() => void undo()}>Desfazer última alteração</button>}
      </div>
      {message && <p role="status">{message}</p>}
      {(stale || error) && <p role="alert" className="error">{error || "Os dados da torcida mudaram. Descarte o rascunho antes de editar."}</p>}
    </section>
  );
}
