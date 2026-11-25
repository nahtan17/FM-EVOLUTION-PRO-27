import { EntityTabsContext, type EntityTab } from "./entityTabs";
import { CityDirectory } from "./CityDirectory";
import { StadiumDirectory } from "./StadiumDirectory";
import { confirmPendingNavigation, confirmPendingTabNavigation, hasPendingForms, savePendingEdits, usePendingEdits } from "./pendingEdits";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { call, inTauri } from "./api";
import { BridgeSetup } from "./BridgeSetup";
import { ChangesView, useChangeFilter, useChangeLog } from "./ChangesView";
import { ClubBrowser } from "./ClubBrowser";
import { NationalBrowser } from "./NationalBrowser";
import { MonitoringDialog } from "./MonitoringDialog";
import { CommandPalette, Keys, SearchIcon, type Command, type Found, type FoundKind } from "./CommandPalette";
import { CompatibilityNotice } from "./CompatibilityNotice";
import { CopyDiagnostics } from "./CopyDiagnostics";
import { forgetFieldTables } from "./fieldTables";
import { describeError, describeGame, formatDate } from "./format";
import { FrozenNotice } from "./FrozenNotice";
import { GraphicsStatus } from "./GraphicsStatus";
import { SettingsMenu } from "./SettingsMenu";
import {
  appText,
  changesText,
  clubListText,
  nationalText,
  homeText,
  paletteText,
  playerListText,
  scoutingText,
  staffListText,
  updateText,
  whatsNewText,
} from "./labels";
import type { ListRequest } from "./ListBrowser";
import { PlayerBrowser } from "./PlayerBrowser";
import { restored, useSnapshot } from "./restore";
import { SaveChangedNotice, useSaveChanged } from "./SaveChangedNotice";
import { ScoutingBrowser } from "./ScoutingBrowser";
import { MyClub } from "./MyClub";
import { TrainerPanel } from "./TrainerPanel";
import { matches, SHORTCUTS, viewShortcut, withShortcut } from "./shortcuts";
import { StaffBrowser } from "./StaffBrowser";
import type {
  BridgeInfo,
  ClubSummary,
  ConnectionInfo,
  Detection,
  PlayerSummary,
  Refrozen,
  ReloadInfo,
  StaffSummary,
} from "./types";
import { useUpdateCheck } from "./update";
import { UpdateCheck, UpdateNotice } from "./UpdateNotice";
import { ComparisonContext, useComparison } from "./useComparison";
import { modalOpen } from "./useModal";
import { askToLeave, EditorContext } from "./useProfileEditing";
import { useWhatsNew } from "./whatsNew";
import { WhatsNewDialog } from "./WhatsNewDialog";
import "./App.css";
import "./PersonalEdition.css";
import "./WorkspaceEdition.css";
import "./ProfileAppearance.css";
import evolutionLogo from "./assets/evolution-logo.png";

type View = "home" | "players" | "staff" | "clubs" | "trainer" | "scouting" | "changes" | "nationals" | "stadiums" | "cities";

// The national teams are listed in the Clubs tab, behind its switch (see `TeamsSwitch`), not in a tab of their own.
const VIEWS: { id: View; label: string }[] = [
  { id: "home", label: homeText.nav },
  { id: "players", label: playerListText.nav },
  { id: "staff", label: staffListText.nav },
  { id: "clubs", label: clubListText.nav },
  { id: "nationals", label: "Países" },
  { id: "stadiums", label: "Estádios" },
  { id: "cities", label: "Cidades" },
  { id: "trainer", label: "Treino" },
  { id: "scouting", label: scoutingText.nav },
  { id: "changes", label: changesText.nav },
];

/** The list each kind of thing the command palette finds is in. */
const VIEW_OF: Record<FoundKind, View> = { player: "players", staff: "staff", club: "clubs" };

/** What the command palette asks of one of the lists: someone's profile, or a search (see `ListRequest`). */
type Request =
  | { kind: "player"; ask: ListRequest<PlayerSummary> }
  | { kind: "staff"; ask: ListRequest<StaffSummary> }
  | { kind: "club"; ask: ListRequest<ClubSummary> };

