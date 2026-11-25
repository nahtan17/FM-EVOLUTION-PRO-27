import { useContext, useEffect, useId, useRef, useState } from "react";
import { AttributeActions } from "./AttributeActions";
import { ClauseList } from "./ClauseList";
import { CompareToggle } from "./Comparison";
import { EditableValue, EditInput } from "./EditControls";
import { call, inTauri } from "./api";
import { keepPlaying } from "./editing";
import { describeError, formatDate, formatNumber, formatMoney } from "./format";
import { ATTRIBUTE_LABELS, editText, positionLabel, profileText, type AttributeKey } from "./labels";
import { RecommendedAbility } from "./RecommendedAbility";
import { MedicalGroup } from "./MedicalGroup";
import { MoveButton } from "./MoveDialog";
import { ClubLogo, NationFlag, PersonFace, PICTURE_SIZE, WithPicture } from "./Picture";
import { FEET, GOALKEEPING, HIDDEN, isGoalkeeper, MENTAL, PHYSICAL, TECHNICAL } from "./playerAttributes";
import { PlayerRoleGuide, roleImportance, usePlayerRoleGuide } from "./ProfileRoleGuide";
import { QuickRecipes } from "./QuickRecipes";
import { PositionFreeze, PositionPitch, PositionRatings } from "./PositionPitch";
import { PermanentDialog } from "./PermanentDialog";
import { RecallDialog } from "./RecallDialog";
import { PlayerNames } from "./NamesDialog";
import { ReleaseButton } from "./ReleaseDialog";
import { TiesGroup } from "./TiesGroup";
import {
  attributeRow,
  Born,
  ContractDates,
  Fact,
  LOWER_IS_BETTER,
  personalityRows,
  ProfileFrame,
  ProfileAbilities,
  RatingGroup,
  ReputationBars,
  useProfileDetails,
  WageFact,
  type RatingRow,
} from "./ProfileParts";
import type { ApplyReport, Concern, Contract, FmDate, LoanDetails, PlayerDetails, PlayerSummary, Role } from "./types";
import { type Comparison } from "./useComparison";
import { EditorContext, useEditableField, useProfileEditing } from "./useProfileEditing";

interface PlayerProfileProps {
  /** The row that was picked; its fields fill the header while the full profile loads. */
  player: PlayerSummary;
  /** Changes when the game data is read again, so the profile is too. */
  version: number;
  onClose: () => void;
  onBack: () => void;
  /**
   * The players picked for a comparison: the header has the button that adds this player to it, or takes them out.
   * None outside the connected app.
   */
  comparison: Comparison | null;
}

const PLAYER_TABS = {
  general: "Informações gerais",
  technical: "Atributos técnicos",
  mental: "Atributos mentais",
  physical: "Atributos físicos",
  hidden: "Atributos escondidos",
  contract: "Contrato",
  positions: "Posições",
  medical: "Condição e lesões",
  career: "Plano de carreira",
  relationships: "Relacionamentos",
  moves: "Movimentos preferidos",
};
type PlayerTab = keyof typeof PLAYER_TABS;
const playerTabs = Object.keys(PLAYER_TABS) as PlayerTab[];

function PlayerFavorite({ uid, version }: { uid: number; version: number }) {
  const [selected, setSelected] = useState<boolean>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void call<boolean>("development_favorite", { uid, selected: null }).then(
      value => { if (live) setSelected(value); },
      reason => { if (live) setError(describeError(reason)); },
    );
    return () => { live = false; };
  }, [uid, version]);
  return <>
    <button type="button" aria-pressed={Boolean(selected)} disabled={pending || selected === undefined}
      onClick={() => {
        setPending(true); setError("");
        void call<boolean>("development_favorite", { uid, selected: !selected })
          .then(setSelected, reason => setError(describeError(reason))).finally(() => setPending(false));
      }}>{selected ? "★ Favorito" : "☆ Favoritar"}</button>
    {error && <span role="alert" className="error">{error}</span>}
  </>;
}

