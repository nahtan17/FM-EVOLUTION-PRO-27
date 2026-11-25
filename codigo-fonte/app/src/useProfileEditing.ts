// The state of editing one profile (a player's, a member of staff's or a club's): the inputs, what Apply did,
// and the question asked before changes are lost.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { PendingScope, confirmPendingNavigation, usePendingForm } from "./pendingEdits";
import { inputState, judge, summarize, type InputState, type Pending, type Typed } from "./editDraft";
import { applyEdits, readValues } from "./editing";
import { orderStadiumEdits } from "./stadiumDraft";
import { fieldTable } from "./fieldTables";
import { describeError } from "./format";
import { editText, fieldLabel } from "./labels";
import type { EditEntity, EditField, FieldValues, FmDate, LoggedChange } from "./types";

/** What the app tells the profiles about editing. */
export interface EditorState {
  /**
   * False when nothing can be edited: the system did not let the app write to the game, or the game is a version the
   * editor was not checked with and Edit anyway was not pressed.
   */
  editable: boolean;
  /** Why nothing can be edited, for the hover of what is turned off: the colophon's note. */
  readOnlyNote: string;
  /** Whether the editor can arrange a transfer for the game to make on its next day (see `arrangeTransfer`). */
  arrangesTransfers: boolean;
  gameDate?: FmDate | null;
  /** Called after changes were written or undone: the lists, the open profile and the change log read again. */
  onEdited: () => void;
  openPlayer?: (player: import("./types").PlayerSummary) => void;
}

export const EditorContext = createContext<EditorState>({ editable: false, readOnlyNote: "", arrangesTransfers: false, onEdited: () => {} });

/** The inputs of the profile being edited (header and body), for the components that draw them. */
export interface EditSession {
  entity: EditEntity;
  /** Whether the field with this key can be edited here. */
  has: (key: string) => boolean;
  input: (key: string) => InputState | null;
  type: (key: string, text: string) => void;
  /** Adds original stored values to the draft while preserving manual or imported changes already pending. */
  stageAttributes: (values: FieldValues) => void;
  /** Stages 20 for all supported attribute and personality fields of this person. */
  maximizeAttributes: (rating?: number) => number;
  rawFitness?: { enabled: boolean; canToggle: boolean; toggle: () => void };
  /** True while the changes are written: the inputs wait. */
  busy: boolean;
}

/** The inputs of the profile around the reader; null while it is not being edited. */
export const SessionContext = createContext<EditSession | null>(null);

export const useEditSession = () => useContext(SessionContext);

/** Whether the field `field`, if there is one, is an input at the moment. */
export function useEditableField(field: string | undefined): boolean {
  const session = useEditSession();
  return session !== null && field !== undefined && session.has(field);
}

/** View: the profile as it is read. Loading: the field table and the values are being read. Edit: the inputs. */
export type Stage = "view" | "loading" | "edit";

/** What the last Apply did, or why editing could not start. */
export interface Report {
  /** How many changes were written. */
  applied: number;
  /** What went wrong, as lines of text: changes the game refused, and failures of the calls themselves. */
  problems: string[];
}

export interface ProfileEditing {
  /** False when Windows did not allow writing: the profile then has no Edit button. */
  editable: boolean;
  stage: Stage;
  /** The inputs, while editing. */
  session: EditSession | null;
  /** What Apply would write, in the order of the field table. */
  changes: Pending[];
  /** How many inputs hold something that cannot be written. */
  invalid: number;
  /** Whether the list of changes is open. */
  reviewing: boolean;
  /** Whether the footer asks to discard the changes. */
  confirming: boolean;
  applying: boolean;
  report: Report | null;
  /** The Edit button, so that focus can come back to it. */
  editButton: RefObject<HTMLButtonElement | null>;
  /** Reads the field table and the values, then shows the inputs. */
  begin: () => void;
  apply: () => void;
  /** Puts every input back to the value the game has. */
  discard: () => void;
  /** Leaves edit mode, asking first when changes are pending. */
  done: () => void;
  /** The answers to that question. */
  keepEditing: () => void;
  confirmDiscard: () => void;
  toggleReview: () => void;
  dismissReport: () => void;
  /** The close button: closes the profile with `close`, asking first when changes are pending. */
  guardClose: (close: () => void) => void;
  /** Escape: answers the question, else leaves edit mode, else closes the profile with `close`. */
  escape: (close: () => void) => void;
}