/** The request that opens the profile of what the palette found. */
function profileRequest(found: Found): Request {
  switch (found.kind) {
    case "player":
      return { kind: "player", ask: { row: found.row } };
    case "staff":
      return { kind: "staff", ask: { row: found.row } };
    case "club":
      return { kind: "club", ask: { row: found.row } };
  }
}

/** Puts the caret in the search box of the list on show, with its text selected. */
function focusListSearch(): void {
  const workspace = document.querySelector(".views > .workspace:not(.inactive)");
  const back = workspace?.querySelector<HTMLButtonElement>(".entity-panel:not([hidden]) .profile-back");
  back?.click();
  requestAnimationFrame(() => {
    const box = workspace?.querySelector<HTMLInputElement>(".toolbar .search input");
    box?.focus();
    box?.select();
  });
}

/** The view the window was in before the language was switched; the first one when there was no such switch. */
const readView = (value: unknown): View => VIEWS.find(({ id }) => id === value)?.id ?? "home";

function BrandMark() {
  return <img className="brand" src={evolutionLogo} alt="" width={44} height={44} />;
}

function NavIcon({ view }: { view: View }) {
  const paths: Record<View, string> = {
    home: "m3 10 9-7 9 7v10H3z M9 20v-7h6v7",
    players: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87",
    staff: "M3 7h18v14H3z M8 7V3h8v4 M3 12h18 M10 12v3h4v-3",
    clubs: "M4 4h16v6c0 6-8 11-8 11S4 16 4 10z M8 9h8 M8 13h8",
    nationals: "M3 21V3h15l-3 5 3 5H3",
    stadiums: "M3 5h18v14H3z M12 5v14 M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0",
    cities: "M3 21V9h7v12m0 0V3h11v18M6 12h1m7-5h1m3 0h1m-5 4h1m3 0h1",
    trainer: "M8 3h8v4H8z M8 5H4v16h16V5h-4 M8 12h8 M8 16h5",
    scouting: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16 M17 17l5 5 M8 11h6 M11 8v6",
    changes: "M3 12a9 9 0 1 0 3-6.7 M3 3v5h5 M12 7v5l3 2",
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[view]} /></svg>;
}