/** The profile of one player. Mount it with `key={uid}` so a new player starts at the top. */
export function PlayerProfile({ player, version, onClose, onBack, comparison }: PlayerProfileProps) {
  const loaded = useProfileDetails<PlayerDetails>("player_details", player.uid, version);
  const editing = useProfileEditing("player", player.uid, version);
  const details = loaded?.details;
  const [tab, setTab] = useState<PlayerTab>("general");
  const tabBase = useId();
  const info = details ?? player;
  const roleGuide = usePlayerRoleGuide(info.positions);
  const showsRoleGuide = tab === "general" || tab === "technical" || tab === "mental" || tab === "physical" || tab === "hidden";
  // The birth date and the height, like the nationality above them and the abilities, are inputs where they are shown
  // while the player is edited.
  const vitals = [
    info.dateOfBirth && <Born dateOfBirth={info.dateOfBirth} age={null} />,
    details && details.heightCm > 0 && <Height cm={details.heightCm} />,
    `${profileText.uid} ${info.uid}`,
  ];

  return (
    <ProfileFrame
      picture={<PersonFace uid={info.uid} name={info.name} size={PICTURE_SIZE.face} />}
      name={info.name}
      fullName={info.fullName}
      meta={
        <>
          {info.age !== null && <><strong>{profileText.age(info.age)}</strong>{" · "}</>}
          {!!info.positions.length && <><strong>{info.positions.map(positionLabel).join(" / ")}</strong>{" · "}</>}
          {info.club === null ? (
            <span className="muted">{profileText.freeAgent}</span>
          ) : (
            <WithPicture inline picture={<ClubLogo uid={info.clubUid} name={info.club} size={PICTURE_SIZE.textLogo} />}>
              {info.club}
            </WithPicture>
          )}
          {info.nation && (
            <>
              {" · "}
              <EditableValue field="nation">
                <WithPicture inline picture={<NationFlag uid={info.nationUid} />}>
                  {info.nation}
                </WithPicture>
              </EditableValue>
            </>
          )}
        </>
      }
      vitals={vitals}
      currentAbility={info.currentAbility}
      potentialAbility={info.potentialAbility}
      loaded={loaded}
      onClose={onClose}
      editing={editing}
      onBack={onBack}
      backLabel="Voltar aos jogadores"
      tabs={details && <div className="profile-tabs" role="tablist" aria-label="Seções do jogador">
        {playerTabs.map((id, index) => <button key={id} type="button" role="tab" className="profile-tab"
          id={`${tabBase}-${id}`} aria-selected={tab === id} aria-controls={`${tabBase}-panel`}
          tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)}
          onKeyDown={event => {
            const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
            if (!offset) return;
            event.preventDefault();
            const next = playerTabs[(index + offset + playerTabs.length) % playerTabs.length];
            setTab(next);
            document.getElementById(`${tabBase}-${next}`)?.focus();
          }}>{PLAYER_TABS[id]}</button>)}
      </div>}
      actions={
        <>
          {/* Only while the profile is read, not edited. The Transfer dialog starts from his contract, so its button
              waits for the details; for a free agent it signs him for a club. Release is for a player with a club. */}
          {editing.editable && !editing.applying && editing.changes.length + editing.invalid === 0 && (
            <div className="move-actions">
              <MoveButton
                player={{ uid: info.uid, name: info.name, club: info.club, clubUid: info.clubUid }}
                contract={details?.contract ?? null}
                ready={details !== undefined}
              />
              {info.club !== null && (
                <ReleaseButton player={{ uid: info.uid, name: info.name, club: info.club, clubUid: info.clubUid }} />
              )}
            </div>
          )}
          {inTauri && info.dateOfBirth && <PlayerFavorite uid={info.uid} version={version} />}
          {comparison && <CompareToggle comparison={comparison} player={{ uid: info.uid, name: info.name }} />}
        </>
      }
    >
      {details && <div role="tabpanel" id={`${tabBase}-panel`} aria-labelledby={`${tabBase}-${tab}`}>
        {showsRoleGuide && (
          <div className="person-attribute-toolbar">
            <PlayerRoleGuide guide={roleGuide} />
            {(tab === "general" || tab === "technical") && <AttributeActions entity="player" details={details} />}
          </div>
        )}
        {tab === "general" && <QuickRecipes entity="player" />}
        <ProfileBody details={details} tab={tab} role={roleGuide.selected} />
        <div className="player-names-section" hidden={tab !== "general"}>
          <PlayerNames player={{ uid: info.uid, name: info.name }} />
        </div>
      </div>}
    </ProfileFrame>
  );
}

