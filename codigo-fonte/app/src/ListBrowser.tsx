import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { call } from "./api";
import { describeError, formatNumber } from "./format";
import { isRecord, restored, useSnapshot } from "./restore";
import { EntityTabsContext } from "./entityTabs";
import { PendingScope, confirmPendingNavigation } from "./pendingEdits";

/** Rows shown at once; the best come first. */
const ROW_LIMIT = 200;

/** The search text and the UID of the selected row that a list saved; what is missing or wrong is the list's start. */
function readList(value: unknown): { query: string; selected: number | null } {
  const given = isRecord(value) ? value : {};
  return {
    query: typeof given.query === "string" ? given.query : "",
    selected: typeof given.selected === "number" && Number.isInteger(given.selected) ? given.selected : null,
  };
}

interface Page<Row> {
  total: number;
  rows: Row[];
}

/** What a list tells the actions in its toolbar about itself. */
export interface ListState {
  /** The text in the search box. */
  query: string;
  /**
   * How many rows the search and the filters select: the total of the rows on show. Null until the list has them,
   * and while it is asking again after the search or the filters changed.
   */
  total: number | null;
  /** How many of them the list has rows for: the best ones (see `summary`). */
  shown: number;
}

/**
 * What something outside a list asks of it (the command palette, see `App`): to show the profile of `row`, which
 * need not be among the rows on show, or to search for `query`. Each request is an object of its own, so the same
 * one can be asked twice.
 */
export interface ListRequest<Row> {
  row?: Row;
  query?: string;
}

interface ListBrowserProps<Row extends { uid: number }> {
  /**
   * What the list is called in the snapshot of the window that is kept when the language is switched (see
   * `restore.ts`), which gives it back its search text and its selected row: no other list has the same name.
   */
  name: string;
  /**
   * The Rust command that searches, e.g. "search_players". It takes `{ query, limit, ...requestArgs }` and
   * returns a page.
   */
  command: string;
  /**
   * Arguments for the command besides `query` and `limit`, e.g. `{ filter, order }`. They are compared by
   * value, so the list is asked again when they change however often the object is built anew.
   */
  requestArgs?: Record<string, unknown>;
  /** What the command palette asks of the list; null when it asks nothing. */
  request?: ListRequest<Row> | null;
  /** Changes when the game data is read again, so the list and the open profile are too. */
  version: number;
  /**
   * Every list stays mounted while another one is shown, so it keeps its query, rows and selection.
   * Only the active one is visible, takes focus when it becomes active, and shows its profile.
   */
  active: boolean;
  placeholder: string;
  /** The line beside the search box. */
  summary: (total: number, shown: number) => string;
  /** The message under an empty table. */
  empty: (query: string) => string;
  /** Over the toolbar: the switch between this list and another one the same tab shows (see `TeamsSwitch`). */
  scope?: ReactNode;
  /** The filters of the list, between the search box and the table. */
  filterBar?: ReactNode | ((query: string, onQuery: (value: string) => void) => ReactNode);
  /** Buttons at the end of the toolbar, e.g. Mass edit; they get the search text and the total. */
  toolbarActions?: (list: ListState) => ReactNode;
  /** Under the table, e.g. the tray of the players picked for a comparison; it takes no room while it is empty. */
  footer?: ReactNode;
  /** An extra class of the table, for column rules of that list. */
  tableClass?: string;
  /** The header cells. */
  header: ReactNode;
  /** The cells of one row. */
  cells: (row: Row) => ReactNode;
  /** Full-width pages keep their list and the other profiles mounted. */
  fullPage?: boolean;
  paginated?: boolean;
  rowLabel?: (row: Row) => string;
  /** The profile panel of the selected row. */
  profile: (row: Row, panel: { version: number; onClose: () => void; onBack: () => void }) => ReactNode;
}

