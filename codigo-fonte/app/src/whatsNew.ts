import { useCallback, useMemo, useState } from "react";
import { inTauri } from "./api";
import { intlLocale, strings } from "./i18n";
import { en } from "./i18n/en";
import { isNewer } from "./update";

/** The people each version thanks, by their names on GitHub. */
const THANKS: Record<string, string[]> = {
  "0.5.3": ["pdalu", "Blak-Ish", "RootTourist", "Reckbeg", "TTTSHOK"],
  "0.5.2": ["pdalu", "Ragebulls", "pirocky", "keyboard1011-dev"],
};

/** A version's notes, in the language in use or else in English, and the people it thanks. */
export interface VersionNotes {
  version: string;
  things: { title: string; text: string }[];
  /** The names, joined as the language joins a list ("a, b and c"); null when it thanks nobody. */
  thanks: string | null;
}

const isVersion = (value: unknown): value is string => typeof value === "string" && /^\d+(\.\d+)*$/.test(value);

/** The versions that have notes, newest first. */
const VERSIONS = Object.keys(en.whatsNew.versions)
  .filter(isVersion)
  .sort((a, b) => (isNewer(a, b) ? -1 : isNewer(b, a) ? 1 : 0));

/** The list formatter of the web view, which an older macOS lacks (the app's TypeScript library predates it too). */
type ListFormat = new (locale: string, options: { type: "conjunction" }) => { format(list: string[]): string };
const ListFormat = (Intl as { ListFormat?: ListFormat }).ListFormat;

/** `names` joined as the language joins a list ("a, b and c"), or with commas where the web view cannot. */
const joinNames = (names: string[]): string =>
  ListFormat ? new ListFormat(intlLocale, { type: "conjunction" }).format(names) : names.join(", ");

/** A version's notes as the dialog shows them. */
function notesOf(version: string): VersionNotes {
  const names = THANKS[version] ?? [];
  return {
    version,
    things: strings.whatsNew.versions[version] ?? en.whatsNew.versions[version] ?? [],
    thanks: names.length > 0 ? joinNames(names) : null,
  };
}

/** The changelog is opened from the footer or the command palette. */
export function useWhatsNew(current: string | null) {
  const [shown, setShown] = useState<VersionNotes[] | null>(null);
  const known = useMemo(
    () => current === null ? [] : VERSIONS.filter(version => !inTauri || !isNewer(version, current)),
    [current],
  );
  const show = useCallback(() => {
    if (known.length) setShown([notesOf(known[0])]);
  }, [known]);
  const close = useCallback(() => setShown(null), []);

  return { shown, available: known.length > 0, show, close };
}
