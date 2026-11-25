import { useContext, useId, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { EditableValue } from "./EditControls";
import { renameStadium, stadiumName } from "./editing";
import { describeError, formatDate, formatNumber } from "./format";
import { InfoTip } from "./InfoTip";
import { clubProfileText as text, profileText } from "./labels";
import { usePendingForm } from "./pendingEdits";
import { Fact, useProfileDetails, type PanelIds } from "./ProfileParts";
import { isPitchDimension, stadiumChoiceLabel, stadiumFieldLabel, standPositions, standProperties,
  type StadiumDetails, type StadiumStand, type StadiumValue } from "./stadiumFields";
import type { ClubDetails, Stadium, StadiumName } from "./types";
import { EditorContext, useEditSession } from "./useProfileEditing";

const detailKeys = ["environment", "ownerType", "seatColour", "decay", "built", "rebuilt", "latitude", "longitude"];
const propertyKeys = ["trainingGround", "noContinentalFinal", "extinct", "covered", "retractableRoof", "undersoilHeating", "digitalBoards"];
const capacityKeys = ["allSeater", "national", "nationalU21", "nationalU19"];
const pitchKeys = [
  "pitchType", "pitchCondition", "deterioration", "recovery", "pitchRelaid", "pitchRelay",
  "length", "width", "internationalLength", "internationalWidth", "minLength", "minWidth", "maxLength", "maxWidth",
];

export function useStadiumDetails(club: number, version: number) {
  return useProfileDetails<StadiumDetails | null>("stadium_details", club, version);
}

export function ClubStadiumEditor({ club, version, panel }: { club: ClubDetails; version: number; panel: PanelIds }) {
  const loaded = useStadiumDetails(club.uid, version);
  return <div role="tabpanel" id={panel.id} aria-labelledby={panel.labelledBy}>
    <StadiumEditor club={club} stadium={club.stadium} details={loaded?.details}
      loading={!loaded} error={loaded?.error} />
  </div>;
}

type StadiumTab = "information" | "stands";
const tabs: { id: StadiumTab; label: string }[] = [
  { id: "information", label: "Informações" }, { id: "stands", label: "Arquibancadas" },
];

export function StadiumEditor({ club, stadium, details, loading, error }: {
  club: ClubDetails;
  stadium: Stadium | null;
  details?: StadiumDetails | null;
  loading: boolean;
  error?: string;
}) {
  const [tab, setTab] = useState<StadiumTab>("information");
  const id = useId();
  const buttons = useRef<Partial<Record<StadiumTab, HTMLButtonElement | null>>>({});
  if (!stadium) return <p className="note">{text.noStadium}</p>;

  const onKey = (event: KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "information" : event.key === "End" ? "stands"
      : tab === "information" ? "stands" : "information";
    setTab(next);
    buttons.current[next]?.focus();
  };
  const stage = details?.key === stadium.key ? details : undefined;

  return <div className="stadium-editor">
    <div className="profile-tabs stadium-tabs" role="tablist" aria-label="Seções do estádio" onKeyDown={onKey}>
      {tabs.map(({ id: section, label }) => <button type="button" role="tab" className="profile-tab" key={section}
        ref={button => { buttons.current[section] = button; }}
        id={`${id}-${section}`} aria-controls={`${id}-${section}-panel`}
        aria-selected={tab === section} tabIndex={tab === section ? 0 : -1} onClick={() => setTab(section)}>{label}</button>)}
    </div>
    {error && <p className="banner" role="alert">{error}</p>}
    {loading && <p className="note" role="status">Lendo os dados do estádio…</p>}
    <div hidden={tab !== "information"} role="tabpanel" id={`${id}-information-panel`} aria-labelledby={`${id}-information`}>
      <StadiumInformation club={club} stadium={stadium} details={stage} />
    </div>
    <div hidden={tab !== "stands"} role="tabpanel" id={`${id}-stands-panel`} aria-labelledby={`${id}-stands`}>
      <StandMap stands={stage?.stands} capacity={stadium.capacity} />
    </div>
  </div>;
}

function StadiumInformation({ club, stadium, details }: {
  club: ClubDetails; stadium: Stadium; details?: StadiumDetails;
}) {
  const fields = details?.fields ?? {};
  const pitch = pitchKeys.filter(key => fields[key] !== undefined);
  const place = [details?.city, details?.country].filter(Boolean).join(" · ");

  return <div className="stadium-information">
    <section className="profile-group">
      <h3>Estádio</h3>
      <StadiumNameRow club={club.uid} stadium={stadium} />
      <dl className="stats">
        {details?.stadiumUid != null && <Fact label="ID do estádio">{details.stadiumUid}</Fact>}
        {place && <Fact label="Localização">{place}</Fact>}
        {details?.owner && <Fact label="Dono">{details.owner}</Fact>}
        <Fact label="Clube associado">{club.name}</Fact>
        {club.nation && !details?.country && <Fact label="País do clube">{club.nation}</Fact>}
        {details?.nearby && <Fact label="Estádio próximo">{details.nearby}</Fact>}
        <StadiumFacts keys={detailKeys} fields={fields} />
      </dl>
      {propertyKeys.some(key => fields[key] !== undefined) && <dl className="stats stadium-properties">
        <StadiumFacts keys={propertyKeys} fields={fields} />
      </dl>}
    </section>
    <div className="profile-stack">
      <section className="profile-group">
        <h3>Capacidade</h3>
        <dl className="stats">
          <Fact label={text.capacity}><EditableValue field="stadium.capacity">{formatNumber(stadium.capacity)}</EditableValue></Fact>
          <Fact label={text.seating}><EditableValue field="stadium.seating">{formatNumber(stadium.seating)}</EditableValue></Fact>
          <Fact label={text.expansion}><EditableValue field="stadium.expansion">{formatNumber(stadium.expansion)}</EditableValue></Fact>
          <Fact label={text.used} title={text.usedTitle}>
            <EditableValue field="stadium.used">{stadium.used === 0 ? text.usedAll : formatNumber(stadium.used)}</EditableValue>
          </Fact>
          <StadiumFacts keys={capacityKeys} fields={fields} />
        </dl>
      </section>
      <section className="profile-group">
        <h3>Gramado</h3>
        {pitch.length > 0 ? <dl className="stats"><StadiumFacts keys={pitch} fields={fields} /></dl>
          : <p className="note">O perfil desta versão do jogo ainda não fornece dados do gramado.</p>}
      </section>
    </div>
  </div>;
}

function StadiumFacts({ keys, fields }: { keys: string[]; fields: Record<string, StadiumValue> }) {
  return keys.map(key => {
    const value = fields[key];
    if (value === undefined) return null;
    const field = `stadium.${key}`;
    const label = stadiumFieldLabel(field) ?? key;
    return <Fact key={key} label={label}>
      <EditableValue field={field} inFact>{displayValue(field, value, label)}</EditableValue>
    </Fact>;
  });
}

function displayValue(field: string, value: StadiumValue, label: string): ReactNode {
  if (typeof value === "boolean") {
    return <input type="checkbox" aria-label={label} checked={value} disabled />;
  }
  if (typeof value === "object") return formatDate(value);
  if (field === "stadium.seatColour") {
    const color = `#${value.toString(16).padStart(6, "0")}`;
    return <span className="stadium-color"><span style={{ background: color }} />{color.toUpperCase()}</span>;
  }
  if (isPitchDimension(field)) return `${formatNumber(value)} m`;
  return stadiumChoiceLabel(field, value) ?? formatNumber(value, { maximumFractionDigits: 6 });
}

function StandMap({ stands, capacity }: { stands?: StadiumStand[] | null; capacity: number }) {
  const edit = useEditSession();
  const sum = stands?.reduce((total, stand) => {
    const input = edit?.input(`stadium.stand.${stand.index}.capacity`);
    return total + (input && input.status !== "invalid" ? Number(input.text) : stand.capacity);
  }, 0);
  const capacityDraft = edit?.input("stadium.capacity");
  const total = capacityDraft && capacityDraft.status !== "invalid" ? Number(capacityDraft.text) : capacity;

  if (!stands?.length) return <section className="profile-group">
    <h3>Arquibancadas</h3>
    <p className="note">{stands ? "Este estádio não tem setores identificados."
      : "A tabela de setores não pôde ser validada para este estádio e versão do jogo."}</p>
  </section>;

  return <section className="profile-group stadium-stands">
    <h3>Arquibancadas</h3>
    <div className="stadium-stand-summary" role="status">
      <span>Capacidade dos setores <strong>{formatNumber(sum ?? 0)}</strong></span>
      <span>Capacidade do estádio <strong>{formatNumber(total)}</strong></span>
      {sum !== total && <span className="stand-warning">
        Diferença de {formatNumber(Math.abs((sum ?? 0) - total))} lugares
      </span>}
    </div>
    <div className="stadium-map">
      <div className="stadium-pitch" aria-label="Campo de futebol" role="img">
        <div className="pitch-markings"><span className="pitch-box left" /><span className="pitch-box right" /></div>
      </div>
      {stands.map(stand => {
        const position = standPositions[stand.index];
        if (!position) return null;
        const field = `stadium.stand.${stand.index}`;
        return <section key={stand.index} className={`stadium-stand stand-${position.area}`} style={{ gridArea: position.area }}>
          <h4>{position.name}</h4>
          <div className="stand-capacity"><EditableValue field={`${field}.capacity`}>{formatNumber(stand.capacity)}</EditableValue></div>
          <div className="stand-flags">
            {(Object.keys(standProperties) as (keyof typeof standProperties)[]).map(key =>
              <div key={key}><span>{standProperties[key]}</span>
                <EditableValue field={`${field}.${key}`} inFact>
                  <input type="checkbox" aria-label={`${standProperties[key]} · ${position.name}`} checked={stand[key]} disabled />
                </EditableValue>
              </div>)}
          </div>
        </section>;
      })}
    </div>
  </section>;
}

/** How many bytes of UTF-8 `text` takes, as the game keeps a name. */
const utf8Length = (value: string) => new TextEncoder().encode(value).length;

/**
 * A stadium's name, with Rename while the game can be written to: under it, an input, Save and Cancel, and a note of
 * its length. Any name of 1 to 80 bytes (see `stadium_name`): written over the old one where it fits, given a string
 * of its own otherwise. Where the editor cannot rename it (a shared name, where it cannot take memory), a note says
 * so. Written at once, and logged. An (i) after it says how a new name lasts: the app gives it again each time the
 * game loads the save, while it is open.
 */
function StadiumNameRow({ club, stadium }: { club: number; stadium: Stadium }) {
  const { key, name } = stadium;
  const { editable, onEdited } = useContext(EditorContext);
  const [room, setRoom] = useState<StadiumName | null>(null);
  const [draft, setDraft] = useState<{ value: string; key: string; before: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();

  // What the name may become, read again whenever it changes.
  useEffect(() => {
    let alive = true;
    setRoom(null);
    stadiumName(club).then(
      (found) => alive && setRoom(found),
      () => alive && setRoom(null),
    );
    return () => {
      alive = false;
    };
  }, [club, key, name]);

  const value = draft?.value ?? room?.name ?? name ?? "";
  const canRename = editable && room?.renamable === true;
  const bytes = utf8Length(value);
  const fits = room !== null && bytes >= room.minBytes && bytes <= room.maxBytes;
  const clean = value.trim() === value && value.length > 0 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
  const changed = draft !== null && draft.value !== draft.before;
  const save = async () => {
    if (!draft || !canRename || !changed || !fits || !clean) return false;
    setSaving(true);
    setError(null);
    try {
      await renameStadium(club, value, draft.key, draft.before);
      setRoom(current => current && { ...current, name: value });
      setDraft(null);
      onEdited();
      return true;
    } catch (e) {
      setError(describeError(e));
      return false;
    } finally {
      setSaving(false);
    }
  };
  const lengthNote = room && text.nameLength(bytes, room.minBytes, room.maxBytes);
  usePendingForm({ profile: true, fields: changed ? [`stadium:${draft.key}:stadium.name`] : [], count: changed ? 1 : 0, busy: saving, validate: () => {
    if (!canRename || draft?.key !== key || draft.before !== room?.name) throw Error("O estádio ou seu nome mudou. Confira os dados antes de salvar.");
    if (!fits || !clean) throw Error(lengthNote ?? text.stadiumName);
  }, save });
  return <>
    <dl className="stats stadium-name-row">
      <Fact label={text.stadiumName}>
        {canRename && room ? <span className="stadium-name">
          <input type="text" className="stadium-name-input" aria-label={text.stadiumName}
            aria-describedby={noteId} aria-invalid={changed && (!fits || !clean) || undefined}
            value={value} disabled={saving} onChange={event => setDraft({ value: event.currentTarget.value, key, before: room.name })} />
          <InfoTip label={text.renameInfoLabel} note={text.renameInfo} />
        </span> : <span>{name ?? profileText.none}</span>}
      </Fact>
    </dl>
    {room && !room.renamable && <p className="note">{text.nameShared(room.holders)}</p>}
    {canRename && <p id={noteId} className={changed && (!fits || !clean) ? "move-note invalid" : "move-note"}>{lengthNote}</p>}
    {changed && <button type="button" className="stadium-discard-name" onClick={() => setDraft(null)} disabled={saving}>Descartar nome digitado</button>}
    {error && <p className="error" role="alert">{error}</p>}
  </>;

}
