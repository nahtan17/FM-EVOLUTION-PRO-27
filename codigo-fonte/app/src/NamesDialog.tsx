import { useContext, useEffect, useId, useRef, useState } from "react";
import { usePendingForm } from "./pendingEdits";
import { playerNames, renamePlayer } from "./editing";
import { describeError } from "./format";
import { renameText as text } from "./labels";
import type { NameKind, PersonNames } from "./types";
import { EditorContext } from "./useProfileEditing";

/** The player the dialog renames. */
interface RenamingPlayer {
  uid: number;
  name: string;
}

/** The names in the order the dialog shows them and writes them. */
const KINDS: readonly NameKind[] = ["first", "last", "common", "full"];

/** The hint under a name that can be left empty. */
const HINTS: Partial<Record<NameKind, string>> = {
  common: "Nome usado no jogo. Deixe em branco se o jogador não tiver apelido.",
  full: "Nome exibido na ficha. Deixe em branco se não houver um nome completo cadastrado.",
};

/** A name's value as typed, by kind. */
type Values = Record<NameKind, string>;

/** The names the game holds as the fields show them: no name is an empty field. */
function valuesOf(names: PersonNames): Values {
  return {
    first: names.first ?? "",
    last: names.last ?? "",
    common: names.common ?? "",
    full: names.full ?? "",
  };
}

export function PlayerNames({ player }: { player: RenamingPlayer }) {
  const { editable, onEdited } = useContext(EditorContext);
  const base = useId();
  const id = (part: string) => `${base}-${part}`;
  const alive = useRef(true);
  const running = useRef(false);

  // What the game holds, until it answers: null. A refused read leaves the names null and the reason in `loadFailure`.
  const [names, setNames] = useState<PersonNames | null>(null);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [values, setValues] = useState<Values>({ first: "", last: "", common: "", full: "" });
  const [renaming, setRenaming] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);


  // Focus starts on Cancel; the first name takes it once the names are in.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    playerNames(player.uid).then(
      (read) => {
        if (alive.current) {
          setNames(read);
          setValues(valuesOf(read));
        }
      },
      (e) => alive.current && setLoadFailure(describeError(e)),
    );
  }, [player.uid]);

  const unavailable = names !== null && names.room === null;

  /** What the name was in the game, "" for none. */
  const original = (kind: NameKind) => (names?.[kind] ?? "");
  /** The name as it would be written: what was typed without the spaces around it. */
  const written = (kind: NameKind) => values[kind].trim();
  const changed = (kind: NameKind) => names !== null && written(kind) !== original(kind);

  /** Why a name cannot be written, or null. Only a name that was changed is judged: the game's own stays as it is. */
  const problem = (kind: NameKind): string | null => {
    if (names === null || !changed(kind)) {
      return null;
    }
    const value = written(kind);
    if (value === "" && (kind === "first" || kind === "last")) {
      return text.required;
    }
    if (new TextEncoder().encode(value).length > names.longest) {
      return text.tooLong(names.longest);
    }
    // A name taken away needs no room; a new first, last or common name takes an entry of the game's tables.
    const index = kind === "first" ? 0 : kind === "last" ? 1 : kind === "common" ? 2 : null;
    if (value !== "" && index !== null && names.room?.[index] === 0) {
      return text.noRoom;
    }
    return null;
  };

  const anyChanged = KINDS.some(changed);
  const anyProblem = KINDS.some((kind) => problem(kind) !== null);
  const canRename = editable && names !== null && !unavailable && !renaming && anyChanged && !anyProblem;

  const rename = async () => {
    if (!canRename || running.current) {
      return false;
    }
    running.current = true;
    setRenaming(true);
    setFailure(null);
    const wrote: NameKind[] = [];
    try {
      // One name at a time, in the order they are shown: each is its own change in the log, and the first one the game
      // refuses stops the rest.
      for (const kind of KINDS) {
        if (changed(kind)) {
          const value = written(kind);
          await renamePlayer(player.uid, kind, value === "" ? null : value);
          wrote.push(kind);
        }
      }
      // The game has changed: the lists, the profile and the change log read it again.
      setNames(current => current && { ...current, ...Object.fromEntries(wrote.map(kind => [kind, written(kind)])) });
      onEdited();
      return true;
    } catch (e) {
      if (wrote.length > 0) {
        onEdited();
      }
      if (alive.current) {
        setFailure(describeError(e));
        // The names written before the failure are the game's now; the others keep what was typed, to be tried again.
        try {
          const now = await playerNames(player.uid);
          if (alive.current) {
            const game = valuesOf(now);
            setNames(now);
            setValues((typed) => {
              const kept = { ...typed };
              for (const kind of wrote) {
                kept[kind] = game[kind];
              }
              return kept;
            });
          }
        } catch {
          // The names stay as they were typed: the failure above is what there is to say.
        }
      }
      return false;
    } finally {
      running.current = false;
      if (alive.current) {
        setRenaming(false);
      }
    }
  };

  // What the dialog has to say about the names: the wait, the refusal to read them, or that the game cannot rename.
  const status: { tone: "pending" | "refused"; message: string } | null =
    loadFailure !== null
      ? { tone: "refused", message: loadFailure }
      : names === null
        ? { tone: "pending", message: text.loading }
        : unavailable
          ? { tone: "refused", message: text.unavailable }
          : null;

  const labels: Record<NameKind, string> = {
    first: text.first,
    last: text.last,
    common: text.common,
    full: text.full,
  };

  usePendingForm({
    profile: true,
    count: editable && !unavailable ? KINDS.filter(changed).length : 0,
    busy: renaming,
    validate: () => { if (anyProblem) throw Error("Corrija os nomes inválidos antes de salvar."); },
    save: rename,
  });

  return <section className="profile-group">
    <h3>Nomes do jogador</h3>
    <p className={`move-plan ${status?.tone ?? "pending"}`} role="status" hidden={status === null}>
      {status?.message}
    </p>

    {names !== null && (
      <div className="name-form">
        {KINDS.map((kind) => {
          const error = problem(kind);
          const hint = HINTS[kind];
          const describedBy = [hint && id(`${kind}-hint`), error && id(`${kind}-error`)]
            .filter(Boolean)
            .join(" ");
          return (
            <div key={kind} className="name-field">
              <label htmlFor={id(kind)}>{labels[kind]}</label>
              <input
                id={id(kind)}
                name={kind}
                type="text"
                className={`name-input${changed(kind) ? " changed" : ""}${error ? " invalid" : ""}`}
                value={values[kind]}
                placeholder={hint ? text.none : undefined}
                readOnly={!editable || unavailable || renaming}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy || undefined}
                onChange={(event) => setValues((current) => ({ ...current, [kind]: event.target.value }))}
              />
              {hint && (
                <p id={id(`${kind}-hint`)} className="name-hint">
                  {hint}
                </p>
              )}
              {error && (
                <p id={id(`${kind}-error`)} className="name-error">
                  {error}
                </p>
              )}
            </div>
          );
        })}
      </div>
    )}

    <p className="note">Use Salvar alterações para aplicar os nomes ao jogo.</p>
    {failure && <p className="error" role="alert">{failure}</p>}
  </section>;
}
