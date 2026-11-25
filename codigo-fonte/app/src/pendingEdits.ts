import { createContext, useContext, useLayoutEffect, useRef, useSyncExternalStore } from "react";

export const PendingScope = createContext<string | null>(null);

interface PendingForm {
  count: number;
  profile?: boolean;
  fields?: string[];
  busy: boolean;
  validate: () => void;
  save: () => Promise<boolean>;
}

const forms = new Map<symbol, PendingForm & { scope: string | null }>();
const listeners = new Set<() => void>();
let revision = 0;
let saving = false;
let feedback = "";
const emit = () => { revision++; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function usePendingForm(form: PendingForm) {
  const scope = useContext(PendingScope);
  const id = useRef(Symbol());
  useLayoutEffect(() => () => { forms.delete(id.current); emit(); }, []);
  useLayoutEffect(() => {
    const previous = forms.get(id.current);
    forms.set(id.current, { ...form, scope });
    if (previous?.count !== form.count || previous?.busy !== form.busy) emit();
  });
}

export function hasPendingForms() {
  return [...forms.values()].some(form => form.count > 0 || form.busy);
}

export function confirmPendingNavigation(keepProfile = false, scope?: string | null) {
  const affected = [...forms.values()].filter(form =>
    (scope === undefined || form.scope === scope) && (!keepProfile || !form.profile));
  return confirmDiscard(affected);
}

export function confirmPendingTabNavigation() {
  // Entity pages stay mounted when the user returns to the list or opens another tab.
  return confirmDiscard([...forms.values()].filter(form => form.scope === null && !form.profile));
}

function confirmDiscard(affected: PendingForm[]) {
  if (saving || [...forms.values()].some(form => form.busy)) return false;
  return !affected.some(form => form.count > 0) || window.confirm("Descartar as alterações não salvas e continuar?");
}

export function usePendingEdits() {
  useSyncExternalStore(subscribe, () => revision);
  return {
    count: [...forms.values()].reduce((total, form) => total + form.count, 0),
    busy: saving || [...forms.values()].some(form => form.busy),
    feedback,
  };
}

export async function savePendingEdits() {
  const pending = [...forms.values()].filter(form => form.count > 0);
  if (!pending.length || saving || [...forms.values()].some(form => form.busy)) return;
  feedback = "";
  saving = true;
  emit();
  let completed = 0;
  try {
    const fields = new Set<string>();
    for (const form of pending) {
      form.validate();
      for (const field of form.fields ?? []) {
        if (fields.has(field)) throw Error("O mesmo campo foi alterado em duas abas. Descarte uma das versões antes de salvar.");
        fields.add(field);
      }
    }
    for (const form of pending) {
      if (!await form.save()) {
        feedback = "O salvamento foi interrompido. Confira os detalhes no painel. Alterações já aplicadas ficam no Histórico.";
        return;
      }
      completed++;
    }
    feedback = "Alterações salvas.";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    feedback = completed ? `Salvamento parcial. ${message} Confira o Histórico.` : message;
  } finally {
    saving = false;
    emit();
  }
}
