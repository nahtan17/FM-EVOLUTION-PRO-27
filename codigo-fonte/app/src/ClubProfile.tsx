import { FinanceHistory } from "./FinanceHistory";
import { GoldenGeneration } from "./GoldenGeneration";
import { PendingScope, confirmPendingNavigation } from "./pendingEdits";
import { useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { EditableValue } from "./EditControls";
import { freezeMoney, frozenClubs } from "./editing";
import { converts, inCurrency } from "./currency";
import { describeError, formatMoney } from "./format";
import { InfoTip } from "./InfoTip";
import { LeaguePrizesGroup } from "./LeaguePrizes";
import { SponsorEditor } from "./SponsorEditor";
import { ClubExtras } from "./ClubExtras";
import { QuickRecipes } from "./QuickRecipes";
import { ClubSupporters } from "./ClubSupporters";
import {
  appText,
  CLUB_FACILITY_LABELS,
  clubProfileText,
  profileText,
} from "./labels";
import { ClubLogo, PICTURE_SIZE } from "./Picture";
import {
  Fact,
  ProfileFrame,
  RatingGroup,
  ReputationMeter,
  useProfileDetails,
  type PanelIds,
  type RatingRow,
} from "./ProfileParts";
import { ClubStaffTab } from "./ClubStaffTab";
import { SquadTab } from "./SquadTab";
import { ClubPartnerships, ClubTactics } from "./ClubTactics";
import { ClubFinancialStatement, ClubRecordsPanel } from "./ClubRecords";
import { TransferCenter } from "./TransferCenter";
import { ClubStadiumEditor } from "./StadiumEditor";
import type { ClubDetails, ClubSummary, Finances } from "./types";
import { EditorContext, useProfileEditing } from "./useProfileEditing";

const text = clubProfileText;

/** The tabs of the profile: what the club has, its squad, its staff, and its stadium. */
export type ClubTab = "overview" | "supporters" | "squad" | "goldenGeneration" | "finances" | "transfers" | "clauses" | "affiliations" | "tactics" | "partnerships" | "staff" | "stadium" | "infrastructure";

const TABS: readonly ClubTab[] = ["overview", "supporters", "infrastructure", "squad", "goldenGeneration", "finances", "transfers", "clauses", "affiliations", "tactics", "partnerships", "staff", "stadium"];
const TAB_NAMES:Record<ClubTab,string>={overview:"Visão geral",supporters:"Torcida",infrastructure:"Infraestrutura",squad:"Plantéis",goldenGeneration:"Geração de Ouro",finances:"Finanças",transfers:"Centro de Transferências",clauses:"Central de cláusulas",affiliations:"Clubes afiliados",tactics:"Entendimento tático",partnerships:"Parcerias em campo",staff:"Funcionários e observação",stadium:"Estádio"};

/** The tab saved before the language was switched; the overview when there is none. */
export const readTab = (value: unknown): ClubTab =>
  TABS.includes(value as ClubTab) ? (value as ClubTab) : "overview";

interface ClubProfileProps {
  /** The row that was picked; its fields fill the header while the full profile loads. */
  club: ClubSummary;
  /** Changes when the game data is read again, so the profile is too. */
  version: number;
  /** The open tab. The list keeps it, so that the next club picked opens on it too. */
  tab: ClubTab;
  onTab: (tab: ClubTab) => void;
  onClose: () => void;
  onBack?: () => void;
}

/** The profile of one club. Mount it with `key={uid}` so a new club starts at the top. */
export function ClubProfile({ club, version, tab, onTab, onClose, onBack }: ClubProfileProps) {
  const loaded = useProfileDetails<ClubDetails>("club_details", club.uid, version);
  const editing = useProfileEditing("club", club.uid, version, loaded?.details?.stadium?.key);
  const scope = useContext(PendingScope) ?? undefined;
  const base = useId();
  const details = loaded?.details;
  const info: ClubSummary = details ?? club;
  const vitals = [info.founded !== null && text.founded(info.founded), `${profileText.uid} ${info.uid}`];

  const [showOverview, setShowOverview] = useState(tab === "overview");
  const [showSupporters, setShowSupporters] = useState(tab === "supporters");
  if (tab === "supporters" && !showSupporters) setShowSupporters(true);
  const [showStadium, setShowStadium] = useState(tab === "stadium");
  if (tab === "overview" && !showOverview) setShowOverview(true);
  if (tab === "stadium" && !showStadium) setShowStadium(true);
  const shown = tab;
  const panel: PanelIds = { id: `${base}-panel`, labelledBy: `${base}-${shown}` };

  return (
    <ProfileFrame
      picture={<ClubLogo uid={info.uid} name={info.name} size={PICTURE_SIZE.clubLogo} />}
      name={info.name}
      fullName={info.shortName}
      meta={[info.nation, info.league].filter(Boolean).join(" · ") || undefined}
      badge={info.women ? <span className="tag women">{text.womensClub}</span> : undefined}
      vitals={vitals}
      side={
        // Laid out like the abilities of a person: a label and a bar with the number on it. While the club is
        // edited the number is an input, where it is shown.
        <div className="club-summary-strip">
          <div><span>{text.reputationTitle}</span><EditableValue field="reputation">
            <ReputationMeter value={info.reputation} />
          </EditableValue></div>
          {details?.finances && <div><span>{text.balance}</span><strong>{formatMoney(details.finances.balance)}</strong></div>}
        </div>
      }
      tabs={details && <ClubTabs tab={shown} base={base} onSelect={next => { if (next !== shown && confirmPendingNavigation(true, scope)) onTab(next); }} />}
      wide
      loaded={loaded}
      onClose={onClose}
      onBack={onBack}
      editing={editing}
    >
      {details && showOverview && <div hidden={shown !== "overview"}>
        <ClubBody details={details} version={version} panel={{ ...panel, labelledBy: `${base}-overview`, id: `${base}-overview-panel` }} />
      </div>}
      {details && showSupporters && <div hidden={shown !== "supporters"} role="tabpanel"
        id={`${base}-supporters-panel`} aria-labelledby={`${base}-supporters`}>
        <ClubSupporters details={details} />
      </div>}
      {details && showStadium && <div hidden={shown !== "stadium"}>
        <ClubStadiumEditor club={details} version={version} panel={{ ...panel, labelledBy: `${base}-stadium`, id: `${base}-stadium-panel` }} />
      </div>}
      {details &&
        (shown === "squad" ? (
          <SquadTab clubUid={club.uid} version={version} panel={panel} />
        ) : shown === "goldenGeneration" ? (
          <GoldenGeneration key={club.uid} club={club.uid} version={version} panel={panel} />
        ) : shown === "finances" ? (
          <FinanceTab details={details} version={version} panel={panel}/>
        ) : shown === "transfers" ? (
          <TransferCenter club={club.uid} version={version} panel={panel}/>
        ) : shown === "clauses" || shown === "affiliations" ? (
          <div role="tabpanel" id={panel.id} aria-labelledby={panel.labelledBy}>
            <ClubRecordsPanel key={`${club.uid}:${shown}`} club={club.uid} section={shown} />
          </div>
        ) : shown === "tactics" ? (
          <ClubTactics club={club.uid} version={version} panel={panel}/>
        ) : shown === "partnerships" ? (
          <ClubPartnerships club={club.uid} panel={panel}/>
        ) : shown === "staff" ? (
          <div className="profile-stack">
            <ClubExtras club={details.uid} version={version} group="staff" />
            <ClubStaffTab club={{ uid: club.uid, name: info.name, women: info.women }} version={version} panel={panel} />
          </div>
        ) : shown === "infrastructure" ? (
          <div role="tabpanel" id={panel.id} aria-labelledby={panel.labelledBy}>
            <Facilities facilities={details.facilities} />
          </div>
        ) : null)}
    </ProfileFrame>
  );
}

interface ClubTabsProps {
  tab: ClubTab;
  /** The start of the ids of the tabs, which the panel they open names itself by (see `PanelIds`). */
  base: string;
  onSelect: (tab: ClubTab) => void;
}

/** The tabs under the header. The arrow keys move between them, as in any tab list. */
function ClubTabs({ tab, base, onSelect }: ClubTabsProps) {
  const buttons = useRef<Partial<Record<ClubTab, HTMLButtonElement | null>>>({});
  // The Squad and Staff tabs are out of reach while the club is edited.
  const offered = TABS;

  const keyDown = (event: KeyboardEvent) => {
    const at = offered.indexOf(tab);
    const target =
      event.key === "ArrowRight"
        ? offered[(at + 1) % offered.length]
        : event.key === "ArrowLeft"
          ? offered[(at - 1 + offered.length) % offered.length]
          : event.key === "Home"
            ? offered[0]
            : event.key === "End"
              ? offered[offered.length - 1]
              : undefined;
    if (target !== undefined) {
      event.preventDefault();
      onSelect(target);
      buttons.current[target]?.focus();
    }
  };

  return (
    <div className="profile-tabs" role="tablist" aria-label={text.tabsLabel} onKeyDown={keyDown}>
      {TABS.map((id) => {
        return (
          <button
            key={id}
            ref={(button) => {
              buttons.current[id] = button;
            }}
            type="button"
            role="tab"
            id={`${base}-${id}`}
            className="profile-tab"
            aria-selected={id === tab}
            aria-controls={id === "overview" || id === "supporters" || id === "stadium" ? `${base}-${id}-panel` : `${base}-panel`}
            // Only the tab that is open is a Tab stop; the arrow keys reach the other.
            tabIndex={id === tab ? 0 : -1}
            onClick={() => onSelect(id)}
          >
            {TAB_NAMES[id]}
          </button>
        );
      })}
    </div>
  );
}

function ClubBody({ details, version, panel }: { details: ClubDetails; version:number; panel: PanelIds }) {
  return (
    <div className="profile-stack club-overview" role="tabpanel" id={panel.id} aria-labelledby={panel.labelledBy}>
      <section className="profile-group">
        <h3>Identificação do clube</h3>
        <dl className="stats">
          <Fact label="Nome">{details.name}</Fact>
          {details.nation && <Fact label="País">{details.nation}</Fact>}
          {details.league && <Fact label="Competição">{details.league}</Fact>}
          {details.founded !== null && <Fact label="Fundação">{details.founded}</Fact>}
          {details.stadium?.name && <Fact label="Estádio">{details.stadium.name}</Fact>}
        </dl>
      </section>
      <ClubExtras club={details.uid} version={version} group="overview" seasonTickets={details.seasonTickets} socialMedia={details.socialMedia} />
      <QuickRecipes entity="club" />
    </div>
  );
}

function FinanceTab({details, version, panel}: {details: ClubDetails; version: number; panel: PanelIds}) {
  const [section, setSection] = useState("overview");
  const scope = useContext(PendingScope) ?? undefined;
  const sections = [
    ["overview", "Visão geral"], ["sponsors", "Patrocínios e outros"], ["debts", "Dívidas e empréstimos"],
    ["statements", "Demonstrativo financeiro"], ["history", "Histórico financeiro"], ["prizes", "Premiação da liga"],
  ];
  return <div role="tabpanel" id={panel.id} aria-labelledby={panel.labelledBy}>
    <div className="club-finance-tabs" role="tablist" aria-label="Seções das finanças">
      {sections.map(([id, name]) => <button key={id} type="button" role="tab" aria-selected={section === id}
        onClick={() => { if (section !== id && confirmPendingNavigation(true, scope)) setSection(id); }}>{name}</button>)}
    </div>
    {section === "sponsors" && <SponsorEditor club={details.uid} />}
    {section === "debts" && <ClubRecordsPanel key={details.uid} club={details.uid} section="debts" />}
    {section === "statements" && <ClubFinancialStatement key={details.uid} club={details.uid} version={version} />}
    {section === "history" && <FinanceHistory key={details.uid} club={details.uid} version={version} />}
    {section === "prizes" && <div className="club-tools">
      {details.leagueUid !== null ? <LeaguePrizesGroup club={details.uid} version={version} /> :
        <p>O clube não tem uma liga com premiação identificada.</p>}
    </div>}
    {section === "overview" && <div className="club-tools"><FinancesGroup club={details.uid} finances={details.finances} /></div>}
  </div>;
}

/** The keys of `labels` that `values` has, in the order of `labels`. */
function knownKeys<K extends string>(labels: Record<K, string>, values: Record<string, number>): K[] {
  return (Object.keys(labels) as K[]).filter((key) => values[key] !== undefined);
}

/**
 * Rating rows for the keys of `labels` that `values` has; a rating the game does not give is left out. The rows of
 * values the editor can change have `fieldGroup` (e.g. "facilities"): their field is `fieldGroup.key`.
 */
function ratingRows(
  labels: Record<string, string>,
  values: Record<string, number>,
  fieldGroup?: string,
): RatingRow[] {
  return knownKeys(labels, values).map((key) => ({
    key,
    field: fieldGroup === undefined ? undefined : `${fieldGroup}.${key}`,
    label: labels[key],
    value: values[key],
  }));
}

/** The club's facilities as ratings; inputs while the club is edited. */
function Facilities({ facilities }: { facilities: Record<string, number> }) {
  const rows = ratingRows(CLUB_FACILITY_LABELS, facilities, "facilities");
  return rows.length > 0 ? <RatingGroup title={text.facilities} rows={rows} /> : null;
}

/**
 * The club's money; the four amounts the editor can change are inputs while the club is edited, and the money can be
 * frozen.
 */
function FinancesGroup({ club, finances }: { club: number; finances: Finances | null }) {
  return (
    <section className="profile-group">
      <h3>{text.finances}</h3>
      {finances ? (
        <>
          <dl className="stats">
            <Fact label={text.balance}>
              <EditableValue field="finance.balance">
                <span className={finances.balance < 0 ? "negative" : undefined}>{formatMoney(finances.balance)}</span>
              </EditableValue>
            </Fact>
            <Fact label={text.transferBudget}>
              <EditableValue field="finance.transfer_budget">
                {/* FM stores -1 when the board has not set a transfer budget. */}
                {finances.transferBudget < 0 ? profileText.notSet : formatMoney(finances.transferBudget)}
              </EditableValue>
            </Fact>
            <Fact label={perWeek(text.wageBudget)}>
              <EditableValue field="finance.wage_budget">{formatMoney(finances.wageBudget)}</EditableValue>
            </Fact>
            <Fact label={perWeek(text.totalWageBudget)}>
              <EditableValue field="finance.total_wage_budget">{formatMoney(finances.totalWageBudget)}</EditableValue>
            </Fact>
            <Fact label={text.ticketPrice}>{formatTicketPrice(finances.ticketPrice)}</Fact>
          </dl>
          <FreezeMoney club={club} />
          <p className="note">{profileText.wageNote(converts)}</p>
        </>
      ) : (
        <p className="note">{text.noFinances}</p>
      )}
    </section>
  );
}

/**
 * Freezing the club's money: while the app is open and connected, its balance does not go down. Offered while the game
 * can be written to; once frozen, a note says what it does.
 */
function FreezeMoney({ club }: { club: number }) {
  const { editable } = useContext(EditorContext);
  // Whether the club's money is frozen; null until the app has said.
  const [frozen, setFrozen] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    frozenClubs()
      .then((clubs) => alive && setFrozen(clubs.includes(club)))
      .catch(() => alive && setFrozen(false));
    return () => {
      alive = false;
    };
  }, [club]);

  if (!editable || frozen === null) {
    return null;
  }
  const toggle = async (on: boolean) => {
    setError(null);
    try {
      setFrozen((await freezeMoney(club, on)).includes(club));
    } catch (e) {
      setError(describeError(e));
    }
  };
  return (
    <>
      <div className="freeze-line">
        <label className="freeze-toggle" title={text.freezeNote}>
          <input type="checkbox" checked={frozen} onChange={(e) => void toggle(e.currentTarget.checked)} />
          <span>{text.freeze}</span>
        </label>
        <InfoTip label={appText.freezeInfo.label} note={appText.freezeInfo.note} />
      </div>
      {frozen && <p className="note">{text.freezeNote}</p>}
      {error && (
        <p className="note error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** The label of an amount per week: the name, with "per week" in small print under it. */
function perWeek(label: string): ReactNode {
  return (
    <>
      {label}
      <span className="unit">{text.perWeek}</span>
    </>
  );
}

/** A ticket price: a whole amount as it is, anything else with two decimals ("£41.80"). */
function formatTicketPrice(price: number): string {
  return Number.isInteger(inCurrency(price))
    ? formatMoney(price)
    : formatMoney(price, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