function ProfileBody({ details, tab, role }: { details: PlayerDetails; tab: PlayerTab; role?: Role }) {
  const goalkeeper = isGoalkeeper(details);
  const primaryTechnical = goalkeeper ? GOALKEEPING : TECHNICAL;
  const otherTechnical = (goalkeeper ? TECHNICAL : GOALKEEPING).filter((key) => !primaryTechnical.includes(key));
  const showOtherTechnical = otherTechnical.some((key) => roleImportance(role, key));
  const technical = <>
    <RatingGroup title={goalkeeper ? profileText.goalkeeping : profileText.technical}
      rows={attributeRows(details, primaryTechnical, role)} />
    {showOtherTechnical && (
      <RatingGroup title={goalkeeper ? profileText.technical : profileText.goalkeeping}
        rows={attributeRows(details, otherTechnical, role)} />
    )}
  </>;
  switch (tab) {
    case "technical":
      return <div className="profile-columns">
        <div className="profile-stack">{technical}</div>
        <PlayerAbilityGroup details={details} />
      </div>;
    case "mental":
      return <div className="profile-columns">
        <RatingGroup title={profileText.mental} rows={attributeRows(details, MENTAL, role)} />
        <RatingGroup title={profileText.personality} rows={personalityRows(details.personality)} />
      </div>;
    case "physical":
      return <div className="profile-columns">
        <RatingGroup title={profileText.physical} rows={attributeRows(details, PHYSICAL, role)} />
        <RatingGroup title={profileText.feet} rows={attributeRows(details, FEET, role)} />
      </div>;
    case "hidden":
      return <div className="profile-columns">
        <RatingGroup title={profileText.hidden} rows={attributeRows(details, HIDDEN, role)} />
      </div>;
    case "positions":
      return <div className="profile-split"><section className="profile-group">
        <h3>{profileText.positions}</h3>
        <PositionPitch ratings={details.positionRatings}><PositionFreeze details={details} /></PositionPitch>
      </section><PositionRatings ratings={details.positionRatings} /></div>;
    case "contract":
      return details.contract ? <ContractGroup details={details} contract={details.contract} /> : <p className="note">Sem contrato disponível.</p>;
    case "medical":
      return <MedicalGroup details={details} />;
    case "career":
      return <CareerGroup details={details} />;
    case "relationships":
      return <TiesGroup details={details} />;
    case "moves":
      return <TraitsGroup traits={details.traits} />;
    case "general":
      return <div className="player-overview">
          <div className="player-overview-col">
            {technical}
          </div>
          <div className="player-overview-col">
            <RatingGroup title={profileText.mental} rows={attributeRows(details, MENTAL, role)} />
          </div>
          <div className="player-overview-col">
            <RatingGroup title={profileText.physical} rows={attributeRows(details, PHYSICAL, role)} />
            <RatingGroup title={profileText.hidden} rows={attributeRows(details, HIDDEN, role)} />
            <RatingGroup title={profileText.feet} rows={attributeRows(details, FEET, role)} />
          </div>
          <div className="player-overview-col">
            <PlayerAbilityGroup details={details} />
            <RatingGroup title={profileText.personality} rows={personalityRows(details.personality)} />
            <section className="profile-group">
              <h3>{profileText.reputation}</h3>
              <ReputationBars reputation={details.reputation} />
            </section>
          </div>
        </div>;
  }
}

function PlayerAbilityGroup({ details }: { details: PlayerDetails }) {
  return (
    <section className="profile-group profile-ability-panel">
      <h3>Habilidade</h3>
      <ProfileAbilities current={details.currentAbility} potential={details.potentialAbility} />
      <RecommendedAbility details={details} />
    </section>
  );
}

/** "178 cm" in the header; the number is an input while the player is edited. */
function Height({ cm }: { cm: number }) {
  if (!useEditableField("height")) {
    return profileText.height(cm);
  }
  return (
    <span className="edit-with-unit">
      <EditInput field="height" />
      {profileText.heightUnit}
    </span>
  );
}

function attributeRows(details: PlayerDetails, keys: readonly AttributeKey[], role?: Role): RatingRow[] {
  return keys.map((key) => ({
    ...attributeRow(key, ATTRIBUTE_LABELS[key], details.attributes[key], { lowerIsBetter: LOWER_IS_BETTER.has(key) }),
    importance: roleImportance(role, key),
  }));
}

/**
 * The wage, squad status and number, whether he is on the transfer and the loan list, and the dates. While he is
 * edited each value is an input where it is shown, a list a checkbox.
 */