function App() {
  const [detection, setDetection] = useState<Detection | null>(null);
  const [connection, setConnection] = useState<ConnectionInfo | null>(null);
  // False until the app has asked whether it is connected already (see the effect below): the connect panel would
  // flash up for a moment after the window was reloaded to change the language.
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  // What connecting froze again of what was frozen in the save before, until the notice that says so is dismissed.
  const [refrozen, setRefrozen] = useState<Refrozen | null>(null);
  const [view, setView] = useState<View>(() => restored("view", readView));
  useSnapshot("view", () => view);
  // Which teams the Clubs tab lists: the clubs, or the nations' national teams.

  // Whether the view on show is one that was asked for: a tab, a shortcut, the palette, or the view the window was in
  // before the language was switched. Until then the app is where it opened, on My club, and goes to the players
  // instead when the save has no club for that page (see `MyClub`).
  const viewChosen = useRef(restored("view", (value) => value !== undefined));
  // The players picked for a comparison: in the player list's profiles and in those opened from a club's squad.
  const comparison = useComparison();
  const { log, error: logError, reload: reloadLog } = useChangeLog();
  // The search and the filters of the Changes view stay when another view is shown, as a list's search does.
  const [changeFilter, setChangeFilter] = useChangeFilter();
  // The Changes tab counts what this connection wrote: the earlier changes of the history are not news.
  const sessionChanges = log.filter((change) => !change.earlier).length;
  const update = useUpdateCheck();
  // What this version brings: told once after an update, and again from the foot of the window or the palette.
  const whatsNew = useWhatsNew(update.current);
  // Whether Check for updates was pressed: only then does the foot of the window say what was found.
  const [askedUpdate, setAskedUpdate] = useState(false);
  // Whether the game has loaded a save, or gone back to its main menu, since the data was read.
  const pending = usePendingEdits();
  useEffect(() => {
    if (inTauri) {
      const listener = getCurrentWindow().onCloseRequested(event => {
        if (!confirmPendingNavigation()) event.preventDefault();
      });
      void listener.catch(error => console.error("Não foi possível monitorar o fechamento da janela.", error));
      return () => { void listener.then(unlisten => unlisten(), () => {}); };
    }
    const warn = (event: BeforeUnloadEvent) => {
      if (hasPendingForms()) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const saveChanged = useSaveChanged(connection !== null, dataVersion);
  // The command palette: whether it is up, what had focus before it, and what it last asked of a list.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [monitor, setMonitor] = useState<"alerts" | "integrity">();
  const focusBefore = useRef<Element | null>(null);
  const [request, setRequest] = useState<Request | null>(null);
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
  const [entityTabs, setEntityTabs] = useState<EntityTab[]>([]);
  const [activeEntity, setActiveEntity] = useState<string | null>(null);
  const openEntity = useCallback((tab: EntityTab) => {
    setEntityTabs(tabs => tabs.some(item => item.id === tab.id) ? tabs : [...tabs, tab]);
    setActiveEntity(tab.id);
  }, []);
  const removeEntity = useCallback((id: string) => {
    setEntityTabs(tabs => tabs.filter(tab => tab.id !== id));
    setActiveEntity(active => active === id ? null : active);
  }, []);
  const returnToList = useCallback((id: string) => {
    setActiveEntity(active => active === id ? null : active);
  }, []);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("fm-evolution.theme") === "light" ? "light" : "dark"; }
    catch { return "dark"; }
  });
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("fm-evolution.theme", theme); } catch { /* The theme still applies. */ }
  }, [theme]);


  const run = useCallback(async (label: string, task: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const detect = useCallback(
    () => run(appText.detecting, async () => setDetection(await call<Detection>("detect_game"))),
    [run],
  );

  const connect = () =>
    run(appText.connecting, async () => {
      const { refrozen: again, ...connected } = await call<ConnectionInfo>("connect");
      // A new connection lists the history of the career the game has loaded, and its field tables may differ. Its
      // lists start afresh, with no one picked for a comparison.
      forgetFieldTables();
      comparison.clear();
      resetWorkspace();
      setConnection(connected);
      void reloadLog();
      setRefrozen(again ?? null);
      setDataVersion((v) => v + 1);
    });

  const resetWorkspace = () => {
    setEntityTabs([]);
    setActiveEntity(null);
    setRequest(null);
    setWorkspaceEpoch(epoch => epoch + 1);
  };
  const reload = () => askToLeave(() => {
    resetWorkspace();
    void reloadData();
  });
  const reloadData = () =>
    run(appText.reloading, async () => {
      try {
        const { refrozen: again, ...reloaded } = await call<ReloadInfo>("reload");
        setConnection((c) => c && { ...c, ...reloaded });
        // Reading the game again may have found another career, whose history replaces the list.
        void reloadLog();
        if (again) {
          setRefrozen(again);
        }
        setDataVersion((v) => v + 1);
      } catch (e) {
        // The Rust side drops the connection when reading fails (e.g. the game was closed).
        setConnection(null);
        void detect();
        throw e;
      }
    });

  // At startup: the Rust side keeps its connection, lists and change log when the window is reloaded (that is how a
  // change of language keeps the connection), so the app first asks for the connection it may have already. With
  // one, it shows the connected app right away, without reading the game again; without one, it looks for the game.
  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      let current: ConnectionInfo | null = null;
      try {
        current = await call<ConnectionInfo | null>("current_connection");
      } catch {
        // Not knowing is no reason to stop: looking for the game says what is wrong, if anything is.
      }
      if (cancelled) {
        return;
      }
      if (current) {
        setConnection(current);
        setDataVersion((v) => v + 1);
        void reloadLog();
      } else {
        void detect();
      }
      setChecked(true);
    };
    void start();
    return () => {
      cancelled = true;
    };
  }, [detect, reloadLog]);

  // Changes were written or undone: the lists and the open profile read the game again, and so does the log.
  // The lists keep their search, filters, sort and selection when they do.
  const edited = useCallback(() => {
    setDataVersion((v) => v + 1);
    void reloadLog();
  }, [reloadLog]);

  // A version of the game the editor has no profile for is read-only until editing it is allowed.
  const allowEditing = async () => {
    setError(null);
    try {
      setConnection(await call<ConnectionInfo>("allow_editing"));
    } catch (e) {
      setError(describeError(e));
    }
  };

  const checkUpdates = () => {
    setAskedUpdate(true);
    update.check();
  };

  const editable = connection?.editable ?? false;
  // The note on applying edits, the colophon's first: whole in its hover too, should a window ever be too narrow for it.
  // While nothing can be edited, it is also the hover of what that turns off.
  const note = !connection
    ? appText.noteNotConnected
    : editable
      ? appText.noteEditable
      : connection.writable
        ? appText.noteUnknownBuild
        : appText.noteReadOnly;
  const arrangesTransfers = connection?.arrangesTransfers ?? false;
  const gameDate = connection?.gameDate;
  const openPlayer = useCallback((row: PlayerSummary) => {
    if (!confirmPendingTabNavigation()) return;
    viewChosen.current = true;
    setView("players");
    setRequest({ kind: "player", ask: { row } });
  }, []);
  const editor = useMemo(
    () => ({ editable, readOnlyNote: note, arrangesTransfers, gameDate, onEdited: edited, openPlayer }),
    [editable, note, arrangesTransfers, gameDate, edited, openPlayer],
  );

  const show = (id: View) => {
    if (!confirmPendingTabNavigation()) return;
    viewChosen.current = true;
    setActiveEntity(null);
    setView(id);
  };

  const openClub = (row: ClubSummary) => {
    if (!confirmPendingTabNavigation()) return;
    viewChosen.current = true;
    setView("clubs");
    setRequest({ kind: "club", ask: { row } });
  };

  // Under a dialog the palette stays shut: the dialog has the keys.
  const openPalette = () => {
    if (!paletteOpen && !modalOpen()) {
      focusBefore.current = document.activeElement;
      setPaletteOpen(true);
    }
  };

  // Closes the palette at once, gives focus back to what had it, and only then runs `then`: what that does (another
  // view, a search box) may take focus from there.
  const closePalette = (then?: () => void) => {
    flushSync(() => setPaletteOpen(false));
    const before = focusBefore.current;
    focusBefore.current = null;
    if (before instanceof HTMLElement && before.isConnected) {
      before.focus();
    }
    then?.();
  };

  // The palette found someone: the list they are in shows their profile. Edits pending in the open profile ask first.
  const openFound = (found: Found) =>
    closePalette(() => {
      if (confirmPendingTabNavigation()) {
        viewChosen.current = true;
        setView(VIEW_OF[found.kind]);
        setRequest(profileRequest(found));
      }
    });

  // The palette's line that shows all of a list's matches: the list searches for what was typed in the palette.
  const showAll = (kind: FoundKind, query: string) =>
    closePalette(() =>
      askToLeave(() => {
        viewChosen.current = true;
        setView(VIEW_OF[kind]);
        setActiveEntity(null);
        setRequest({ kind, ask: { query } });
      }),
    );

  const game = detection?.games[0];
  const idle = busy === null;
  const searchable =
    connection !== null && (view === "players" || view === "staff" || view === "clubs" || view === "stadiums" || view === "changes");

  // What the palette lists, read when it opens: the commands of the profile on show, then the lists, then the rest.
  const commands: Command[] = [];
  if (paletteOpen) {
    commands.push({ id: "alerts", label: "Central de alertas", run: () => setMonitor("alerts") });
    commands.push({ id: "integrity", label: "Verificador de integridade", run: () => setMonitor("integrity") });
    if (pending.count && !pending.busy) {
      commands.push({ id: "apply", label: "Salvar alterações", shortcut: SHORTCUTS.apply, run: () => void savePendingEdits() });
    }
    VIEWS.forEach(({ id, label }, index) =>
      commands.push({
        id: `view-${id}`,
        label: paletteText.goTo(label),
        shortcut: index < 9 ? viewShortcut(index) : undefined,
        run: () => show(id),
      }),
    );
    // The national teams have no tab of their own: the Clubs tab lists them behind its switch.
    commands.push({
      id: "view-nationals",
      label: paletteText.goTo(nationalText.nav),
      run: () => show("nationals"),
    });
    if (searchable) {
      commands.push({ id: "find", label: paletteText.searchList, shortcut: SHORTCUTS.find, run: focusListSearch });
    }
    if (idle && connection) {
      commands.push({ id: "reload", label: appText.reload, shortcut: SHORTCUTS.reload, run: () => void reload() });
    } else if (idle) {
      if (game?.info && game.pluginLoaded) {
        commands.push({ id: "connect", label: appText.connect.button, run: () => void connect() });
      }
      commands.push({ id: "refresh", label: appText.refresh, shortcut: SHORTCUTS.reload, run: () => void detect() });
    }
    if (update.current) {
      commands.push({ id: "updates", label: updateText.check, run: checkUpdates });
    }
    if (whatsNew.available) {
      commands.push({ id: "whats-new", label: whatsNewText.command, run: whatsNew.show });
    }
  }

  // The keyboard shortcuts. A dialog that is up has the keys to itself, but for a profile opened as one: Edit and
  // Apply are its own. A shortcut that does something here keeps the key from the web view, which would search the
  // page, load it again or save it.
  const onShortcut = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) {
      return;
    }
    if (matches(event, SHORTCUTS.palette)) {
      event.preventDefault();
      if (paletteOpen) {
        closePalette();
      } else {
        openPalette();
      }
      return;
    }
    if (matches(event, SHORTCUTS.apply) || matches(event, SHORTCUTS.reload)) {
      // Never the web view's own, whatever is up: saving the page, or loading it again.
      event.preventDefault();
    }
    if (paletteOpen) {
      return;
    }
    if (modalOpen()) {
      return;
    }
    if (matches(event, SHORTCUTS.apply)) {
      if (idle) void savePendingEdits();
      return;
    }
    const tab = VIEWS.findIndex((_, index) => matches(event, viewShortcut(index)));
    if (tab >= 0) {
      event.preventDefault();
      show(VIEWS[tab].id);
    } else if (matches(event, SHORTCUTS.reload)) {
      if (idle) {
        void (connection ? reload() : detect());
      }
    } else if (matches(event, SHORTCUTS.find) && searchable) {
      event.preventDefault();
      focusListSearch();
    }
  };
  // The listener is put up once, and calls the handler of the last render.
  const latestShortcut = useRef(onShortcut);
  useLayoutEffect(() => {
    latestShortcut.current = onShortcut;
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => latestShortcut.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <div className="app">
      <header className="masthead">
        <BrandMark />
        <div className="edition-heading"><strong>FM Evolution PRO <em>27</em></strong><span>Editor para Football Manager</span></div>
        <div className="masthead-side">
          <button type="button" aria-label="Ir à página inicial" title="Página inicial" onClick={() => show("home")}><NavIcon view="home" /></button>
          <button type="button" aria-label="Abrir histórico e desfazer" title="Histórico e desfazer" onClick={() => show("changes")}><NavIcon view="changes" /></button>
          <button type="button" aria-haspopup="dialog" onClick={() => setMonitor("alerts")}>Alertas</button>
          {busy && <span className="busy">{busy}</span>}
          <button type="button" className="palette-open" aria-haspopup="dialog"
            title={withShortcut(paletteText.title, SHORTCUTS.palette)} onClick={openPalette}>
            <SearchIcon /><span className="palette-open-label">{paletteText.button}</span><Keys shortcut={SHORTCUTS.palette} />
          </button>
          <span className="save-feedback" role="status" title={pending.feedback}>
            {pending.busy ? "Salvando…" : pending.count ? `${pending.count} pendente(s)` : pending.feedback}
          </span>
          {pending.count > 0 && pending.feedback && <span className="save-error" role="alert">{pending.feedback}</span>}
          <button type="button" className="primary" onClick={() => void savePendingEdits()}
            disabled={!idle || pending.busy || !pending.count} title="Ctrl + S">Salvar alterações</button>
          {!inTauri && <span className="tag demo-indicator">Demonstração</span>}
          {inTauri && <span className="connection-state" role="status">{connection ? "FM27 conectado" : "FM27 desconectado"}</span>}
          {connection && connection.gameDate && <span className="game-date">{formatDate(connection.gameDate)}</span>}
          <button className="primary" onClick={connection ? reload : detect} disabled={!idle}
            title={withShortcut(connection ? appText.reload : appText.refresh, SHORTCUTS.reload)}>
            {connection ? appText.reload : appText.refresh}
          </button>
          <button type="button" className="theme-toggle" aria-label={theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "☀" : "☾"}</button>
          <SettingsMenu busy={busy !== null} />
        </div>
      </header>

      <aside className="edition-sidebar">
        <div className="edition-sidebar-label">FOOTBALL MANAGER 27</div>
        <nav className="tabs" aria-label="Navegação principal">
          {VIEWS.map(({ id, label }, index) => (
            <button
              key={id}
              type="button"
              className={id === view ? "tab active" : "tab"}
              aria-current={id === view ? "page" : undefined}
              title={index < 9 ? withShortcut(label, viewShortcut(index)) : label}
              onClick={() => show(id)}
            >
              <NavIcon view={id} />
              {label}
              {id === "changes" && sessionChanges > 0 && <small>{sessionChanges}</small>}
            </button>
          ))}
        </nav>
        <div className="edition-shortcuts"><span>Ctrl + K</span> {paletteText.button}<br /><span>Ctrl + S</span> {" "}{"Aplicar alterações"}</div>
        <div className="edition-credit">Base: FMLibreEditor<br />Código aberto · GPL-3.0+</div>
      </aside>

      {connection && entityTabs.length > 0 && <nav className="entity-tabs" aria-label="Entidades abertas">
        {entityTabs.map(tab => <span key={tab.id} className="entity-tab" data-active={tab.id === activeEntity}>
          <button type="button" aria-pressed={tab.id === activeEntity} onClick={() => {
            if (!confirmPendingTabNavigation()) return;
            setView(tab.list as View);
            setActiveEntity(tab.id);
            tab.activate();
          }}>{tab.label}</button>
          <button type="button" aria-label={`Fechar ${tab.label}`} onClick={tab.close}>×</button>
        </span>)}
      </nav>}
      <div className="main">
        {update.notice && (
          <UpdateNotice
            release={update.notice}
            current={update.current}
            selfUpdate={update.selfUpdate}
            onLater={update.later}
          />
        )}
        {connection && (
          <CompatibilityNotice
            connection={connection}
            busy={busy !== null}
            onAllow={allowEditing}
            onCheckUpdates={checkUpdates}
          />
        )}
        {connection && saveChanged && <SaveChangedNotice busy={busy !== null} onReload={reload} />}
        {connection && refrozen && <FrozenNotice refrozen={refrozen} onDismiss={() => setRefrozen(null)} />}
        {error && <div className="banner">{error}</div>}

        {connection ? (
          // All the lists stay mounted, so each keeps its search and selection while another is shown.
          <EntityTabsContext.Provider value={{ active: activeEntity, open: openEntity, remove: removeEntity, returnToList }}>
          <EditorContext.Provider value={editor}>
            <ComparisonContext.Provider value={comparison}>
              <div className="views" key={workspaceEpoch}>
                {view === "home" && (
                  <MyClub
                    version={dataVersion}
                    gameDate={connection.gameDate}
                    onOpenClub={openClub}
                    onEmpty={() => {
                      if (!viewChosen.current) {
                        setView("players");
                      }
                    }}
                  />
                )}
                <PlayerBrowser
                  version={dataVersion}
                  active={view === "players"}
                  genderKnown={connection.genderKnown}
                  comparison={comparison}
                  request={request?.kind === "player" ? request.ask : null}
                />
                <StaffBrowser
                  version={dataVersion}
                  active={view === "staff"}
                  genderKnown={connection.genderKnown}
                  request={request?.kind === "staff" ? request.ask : null}
                />
                <ClubBrowser
                  version={dataVersion}
                  active={view === "clubs"}
                  request={request?.kind === "club" ? request.ask : null}
                />
                <NationalBrowser
                  version={dataVersion}
                  active={view === "nationals"}
                />
                <CityDirectory version={dataVersion} active={view === "cities"} />
                <StadiumDirectory version={dataVersion} active={view === "stadiums"} />
                <TrainerPanel active={view === "trainer"} paused={Boolean(saveChanged)} gameDate={connection.gameDate} />
                <ScoutingBrowser version={dataVersion} active={view === "scouting"} gameDate={connection.gameDate} />
                {view === "changes" && (
                  <ChangesView
                    log={log}
                    error={logError}
                    reload={reloadLog}
                    onUndone={edited}
                    filter={changeFilter}
                    onFilter={setChangeFilter}
                  />
                )}
              </div>
            </ComparisonContext.Provider>
          </EditorContext.Provider>
          </EntityTabsContext.Provider>
        ) : (
          checked && (
            <ConnectPanel
              detection={detection}
              busy={busy !== null}
              onConnect={connect}
              onBridge={(bridge) => setDetection((d) => d && { ...d, bridge })}
            />
          )
        )}
      </div>

      <footer className="colophon">
        <div className="colophon-main">
          <span className="colophon-name">
            FM Evolution PRO 27{update.current && ` ${update.current}`} · {appText.stage}
          </span>
          {update.current && <UpdateCheck state={update.state} asked={askedUpdate} onCheck={checkUpdates} />}
          {whatsNew.available && (
            <button type="button" className="update-link whats-new-link" onClick={whatsNew.show}>
              {whatsNewText.link}
            </button>
          )}
          {connection && <CopyDiagnostics className="update-link" />}
          <span className={`status ${connection ? "on" : ""}`}>
            <span className="dot" />
            <span className="status-text">
              {connection
                ? [
                    describeGame(connection.game),
                    playerListText.count(connection.players),
                    staffListText.count(connection.staff),
                    clubListText.count(connection.clubs),
                  ].join(" · ")
                : appText.notConnected}
            </span>
          </span>
          {!inTauri && <span className="tag">{appText.previewTag}</span>}
        </div>
        <div className="colophon-notes">
          <p className="sidebar-note" title={note}>
            {note}
          </p>
          <GraphicsStatus />
        </div>
      </footer>

      {whatsNew.shown && (
        <WhatsNewDialog notes={whatsNew.shown} updated={false} onClose={whatsNew.close} />
      )}

      {monitor && <MonitoringDialog mode={monitor} connection={connection} saveChanged={Boolean(saveChanged)} onClose={() => setMonitor(undefined)} />}
      {paletteOpen && (
        <CommandPalette
          commands={commands}
          connected={connection !== null}
          onRun={(command) => closePalette(command.run)}
          onOpen={openFound}
          onShowAll={showAll}
          onClose={closePalette}
        />
      )}
    </div>
  );
}