/**
 * The profile being edited, if any, is asked before something else takes its place, such as another row or
 * another view. Set while changes are pending: it shows its question and runs `proceed` if they are discarded.
 */


/** Runs `proceed`, unless the profile being edited has changes pending: it asks first. */
export function askToLeave(proceed: () => void): void {
  if (confirmPendingNavigation()) proceed();
}

/** What the keyboard shortcuts and the command palette reach of a profile on show (see `App`). */
export interface ProfileKeys {
  /** The profile's panel; null while it has no Edit button. */
  box: () => Element | null;
  /** Whether its Edit button can be pressed now: the profile can be edited, and has been read. */
  canEdit: () => boolean;
  /** Whether it is being edited. */
  editing: boolean;
  /** Whether Apply has something to write. */
  canApply: boolean;
  /** Presses Edit: starts the editing, or ends it as Done does. */
  toggleEdit: () => void;
  apply: () => void;
}

/** The profiles on show, the one opened last at the end: a profile opened from a club's squad is over the club's. */
const openProfiles: RefObject<ProfileKeys | null>[] = [];

/** The profile the keyboard shortcuts are for: the one opened last. Null when none is on show. */
export const profileOnTop = (): ProfileKeys | null => openProfiles[openProfiles.length - 1]?.current ?? null;