function ContractGroup({ details, contract }: { details: PlayerDetails; contract: Contract }) {
  const uid = details.uid;
  const yesNo = (on: boolean) => (on ? editText.yes : editText.no);
  return (
    <section className="profile-group">
      <h3>{profileText.contract}</h3>
      <div className="profile-split">
        <div>
          <WageFact wage={contract.wage} />
          <dl className="stats">
            {contract.contractType !== null && (
              <Fact label={profileText.contractType}>{profileText.contractTypeName(contract.contractType)}</Fact>
            )}
            <Fact label={profileText.squadStatus}>
              <EditableValue field="contract.squad_status">
                {profileText.squadStatusName(contract.squadStatus)}
              </EditableValue>
            </Fact>
            <Fact label={profileText.squadNumber}>
              <EditableValue field="contract.squad_number">{contract.squadNumber ?? profileText.none}</EditableValue>
            </Fact>
            <Fact label={profileText.transferListed}>
              <EditableValue field="contract.transfer_listed" inFact>
                {yesNo(contract.transferListed)}
              </EditableValue>
            </Fact>
            <Fact label={profileText.loanListed}>
              <EditableValue field="contract.loan_listed" inFact>
                {yesNo(contract.loanListed)}
              </EditableValue>
            </Fact>
            <Fact label={profileText.loyaltyBonus}>
              <EditableValue field="contract.loyalty_bonus">{formatMoney(contract.loyaltyBonus)}</EditableValue>
            </Fact>
            <Fact label={profileText.happiness} title={profileText.moodTitle}>
              <EditableValue field="contract.happiness">{formatNumber(contract.happiness)}</EditableValue>
            </Fact>
            <Fact label={profileText.playingTimeHappiness} title={profileText.moodTitle}>
              <EditableValue field="contract.playing_time_happiness">
                {formatNumber(contract.playingTimeHappiness)}
              </EditableValue>
            </Fact>
          </dl>
        </div>
        <ContractDates entity="player" uid={uid} contract={contract} />
      </div>
      {details.loan && <LoanFacts uid={uid} name={details.name} loan={details.loan} contract={contract} />}
      <ClauseList
        uid={uid}
        name={details.name}
        clauses={contract.clauses}
        room={details.clauseRoom}
        signed={contract.signed}
      />
      <ConcernList uid={uid} concerns={contract.concerns} />
    </section>
  );
}

/**
 * Where a player is on loan, from his loan contract, and the buttons that end it. Recall opens a dialog that says what
 * the recall does and asks first (see `RecallDialog`): today becomes the last day of the loan, and the game brings him
 * back to his club when the day is over. Make permanent opens one that keeps him where he plays, under contract with
 * that club (see `PermanentDialog`). Once the loan ends today the Recall button gives way to a status saying his return
 * is pending; a loan whose end has passed while he is still away gets a warning and the button again. The end date is
 * an input while he is edited.
 */