/** A searchable table with the profile of the selected row beside it. */
export function ListBrowser<Row extends { uid: number }>(props: ListBrowserProps<Row>) {
  const { command, requestArgs, version, active, placeholder, summary, empty, filterBar, toolbarActions } = props;
  const { name, request, scope, footer, tableClass, header, cells, profile, fullPage, paginated, rowLabel } = props;
  const tabs = useContext(EntityTabsContext);
  const register = tabs?.open;
  const remove = tabs?.remove;
  const returnToList = tabs?.returnToList;
  // What the list held before the language was switched, if it was: the search text, and the UID of the row to select
  // as soon as the rows are there again.
  const [start] = useState(() => restored(name, readList));
  const [query, setQuery] = useState(start.query);
  const wanted = useRef(start.selected);
  const [page, setPage] = useState<Page<Row> | null>(null);
  // The search text and arguments the rows on show were asked for: their total is the list's only while those are
  // the ones in the search box and the filters now.
  const [shownFor, setShownFor] = useState<{ query: string; argsKey: string; offset: number } | null>(null);
  const [pageRequest, setPageRequest] = useState({ query: start.query, argsKey: "", offset: 0 });
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);
  useSnapshot(name, () => ({ query, selected: selected?.uid ?? null }));
  const searchInput = useRef<HTMLInputElement>(null);
  const tableWrap = useRef<HTMLDivElement>(null);
  const selectedRow = useRef<HTMLTableRowElement>(null);

  // The arguments as JSON, which is how they reach the command: the effect below depends on their value.
  const argsKey = JSON.stringify(requestArgs ?? {});
  // The arguments of the rows on show, so a new sort or filter can start at the top.
  const offset = paginated && pageRequest.query === query && pageRequest.argsKey === argsKey ? pageRequest.offset : 0;

  const [opened, setOpened] = useState<Row[]>([]);
  const close = useCallback((uid: number) => {
    setOpened(rows => rows.filter(row => row.uid !== uid));
    setSelected(row => row?.uid === uid ? null : row);
    remove?.(`${name}:${uid}`);
  }, [name, remove]);
  const pick = useCallback((row: Row) => {
    const id = `${name}:${row.uid}`;
    setOpened(rows => rows.some(entry => entry.uid === row.uid) ? rows : [...rows, row]);
    setSelected(row);
    const fallback = "name" in row && typeof row.name === "string" ? row.name : `#${row.uid}`;
    register?.({
      id, list: name, label: rowLabel?.(row) ?? fallback,
      activate: () => setSelected(row),
      close: () => {
        if (confirmPendingNavigation(false, id)) close(row.uid);
      },
    });
  }, [name, register, close, rowLabel]);

  useEffect(() => {
    let cancelled = false;
    const args: Record<string, unknown> = JSON.parse(argsKey);
    // Typing in the search box or a filter waits a little, so a burst of keys makes one request.
    // A list nobody has touched yet loads at once.
    const untouched = query === "" && argsKey === "{}";
    const timer = setTimeout(
      async () => {
        try {
          const result = await call<Page<Row>>(command, { ...args, query, limit: ROW_LIMIT, ...(paginated ? { offset } : {}) });
          if (!cancelled) {
            if (offset > 0 && result.rows.length === 0) {
              const last = Math.floor(Math.max(0, result.total - 1) / ROW_LIMIT) * ROW_LIMIT;
              setPageRequest({ query, argsKey, offset: last });
              return;
            }
            setPage(result);
            setShownFor({ query, argsKey, offset });
            setError(null);
            // The first rows decide: the row that was selected before the language was switched is selected again if
            // they have it, and not later, when the user has moved on.
            const uid = wanted.current;
            if (uid !== null) {
              wanted.current = null;
              const row = result.rows.find((candidate) => candidate.uid === uid);
              if (row !== undefined) {
                pick(row);
              }
            }
          }
        } catch (e) {
          if (!cancelled) {
            setError(describeError(e));
          }
        }
      },
      untouched ? 0 : 150,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [command, query, argsKey, offset, paginated, version, pick]);

  useEffect(() => {
    tableWrap.current?.scrollTo({ top: 0 });
  }, [query, argsKey, offset]);


  // The command palette picked someone, or asked for a search: the profile opens whatever the rows on show are, as
  // the palette searches everyone and the list may be filtered. Whoever asks has let the open profile's edits go.
  useEffect(() => {
    if (!request) {
      return;
    }
    if (request.query !== undefined) {
      setPageRequest({ query: "", argsKey: "", offset: 0 });
      setQuery(request.query);
      searchInput.current?.focus();
    }
    if (request.row !== undefined) {
      wanted.current = null;
      pick(request.row);
    }
  }, [request, pick]);

  const settled = page !== null && shownFor !== null && shownFor.query === query && shownFor.argsKey === argsKey && shownFor.offset === offset;

  // A hidden list has no profile open: its window-wide Escape handler must not fire.
  const showProfile = active && selected !== null && (!tabs || tabs.active === `${name}:${selected.uid}`);
  const className = ["workspace", fullPage && "entity-workspace", showProfile && "with-profile", !active && "inactive"]
    .filter(Boolean).join(" ");
  const listHidden = Boolean(fullPage && showProfile);

  useEffect(() => {
    if (active && !listHidden) searchInput.current?.focus();
  }, [active, listHidden]);

  return (
    <div className={className}>
      <section className="players" hidden={listHidden}>
        {scope}
        <div className="toolbar">
          <label className="search">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="8.5" cy="8.5" r="5.5" />
              <path d="m13 13 4.5 4.5" />
            </svg>
            <input
              ref={searchInput}
              value={query}
              onChange={(e) => {
                if (offset) setPageRequest({ query: "", argsKey: "", offset: 0 });
                setQuery(e.currentTarget.value);
              }}
              placeholder={placeholder}
              spellCheck={false}
            />
          </label>
          <span className="count">{page ? (paginated ? formatNumber(page.total) + " registros" : summary(page.total, page.rows.length)) : ""}</span>
          {toolbarActions?.({ query, total: settled ? page.total : null, shown: page?.rows.length ?? 0 })}
        </div>
        {typeof filterBar === "function" ? filterBar(query, setQuery) : filterBar}
        {error && <div className="banner">{error}</div>}

        <div className="table-wrap" ref={tableWrap}>
          <table className={tableClass ? `grid ${tableClass}` : "grid"}>
            <thead>
              <tr>{header}</tr>
            </thead>
            <tbody>
              {page?.rows.map((row) => {
                const isSelected = row.uid === selected?.uid;
                return (
                  <tr
                    key={row.uid}
                    ref={isSelected ? selectedRow : undefined}
                    className={isSelected ? "selected" : undefined}
                    aria-current={isSelected ? "true" : undefined}
                    tabIndex={0}
                    onClick={() => pick(row)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        pick(row);
                      }
                    }}
                  >
                    {cells(row)}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {page && page.rows.length === 0 && <p className="empty">{empty(query)}</p>}
        </div>
        {paginated && page && page.total > ROW_LIMIT && (
          <nav className="list-pagination" aria-label="Páginas de resultados">
            <button type="button" disabled={!settled || offset === 0}
              onClick={() => setPageRequest({ query, argsKey, offset: offset - ROW_LIMIT })}>Anterior</button>
            <span aria-live="polite">{formatNumber((shownFor?.offset ?? 0) + 1)}–{formatNumber((shownFor?.offset ?? 0) + page.rows.length)} de {formatNumber(page.total)}</span>
            <button type="button" disabled={!settled || offset + ROW_LIMIT >= page.total}
              onClick={() => setPageRequest({ query, argsKey, offset: offset + ROW_LIMIT })}>Próxima</button>
          </nav>
        )}
        {footer}
      </section>

      {opened.map(row => {
        const id = `${name}:${row.uid}`;
        return <PendingScope.Provider value={id} key={row.uid}>
          <div className="entity-panel" hidden={!showProfile || row.uid !== selected?.uid}>
            {profile(row, {
              version,
              onClose: () => close(row.uid),
              onBack: () => {
                if (returnToList) returnToList(id);
                else setSelected(null);
              },
            })}
          </div>
        </PendingScope.Provider>;
      })}
    </div>
  );
}