function ConnectPanel(props: {
  detection: Detection | null;
  busy: boolean;
  onConnect: () => void;
  onBridge: (bridge: BridgeInfo) => void;
}) {
  const { detection, busy, onConnect, onBridge } = props;
  const game = detection?.games[0];
  // macOS: the bridge comes first while it is not set up, as nothing connects without it.
  const bridge = detection?.bridge;
  const bridgeSetup = bridge && <BridgeSetup bridge={bridge} busy={busy} onChange={onBridge} />;
  const ready = Boolean(game?.info && game.pluginLoaded);
  const text = appText.connect;

  return (
    <section className="connect">
      <div className="card">
        <img className="connect-logo" src={evolutionLogo} alt="" width={88} height={88} />
        <h2>{text.title}</h2>
        <p className="muted">{text.intro}</p>
        {bridge && !bridge.ready && bridgeSetup}

        {detection && detection.games.length === 0 && <p className="hint">{text.notRunning}</p>}
        {game && !game.info && <p className="hint error">{text.openFailed(describeError(game.error))}</p>}
        {game?.info && (
          <dl className="facts">
            <dt>{text.game}</dt>
            <dd>{describeGame(game.info)}</dd>
            <dt>{text.gameData}</dt>
            <dd>{game.pluginLoaded ? text.loaded : text.stillLoading}</dd>
            <dt>{text.process}</dt>
            <dd>{text.pid(game.info.pid)}</dd>
          </dl>
        )}
        {detection && detection.games.length > 1 && <p className="hint">{text.several}</p>}

        <button className="primary" onClick={onConnect} disabled={busy || !ready}>
          {text.button}
        </button>
        {bridge?.ready && bridgeSetup}
      </div>
    </section>
  );
}

export default App;