function LoanFacts({ uid, name, loan, contract }: { uid: number; name: string; loan: LoanDetails; contract: Contract }) {
  const { editable, onEdited } = useContext(EditorContext);
  // The dialog that is up, if any.
  const [asking, setAsking] = useState<"recall" | "permanent" | null>(null);
  const recallButton = useRef<HTMLButtonElement>(null);
  const permanentButton = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef<"recall" | "permanent" | null>(null);

  // Once a dialog is gone, focus goes back to the button that opened it, while there is one: after a recall the
  // status takes its place, and after Make permanent the loan is gone with both buttons.
  useEffect(() => {
    if (wasAsking.current !== null && asking === null) {
      (wasAsking.current === "recall" ? recallButton : permanentButton).current?.focus();
    }
    wasAsking.current = asking;
  }, [asking]);

  const club = (clubUid: number | null, name: string | null) =>
    name === null ? (
      profileText.none
    ) : (
      <WithPicture inline picture={clubUid !== null && <ClubLogo uid={clubUid} name={name} size={PICTURE_SIZE.textLogo} />}>
        {name}
      </WithPicture>
    );
  const date = (value: FmDate | null) => formatDate(value) || profileText.none;
  const yesNo = (on: boolean) => (on ? editText.yes : editText.no);
  // An amount of nothing is no fee, as none is.
  const fee = (pounds: number | null) => (pounds !== null && pounds > 0 ? formatMoney(pounds) : profileText.none);
  const terms = loan.terms;

  return (
    <div className="clauses loan">
      <div className="injuries-head">
        <h4>{profileText.loan}</h4>
        <div className="loan-actions">
          {loan.ends === "today" ? (
            <span className="tag loan loan-status" role="status" title={profileText.pendingTitle(loan.parent ?? "")}>
              {loan.recalled ? profileText.recalledWaiting : profileText.endsTodayWaiting}
            </span>
          ) : (
            <button
              ref={recallButton}
              type="button"
              className="heal-toggle recall-toggle"
              aria-haspopup="dialog"
              disabled={!editable}
              title={profileText.recallTitle}
              onClick={() => setAsking("recall")}
            >
              {loan.ends === "passed" ? profileText.recallAgain : profileText.recall}
            </button>
          )}
          <button
            ref={permanentButton}
            type="button"
            className="heal-toggle permanent-toggle"
            aria-haspopup="dialog"
            disabled={!editable}
            title={profileText.makePermanentTitle}
            onClick={() => setAsking("permanent")}
          >
            {profileText.makePermanent}
          </button>
        </div>
      </div>
      <dl className="stats">
        <Fact label={profileText.loanAt}>{club(loan.clubUid, loan.club)}</Fact>
        <Fact label={profileText.loanParent}>{club(loan.parentUid, loan.parent)}</Fact>
        <Fact label={profileText.loanFrom}>{date(loan.from)}</Fact>
        <Fact label={profileText.loanUntil}>
          <EditableValue field="loan.expires">{date(loan.until)}</EditableValue>
        </Fact>
        <Fact label={profileText.loanNumber}>{loan.squadNumber ?? profileText.none}</Fact>
        {terms !== null && (
          <>
            <Fact label={profileText.loanCanRecall} title={profileText.loanCanRecallTitle}>
              {yesNo(terms.canBeRecalled)}
            </Fact>
            <Fact label={profileText.loanCanTerminate}>{yesNo(terms.canBeTerminated)}</Fact>
            <Fact label={profileText.loanCupMatches}>{yesNo(terms.cupMatches)}</Fact>
            <Fact label={profileText.loanAgainstClub}>{yesNo(terms.againstOwnClub)}</Fact>
            <Fact label={profileText.loanOptionFee} title={profileText.loanOptionFeeTitle}>
              <EditableValue field="loan.option_fee">{fee(terms.optionFee)}</EditableValue>
            </Fact>
            <Fact label={profileText.loanMonthlyFee} title={profileText.loanMonthlyFeeTitle}>
              {fee(terms.monthlyFee)}
            </Fact>
            <Fact label={profileText.loanUnusedFee} title={profileText.loanUnusedFeeTitle}>
              {fee(terms.unusedFee)}
            </Fact>
          </>
        )}
      </dl>
      {loan.ends === "passed" && (
        <div className="banner move-error" role="alert">
          {profileText.endPassed(date(loan.until))}
        </div>
      )}
      {asking === "recall" && (
        <RecallDialog uid={uid} name={name} loan={loan} onRecalled={onEdited} onClose={() => setAsking(null)} />
      )}
      {asking === "permanent" && (
        <PermanentDialog
          uid={uid}
          name={name}
          loan={loan}
          contract={contract}
          onDone={onEdited}
          onClose={() => setAsking(null)}
        />
      )}
    </div>
  );
}

/**
 * The reasons to be unhappy that last, in the game's words, naming the teammate a reason is held about, and the
 * button that removes them all (FMRTE's "Remove all"): the count of the player's list goes to none, and an undo in
 * Changes lists them again. The reasons his teammates hold about him the game then ends itself, as the button says.
 */