/** The editing of the player, member of staff or club `uid`, as `entity` says. Mount it with `key={uid}`. */
export function useProfileEditing(entity: EditEntity, uid: number, version: number, stadiumKey?: string): ProfileEditing {
  const { editable, onEdited } = useContext(EditorContext);
  const scope = useContext(PendingScope) ?? undefined;
  const [stage, setStage] = useState<Stage>("view");
  const [fields, setFields] = useState<EditField[]>([]);
  const [rawFitness, setRawFitness] = useState(false);
  // The values the game had when editing began or when the changes were last written, as stored.
  const [start, setStart] = useState<FieldValues>({});
  const [typed, setTyped] = useState<Typed>({});
  // The changes the game refused, with its reasons, until their inputs are typed into again.
  const [refused, setRefused] = useState<Partial<Record<string, string>>>({});
  const [reviewing, setReviewing] = useState(false);
  // Set while the footer asks whether to discard the changes. `then` is what the discarding was for.
  const [confirm, setConfirm] = useState<{ then?: () => void } | null>(null);
  const [applying, setApplying] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const alive = useRef(true);
  const editButton = useRef<HTMLButtonElement>(null);
  const stadiumAtEdit = useRef<string | undefined>(undefined);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const editing = editable && stage === "edit";
  const profileFields = useMemo(() => rawFitness ? fields.map(field => field.rawFitnessMax === undefined
    ? field : { ...field, scale: "plain" as const, max: field.rawFitnessMax }) : fields, [fields, rawFitness]);
  const byKey = useMemo(() => new Map(profileFields.map(field => [field.key, field] as const)), [profileFields]);
  const { changes, invalid } = useMemo(() => summarize(profileFields, start, typed), [profileFields, start, typed]);

  const type = useCallback((key: string, text: string) => {
    if (key.startsWith("stadium.") && !Object.keys(typed).some(key => key.startsWith("stadium."))) {
      stadiumAtEdit.current = stadiumKey;
    }
    const field = byKey.get(key);
    const unchangedFitness = field?.rawFitnessMax !== undefined && judge(field, start[key], text).status === "same";
    setTyped((old) => unchangedFitness ? without(old, key) : { ...old, [key]: text });
    setRefused((old) => (old[key] === undefined ? old : without(old, key)));
  }, [stadiumKey, typed, byKey, start]);

  const session = useMemo<EditSession | null>(() => {
    if (!editing) {
      return null;
    }
    const isPerson = entity === "player" || entity === "staff";
    const fitnessKeys = fields.filter(field => field.rawFitnessMax !== undefined && start[field.key] !== undefined)
      .map(field => field.key);
    const canToggleFitness = !applying && !fitnessKeys.some(key => typed[key] !== undefined);
    return {
      entity,
      busy: applying,
      rawFitness: fitnessKeys.length ? {
        enabled: rawFitness,
        canToggle: canToggleFitness,
        toggle: () => { if (canToggleFitness) setRawFitness(value => !value); },
      } : undefined,
      has: (key) => byKey.has(key) && start[key] !== undefined,
      input: (key) => {
        const field = byKey.get(key);
        const stored = start[key];
        return field === undefined || stored === undefined ? null : inputState(field, stored, typed[key], refused[key]);
      },
      type,
      stageAttributes: values => {
        if (applying || !isPerson) return;
        setTyped(previous => {
          const next = { ...previous };
          for (const [key, value] of Object.entries(values)) {
            if (!isAttributeField(key)) continue;
            const field = byKey.get(key);
            const stored = start[key];
            if (field && stored !== undefined && refused[key] === undefined
                && judge(field, stored, previous[key]).status === "same"
                && judge(field, stored, value).status === "changed") {
              next[key] = value;
            }
          }
          return next;
        });
      },
      maximizeAttributes: (rating = 20) => {
        if (applying || !isPerson || !Number.isInteger(rating) || rating < 1 || rating > 20) return 0;
        const maximums = Object.fromEntries(fields.flatMap(field => {
          if (!isAttributeField(field.key)) return [];
          const stored = start[field.key];
          const value = field.scale === "attribute" ? rating * 5 : rating;
          return stored !== undefined && field.min <= value && field.max >= value
            ? [[field.key, value] as const] : [];
        }));
        setTyped(previous => {
          const next = { ...previous };
          for (const [key, value] of Object.entries(maximums)) {
            if (value === start[key]) delete next[key];
            else next[key] = value;
          }
          return next;
        });
        setRefused(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !(key in maximums))));
        return Object.keys(maximums).length;
      },
    };
  }, [editing, entity, applying, fields, byKey, start, typed, refused, type, rawFitness]);

  /** Leaves edit mode and forgets what was typed. `keepReport` keeps what the last Apply said. */
  const stop = (keepReport: boolean, focus = true) => {
    setStage("view");
    setTyped({});
    setRefused({});
    setReviewing(false);
    setConfirm(null);
    if (!keepReport) {
      setReport(null);
    }
    if (focus) {
      editButton.current?.focus();
    }
  };

  const begin = async () => {
    if (!editable || stage !== "view") {
      return;
    }
    setStage("loading");
    setReport(null);
    try {
      const [table, values] = await Promise.all([fieldTable(entity), readValues(entity, uid)]);
      if (!alive.current) {
        return;
      }
      setFields(table);
      setStart(values);
      setTyped({});
      setRefused({});
      setReviewing(false);
      setConfirm(null);
      setStage("edit");
    } catch (e) {
      if (alive.current) {
        setStage("view");
        setReport({ applied: 0, problems: [editText.startFailed(describeError(e))] });
      }
    }
  };

  useEffect(() => {
    if (editable) void begin();
  }, [editable]);

  useEffect(() => {
    if (!editable || stage !== "edit" || Object.keys(typed).length || applying) return;
    let relevant = true;
    void readValues(entity, uid).then(values => {
      if (relevant) setStart(values);
    }, () => {});
    return () => { relevant = false; };
  }, [version, editable, stage, typed, applying, entity, uid]);

  // Where keyboard focus goes when an Apply that left the inputs open is over: the buttons are disabled while it
  // runs, and focus on one of them would be lost.
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    if (!applying && refocus.current !== null) {
      editButton.current?.closest(".profile")?.querySelector<HTMLElement>(refocus.current)?.focus();
      refocus.current = null;
    }
  }, [applying]);

  const apply = async () => {
    if (!editing || applying || changes.length === 0 || invalid.length > 0) {
      return false;
    }
    setApplying(true);
    setReport(null);
    setConfirm(null);
    try {
      const ordered = entity === "club" ? orderStadiumEdits(changes, start) : changes;
      const result = await applyEdits(entity, uid, ordered.map(change => {
        if (rawFitness && change.field.rawFitnessMax !== undefined) {
          return { ...change.edit, expected: change.wasStored, rawFitness: true };
        }
        return change.edit.field.startsWith("stadium.") || typeof typed[change.edit.field] === "number"
          ? { ...change.edit, expected: change.wasStored }
          : change.edit;
      }), stadiumAtEdit.current);
      // The game has changed: the lists, the profile and the change log read it again, whatever happens next.
      if (result.applied.length > 0) {
        onEdited();
      }
      const problems = result.failed.map((failed) =>
        editText.refused(fieldLabel(entity, failed.field), describeError(failed.error)),
      );
      let values: FieldValues | null = null;
      try {
        values = await readValues(entity, uid);
      } catch (e) {
        problems.push(editText.rereadFailed(describeError(e)));
      }
      if (!alive.current) return false;
      const refusals = Object.fromEntries(
        result.failed.map((failed) => [failed.field, describeError(failed.error)] as const),
      );
      const refusedKeys = Object.keys(refusals);
      // The inputs show the game's values again; the ones the game refused keep what was typed.
      setStart((old) => values ?? withWritten(old, result.applied));
      setTyped((old) => only(old, refusedKeys));
      setRefused(refusals);
      setReport({ applied: result.applied.length, problems });
      if (refusedKeys.length > 0) {
        refocus.current = `[data-field="${refusedKeys[0]}"]`;
      }
      return problems.length === 0;
    } catch (e) {
      if (alive.current) {
        setReport({ applied: 0, problems: [describeError(e)] });
        refocus.current = ".edit-footer .primary";
      }
      return false;
    } finally {
      setApplying(false);
    }
  };

  usePendingForm({
    profile: true,
    fields: changes.map(({ edit }) => edit.field.startsWith("stadium.") && stadiumAtEdit.current
      ? `stadium:${stadiumAtEdit.current}:${edit.field}` : `${entity}:${uid}:${edit.field}`),
    count: editing ? changes.length + invalid.length : 0,
    busy: applying,
    validate: () => {
      if (invalid.length) throw Error(`${invalid.map(field => fieldLabel(entity, field)).join(", ")}. Confira os valores e tente novamente.`);
      if (entity === "club") orderStadiumEdits(changes, start);
    },
    save: apply,
  });

  const discard = () => {
    setTyped({});
    setRefused({});
    setReport(null);
    setConfirm(null);
  };

  const done = () => {
    if (applying) {
      return;
    }
    if (changes.length + invalid.length > 0) {
      setConfirm({});
    } else {
      stop(false);
    }
  };

  const confirmDiscard = () => {
    const then = confirm?.then;
    discard();
    then?.();
  };

  const guardClose = (close: () => void) => {
    if (applying) {
      return;
    }
    if (editing && changes.length + invalid.length > 0) {
      if (confirmPendingNavigation(true, scope)) setConfirm({ then: close });
    } else if (confirmPendingNavigation(false, scope)) {
      close();
    }
  };

  const escape = (close: () => void) => {
    if (applying) {
      return;
    }
    if (confirm !== null) {
      setConfirm(null);
    } else {
      guardClose(close);
    }
  };

  // What the keyboard shortcuts reach of this profile, kept up to date as soon as a render is on screen.
  const keys = useRef<ProfileKeys | null>(null);
  useLayoutEffect(() => {
    keys.current = {
      box: () => editButton.current?.closest(".profile") ?? null,
      canEdit: () => editButton.current !== null && !editButton.current.disabled,
      editing,
      canApply: editing && !applying && changes.length > 0 && invalid.length === 0,
      toggleEdit: () => editButton.current?.click(),
      apply,
    };
  });
  useEffect(() => {
    openProfiles.push(keys);
    return () => {
      openProfiles.splice(openProfiles.indexOf(keys), 1);
    };
  }, []);

  return {
    editable,
    stage,
    session,
    changes,
    invalid: invalid.length,
    reviewing,
    confirming: confirm !== null,
    applying,
    report,
    editButton,
    begin,
    apply,
    discard,
    done,
    keepEditing: () => setConfirm(null),
    confirmDiscard,
    toggleReview: () => setReviewing((open) => !open),
    dismissReport: () => setReport(null),
    guardClose,
    escape,
  };
}

function isAttributeField(key: string): boolean {
  return key.startsWith("attribute.") || key.startsWith("personality.");
}

/** `record` without `key`. */
function without<T>(record: Partial<Record<string, T>>, key: string): Partial<Record<string, T>> {
  const rest = { ...record };
  delete rest[key];
  return rest;
}

/** The text typed for `keys`, and nothing else. */
function only(typed: Typed, keys: readonly string[]): Typed {
  const kept: Typed = {};
  for (const key of keys) {
    const text = typed[key];
    if (text !== undefined) {
      kept[key] = text;
    }
  }
  return kept;
}

/** `values` with the values that were just written on top. */
function withWritten(values: FieldValues, applied: readonly LoggedChange[]): FieldValues {
  return { ...values, ...Object.fromEntries(applied.map((change) => [change.field, change.new] as const)) };
}
