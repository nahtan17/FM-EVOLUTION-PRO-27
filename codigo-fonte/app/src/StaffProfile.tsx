import { Fragment, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { AttributeActions } from "./AttributeActions";
import { EditableValue } from "./EditControls";
import { changeStaffJob, offeredStaffJobs } from "./editing";
import { describeError } from "./format";
import { jobLabel, profileText, STAFF_ATTRIBUTE_LABELS, type StaffAttributeKey } from "./labels";
import { MoveButton } from "./MoveDialog";
import { ClubLogo, NationFlag, PersonFace, PICTURE_SIZE, WithPicture } from "./Picture";
import { RoleLegend } from "./ProfileRoleGuide";
import { ReleaseButton } from "./ReleaseDialog";
import {
  attributeRow,
  Born,
  ContractDates,
  Fact,
  personalityRows,
  ProfileFrame,
  ProfileAbilities,
  RatingGroup,
  ReputationBars,
  useProfileDetails,
  WageFact,
  type RatingRow,
} from "./ProfileParts";
import type { StaffContract, StaffDetails, StaffSummary } from "./types";
import { useEditSession, EditorContext, useProfileEditing } from "./useProfileEditing";

// Attributes in the order FM lists them, by group.
const COACHING: StaffAttributeKey[] = ["attacking", "defending", "fitness", "goalkeeping", "possession", "coaching_player", "tactical", "technical", "people_management", "working_with_youngsters", "dirtiness_allowance", "versatility", "set_pieces"];
const MENTAL: StaffAttributeKey[] = ["determination", "judging_ability", "judging_potential", "judging_staff", "negotiating", "authority", "motivating", "tactical_knowledge", "physiotherapy", "sports_science"];
const SCOUTING: StaffAttributeKey[] = ["data_analysis", "judging_team_data", "presenting_data"];
const TACTICAL: StaffAttributeKey[] = ["tactical_attacking", "depth", "directness", "flamboyancy", "flexibility", "free_roles", "marking", "offside", "pressing", "sitting_back", "tempo", "use_of_playmaker", "use_of_substitutions", "width"];
const NON_TACTICAL: StaffAttributeKey[] = ["buying_players", "hardness_of_training", "mind_games", "squad_rotation"];
const CHAIRPERSON: StaffAttributeKey[] = ["business", "interference", "patience", "resources"];

// Contract job codes, including their player/staff variants. Only mapped specialisms receive a guide.
const JOB_ATTRIBUTES: Partial<Record<number, readonly StaffAttributeKey[]>> = {
  12: ["physiotherapy"],
  14: ["judging_ability", "judging_potential"],
  22: ["set_pieces"],
  26: ["fitness"],
  34: ["goalkeeping"],
  40: ["sports_science"],
  44: ["judging_ability", "judging_potential"],
  48: ["sports_science"],
  50: ["physiotherapy"],
  58: ["data_analysis"],
  60: ["data_analysis"],
  62: ["data_analysis"],
  64: ["working_with_youngsters"],
};

/** The game stores these two as shown (1–20); every other attribute is stored as 0–100. */
const STORED_AS_SHOWN = new Set<string>(["working_with_youngsters", "authority", "tactical_attacking", "depth", "directness", "flamboyancy", "flexibility", "free_roles", "marking", "offside", "pressing", "sitting_back", "tempo", "use_of_playmaker", "use_of_substitutions", "width", "buying_players", "hardness_of_training", "mind_games", "squad_rotation", "business", "interference", "patience", "resources"]);

/** The "You" badge of the manager the user controls. */
export function HumanBadge() {
  return (
    <span className="tag you" title={profileText.youTitle}>
      {profileText.you}
    </span>
  );
}

/**
 * Where a member of staff works: the club, "Unemployed" when they have no job at all, and nothing
 * when they have a job at a team whose club is unknown.
 */
export function employerOf(member: StaffSummary): ReactNode {
  if (member.club !== null) {
    return member.club;
  }
  return member.job === null ? <span className="muted">{profileText.unemployed}</span> : null;
}

/** `employerOf` for a line of text: the club comes with its logo. */
function employerLine(member: StaffSummary): ReactNode {
  if (member.club === null) {
    return employerOf(member);
  }
  return (
    <WithPicture inline picture={<ClubLogo uid={member.clubUid} name={member.club} size={PICTURE_SIZE.textLogo} />}>
      {member.club}
    </WithPicture>
  );
}

/** The parts that are there, with a dot between them. */
function dotted(parts: ReactNode[]): ReactNode {
  return parts
    .filter((part) => part !== null && part !== undefined && part !== false && part !== "")
    .map((part, index) => (
      <Fragment key={index}>
        {index > 0 && " · "}
        {part}
      </Fragment>
    ));
}

interface StaffProfileProps {
  /** The row that was picked; its fields fill the header while the full profile loads. */
  member: StaffSummary;
  /** Changes when the game data is read again, so the profile is too. */
  version: number;
  onClose: () => void;
  onBack: () => void;
}

/** The profile of one member of staff. Mount it with `key={uid}` so a new person starts at the top. */
export function StaffProfile({ member, version, onClose, onBack }: StaffProfileProps) {
  const loaded = useProfileDetails<StaffDetails>("staff_details", member.uid, version);
  const editing = useProfileEditing("staff", member.uid, version);
  const details = loaded?.details;
  const info: StaffSummary = details ?? member;
  const vitals = [info.dateOfBirth && <Born dateOfBirth={info.dateOfBirth} age={info.age} />, `${profileText.id} ${info.uid}`];

  return (
    <ProfileFrame
      picture={<PersonFace uid={info.uid} name={info.name} size={PICTURE_SIZE.face} />}
      name={info.name}
      fullName={info.fullName}
      badge={info.isHuman ? <HumanBadge /> : undefined}
      meta={dotted([
        info.job !== null && jobLabel(info.job),
        employerLine(info),
        // An input where it is shown while the member of staff is edited, like the abilities.
        info.nation && (
          <EditableValue field="nation">
            <WithPicture inline picture={<NationFlag uid={info.nationUid} />}>
              {info.nation}
            </WithPicture>
          </EditableValue>
        ),
      ])}
      vitals={vitals}
      currentAbility={info.currentAbility}
      potentialAbility={info.potentialAbility}
      loaded={loaded}
      onClose={onClose}
      onBack={onBack}
      backLabel="Voltar à comissão técnica"
      editing={editing}
      actions={
        // Only while the profile is read, not edited, and for someone who is not you: one with no club is signed, and
        // one with a club can be released.
        editing.editable &&
        !editing.applying && editing.changes.length + editing.invalid === 0 &&
        !info.isHuman && (
          <div className="move-actions">
            <MoveButton
              kind="staff"
              player={{ uid: info.uid, name: info.name, club: info.club, clubUid: info.clubUid, job: info.job }}
              contract={null}
              ready={details !== undefined}
            />
            {info.club !== null && info.job !== null && (
              <StaffRelease
                job={info.job}
                member={{ uid: info.uid, name: info.name, club: info.club, clubUid: info.clubUid }}
              />
            )}
          </div>
        )
      }
    >
      {details && <StaffBody details={details} canChangeJob={!editing.applying && editing.changes.length + editing.invalid === 0 && !info.isHuman} />}
    </ProfileFrame>
  );
}

interface StaffReleaseProps {
  /** The member of staff's job, as a contract code. */
  job: number;
  member: { uid: number; name: string; club: string; clubUid: number | null };
}

/**
 * Release, beside Transfer, for a member of staff whose job the editor gives and takes away: not the board, nor a job
 * it cannot name, whom the game keeps in another way. The dialog says why another cannot be released.
 */
function StaffRelease({ job, member }: StaffReleaseProps) {
  const [jobs, setJobs] = useState<number[] | null>(null);

  useEffect(() => {
    let alive = true;
    offeredStaffJobs().then(
      (codes) => alive && setJobs(codes),
      () => alive && setJobs([]),
    );
    return () => {
      alive = false;
    };
  }, []);

  return jobs?.includes(job) ? <ReleaseButton kind="staff" player={member} /> : null;
}

function StaffBody({ details, canChangeJob }: { details: StaffDetails; canChangeJob: boolean }) {
  const [highlight, setHighlight] = useState(true);
  const session = useEditSession();
  const job = details.job;
  const jobAttributes = job === null || job < 2 ? undefined : JOB_ATTRIBUTES[job - job % 2];
  const essential = highlight ? jobAttributes : undefined;
  return (
    <>
      <div className="person-attribute-toolbar">
        <AttributeActions entity="staff" details={details} />
        {session && (
          <div className="attribute-buttons" role="group" aria-label="Predefinições de atributos da comissão">
            {[20, 14, 12, 10, 5, 1].map((rating) => (
              <button key={rating} type="button" disabled={session.busy}
                aria-label={`Definir atributos em ${rating}`}
                onClick={() => session.maximizeAttributes(rating)}>{rating}</button>
            ))}
          </div>
        )}
        {jobAttributes?.some((key) => details.attributes[key] !== undefined) && (
          <div className="profile-role-guide" role="group" aria-label="Destaques dos atributos por cargo">
            <label className="staff-role-toggle">
              <input type="checkbox" checked={highlight} onChange={(event) => setHighlight(event.currentTarget.checked)} />
              Destacar atributos do cargo
            </label>
            {highlight && <RoleLegend secondary={false} />}
          </div>
        )}
      </div>

      <div className="player-overview">
        <div className="profile-stack">
          <RatingGroup title={profileText.coaching} rows={attributeRows(details, COACHING, essential)} />
          <RatingGroup title="Atributos táticos" rows={attributeRows(details, TACTICAL, essential)} />
        </div>
        <div className="profile-stack">
          <RatingGroup title={profileText.mental} rows={attributeRows(details, MENTAL, essential)} />
          <RatingGroup title="Atributos de presidente" rows={attributeRows(details, CHAIRPERSON, essential)} />
        </div>
        <div className="profile-stack">
          <RatingGroup title="Observação" rows={attributeRows(details, SCOUTING, essential)} />
          <RatingGroup title="Atributos não táticos" rows={attributeRows(details, NON_TACTICAL, essential)} />
        </div>
        <div className="profile-stack">
          <section className="profile-group profile-ability-panel">
            <h3>Habilidade</h3>
            <ProfileAbilities current={details.currentAbility} potential={details.potentialAbility} />
          </section>
          <RatingGroup title={profileText.personality} rows={personalityRows(details.personality)} />
          <section className="profile-group">
            <h3>Funções da comissão</h3>
            <dl className="stats">
              <Fact label={profileText.job}>{details.job === null ? profileText.unemployed : jobLabel(details.job)}</Fact>
            </dl>
            {details.contract && canChangeJob && <JobChange uid={details.uid} job={details.contract.job} />}
          </section>
          {details.contract && (
            <ContractGroup uid={details.uid} contract={details.contract} />
          )}
          <section className="profile-group">
            <h3>{profileText.reputation}</h3>
            <ReputationBars reputation={details.reputation} />
          </section>
        </div>
      </div>
    </>
  );
}

function attributeRows(details: StaffDetails, keys: StaffAttributeKey[], essential?: readonly StaffAttributeKey[]): RatingRow[] {
  return keys.map((key) => ({
    ...attributeRow(key, STAFF_ATTRIBUTE_LABELS[key], details.attributes[key], {
      scale: STORED_AS_SHOWN.has(key) ? 20 : 100,
    }),
    importance: details.attributes[key] && essential?.includes(key) ? "essential" : undefined,
  }));
}

interface ContractGroupProps {
  uid: number;
  contract: StaffContract;
}

function ContractGroup({ uid, contract }: ContractGroupProps) {
  return (
    <section className="profile-group">
      <h3>{profileText.contract}</h3>
      <WageFact wage={contract.wage} />
      <ContractDates entity="staff" uid={uid} contract={contract} />
    </section>
  );
}

/**
 * Giving the member of staff another job at their club: a button, then a select of the jobs the editor gives and
 * Apply. Offered while the game can be written to, for a job the editor can take away; the game moves them between
 * the club's departments as the job needs, and the change log can undo it.
 */
function JobChange({ uid, job }: { uid: number; job: number }) {
  const { editable, onEdited } = useContext(EditorContext);
  const selectId = useId();
  const [jobs, setJobs] = useState<number[] | null>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(job);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    offeredStaffJobs().then(
      (codes) => alive && setJobs(codes),
      () => alive && setJobs([]),
    );
    return () => {
      alive = false;
    };
  }, []);

  if (!editable || jobs === null || !jobs.includes(job)) {
    return null;
  }
  if (!open) {
    return (
      <button
        type="button"
        className="job-change"
        title={profileText.changeJobTitle}
        onClick={() => {
          setPicked(job);
          setError(null);
          setOpen(true);
        }}
      >
        {profileText.changeJob}
      </button>
    );
  }
  const byName = [...jobs].sort((a, b) => jobLabel(a).localeCompare(jobLabel(b)));
  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      await changeStaffJob(uid, picked);
      setOpen(false);
      // The game has changed: the lists, the profile and the change log read it again.
      onEdited();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="job-change-form">
      <label htmlFor={selectId}>{profileText.newJob}</label>
      <select id={selectId} value={picked} disabled={busy} onChange={(e) => setPicked(Number(e.currentTarget.value))}>
        {byName.map((code) => (
          <option key={code} value={code}>
            {jobLabel(code)}
          </option>
        ))}
      </select>
      <button type="button" className="primary" disabled={busy || picked === job} onClick={() => void apply()}>
        {profileText.applyJob}
      </button>
      <button type="button" disabled={busy} onClick={() => setOpen(false)}>
        {profileText.cancelJob}
      </button>
      {error && (
        <p className="note error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