function ConcernList({ uid, concerns }: { uid: number; concerns: Concern[] }) {
  const { editable, onEdited } = useContext(EditorContext);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lasting = concerns.filter((concern) => concern.ended === null);

  useEffect(() => {
    setRemoving(false);
  }, [concerns]);

  const remove = async () => {
    if (removing) {
      return;
    }
    setRemoving(true);
    setError(null);
    try {
      const report = await call<ApplyReport>("apply_edits", {
        entity: "player",
        uid,
        edits: [{ field: "contract.unhappiness", value: 0 }],
      });
      if (report.failed.length > 0) {
        throw report.failed[0].error;
      }
      onEdited();
    } catch (e) {
      setError(describeError(e));
      setRemoving(false);
    }
  };

  return (
    <div className="clauses">
      <div className="injuries-head">
        <h4>{profileText.unhappiness}</h4>
        {lasting.length > 0 && (
          <button
            type="button"
            className="heal-toggle"
            disabled={!editable}
            aria-disabled={removing || undefined}
            title={`${profileText.removeUnhappinessTitle}\n${profileText.removeUnhappinessFollows}`}
            onClick={() => void remove()}
          >
            {removing ? profileText.removingUnhappiness : profileText.removeUnhappiness}
          </button>
        )}
      </div>
      {lasting.length === 0 ? (
        <p className="note">{profileText.noUnhappiness}</p>
      ) : (
        <dl className="stats">
          {lasting.map((concern, i) => {
            const reason = profileText.concernMotive(concern);
            return (
              <Fact key={i} label={reason}>
                {[
                  profileText.concernKind(concern.kind),
                  concern.started && profileText.concernSince(formatDate(concern.started)),
                  // The teammate, when the sentence does not name him already.
                  concern.about && !reason.includes(concern.about.name) && profileText.concernAbout(concern.about.name),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Fact>
            );
          })}
        </dl>
      )}
      {error && <p className="banner">{error}</p>}
    </div>
  );
}

/** The bits a player's traits are kept in: `trait.0` to `trait.63`. FMRTE's list names the first 62. */
const TRAIT_BITS = Array.from({ length: 64 }, (_, bit) => bit);

/**
 * His traits (preferred moves) by name; while he is edited, a checkbox for each, which writes its bit of the mask.
 */
function TraitsGroup({ traits }: { traits: number[] }) {
  const editing = useEditableField("trait.0");
  return (
    <section className="profile-group">
      <h3>{profileText.traits}</h3>
      {editing ? (
        <div className="traits-edit">
          {TRAIT_BITS.map((bit) => (
            <EditInput key={bit} field={`trait.${bit}`} />
          ))}
        </div>
      ) : traits.length === 0 ? (
        <p className="note">{profileText.noTraits}</p>
      ) : (
        <div className="tags">
          {traits.map((bit) => (
            <span key={bit} className="tag">
              {profileText.traitName(bit)}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

/** International record, reputation and asking price, and the retirement the game plans for the player. */
function CareerGroup({ details }: { details: PlayerDetails }) {
  const { international, reputation, askingPrice } = details;
  return (
    <section className="profile-group">
      <h3>{profileText.career}</h3>
      <div className="profile-split">
        <dl className="stats">
          <Fact label={profileText.internationalCaps}>
            <EditableValue field="international.caps">{international.caps}</EditableValue>
          </Fact>
          <Fact label={profileText.internationalGoals}>
            <EditableValue field="international.goals">{international.goals}</EditableValue>
          </Fact>
          <Fact label={profileText.u21Caps}>
            <EditableValue field="international.u21_caps">{international.u21Caps}</EditableValue>
          </Fact>
          <Fact label={profileText.u21Goals}>
            <EditableValue field="international.u21_goals">{international.u21Goals}</EditableValue>
          </Fact>
          <Fact label={profileText.askingPrice}>
            <EditableValue field="asking_price">
              {askingPrice === null ? profileText.notSet : formatMoney(askingPrice)}
            </EditableValue>
          </Fact>
        </dl>
        <div>
          <h4>{profileText.reputation}</h4>
          <ReputationBars reputation={reputation} />
        </div>
      </div>
      {details.retirementKnown && <RetirementPlan uid={details.uid} retires={details.retires} />}
    </section>
  );
}

/**
 * The date the game plans the player to retire on, with the button that keeps him playing: his plan comes out of the
 * game's, and he gets the trait to play on as long as possible. Like healing, it asks no question; Changes undoes it.
 */
function RetirementPlan({ uid, retires }: { uid: number; retires: FmDate | null }) {
  const { editable, readOnlyNote, onEdited } = useContext(EditorContext);
  const [keeping, setKeeping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The button stays busy until the profile has read the game again.
  useEffect(() => {
    setKeeping(false);
  }, [retires]);

  const keep = async () => {
    if (keeping) {
      return;
    }
    setKeeping(true);
    setError(null);
    try {
      await keepPlaying(uid);
      onEdited();
    } catch (e) {
      setError(describeError(e));
      setKeeping(false);
    }
  };

  return (
    <div className="clauses">
      <div className="injuries-head">
        <h4>{profileText.retirement}</h4>
        {retires !== null && (
          <button
            type="button"
            className="heal-toggle"
            disabled={!editable}
            aria-disabled={keeping || undefined}
            aria-busy={keeping || undefined}
            title={editable ? profileText.keepPlayingTitle : readOnlyNote}
            onClick={() => void keep()}
          >
            {keeping ? profileText.keepingPlaying : profileText.keepPlaying}
          </button>
        )}
      </div>
      {retires === null ? (
        <p className="note">{profileText.noRetirement}</p>
      ) : (
        <dl className="stats">
          <Fact label={profileText.retires}>{formatDate(retires)}</Fact>
        </dl>
      )}
      {error && <p className="banner">{error}</p>}
    </div>
  );
}
