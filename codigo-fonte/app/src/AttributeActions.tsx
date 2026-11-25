import { usePendingEdits } from "./pendingEdits";
// Attribute files and freezing for player and staff profiles.
import { AttributeImportDialog } from "./AttributeImportDialog";
import { createAttributeProfile, MAX_ATTRIBUTE_PROFILE_BYTES, parseAttributeProfile, type AttributeProfile } from "./attributeProfiles";
import { call, inTauri } from "./api";
import { useContext, useEffect, useRef, useState } from "react";
import { freezeAttributes, freezeStaffAttributes, frozenPlayers, frozenStaff } from "./editing";
import { describeError } from "./format";
import { InfoTip } from "./InfoTip";
import { appText, profileText } from "./labels";
import type { ExportReport, PlayerDetails, StaffDetails } from "./types";
import { EditorContext, useEditSession } from "./useProfileEditing";

export function AttributeActions({ entity, details }: { entity: "player"; details: PlayerDetails } | { entity: "staff"; details: StaffDetails }) {
  const uid = details.uid;
  const staff = entity === "staff";
  const { editable, readOnlyNote, onEdited } = useContext(EditorContext);
  const pending = usePendingEdits();
  const blocked = pending.count > 0 || pending.busy;
  const session = useEditSession();
  const picker = useRef<HTMLInputElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<{ profile: AttributeProfile; name: string } | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileMessage, setFileMessage] = useState<string | null>(null);
  const [exported, setExported] = useState<ExportReport | null>(null);
  const [frozen, setFrozen] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [freezeError, setFreezeError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    let current = true;
    (staff ? frozenStaff() : frozenPlayers())
      .then((uids) => current && setFrozen(uids.includes(uid)))
      .catch(() => current && setFrozen(false));
    return () => { current = false; };
  }, [uid, details, staff]);
  const freezeNote = staff ? profileText.freezeStaffAttributesNote : profileText.freezeAttributesNote;
  const freeze = async (on: boolean) => {
    if (!editable || busy) return;
    setBusy(true);
    setFreezeError(null);
    try {
      const uids = await (staff ? freezeStaffAttributes(uid, on) : freezeAttributes(uid, on));
      if (alive.current) setFrozen(uids.includes(uid));
      onEdited();
    } catch (e) {
      if (alive.current) setFreezeError(describeError(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  async function exportAttributes() {
    setFileBusy(true);
    setFileError(null);
    setFileMessage(null);
    setExported(null);
    try {
      if (inTauri) {
        const result = await call<ExportReport | null>("export_attributes", { entity, uid });
        if (alive.current && result) setExported(result);
      } else {
        const profile = createAttributeProfile(entity, details);
        const name = details.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 50);
        const file = `atributos-${uid}-${name || entity}.json`;
        const result = await saveBrowserProfile(file, profile);
        if (result && alive.current) setFileMessage(`Exportado: ${result}`);
      }
    } catch (error) {
      if (alive.current && !(error instanceof DOMException && error.name === "AbortError")) {
        setFileError(describeError(error));
      }
    } finally {
      if (alive.current) setFileBusy(false);
    }
  }

  async function readFile(file: File) {
    setFileBusy(true);
    setFileError(null);
    setFileMessage(null);
    setExported(null);
    try {
      if (file.size > MAX_ATTRIBUTE_PROFILE_BYTES) {
        throw Error("O arquivo de atributos deve ter até 64 KB.");
      }
      const profile = parseAttributeProfile(await file.text(), entity);
      if (alive.current) setPreview({ profile, name: file.name });
    } catch (error) {
      if (alive.current) setFileError(describeError(error));
    } finally {
      if (alive.current) setFileBusy(false);
    }
  }

  function closePreview() {
    setPreview(null);
    requestAnimationFrame(() => importButton.current?.focus());
  }

  return (
    <div className="attribute-actions">
      <div className="attribute-buttons">
        {session && <button type="button" onClick={() => {
          setFileError(null);
          const count = session.maximizeAttributes();
          setFileMessage(count
            ? `${count} atributos e valores de personalidade definidos como 20 no rascunho.`
            : "Nenhum atributo disponível para edição nesta ficha.");
        }} disabled={fileBusy || busy || pending.busy}
          title="Define os atributos e a personalidade como 20">Maximizar atributos</button>}
        <button type="button" onClick={() => void exportAttributes()} disabled={fileBusy || pending.busy}
          title="Escolha onde salvar os atributos e a personalidade já gravados">Exportar atributos</button>
        <button type="button" ref={importButton} onClick={() => picker.current?.click()}
          disabled={fileBusy || !session || pending.busy} title={editable ? undefined : readOnlyNote}>Importar atributos</button>
        <input type="file" ref={picker} accept=".json,application/json" aria-label="Arquivo JSON de atributos" hidden
          onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void readFile(file);
          }} />
        {frozen !== null && (
          <span className="freeze-line">
            <label className="freeze-toggle" title={editable ? freezeNote : readOnlyNote}>
              <input type="checkbox" checked={frozen} disabled={!editable || busy || blocked}
                onChange={(e) => void freeze(e.currentTarget.checked)} />
              <span>{profileText.freezeAttributes}</span>
            </label>
            <InfoTip label={appText.freezeInfo.label} note={appText.freezeInfo.note} />
          </span>
        )}
      </div>
      {frozen && <p className="note">{freezeNote}</p>}
      {freezeError && <p className="note error" role="alert">{freezeError}</p>}
      {fileMessage && <p className="note" role="status">{fileMessage}</p>}
      {exported && <div className="attribute-export-result">
        <span className="note" role="status">Exportado: {exported.file}</span>
        <button type="button" onClick={() => void call("show_export", { path: exported.path })
          .catch(error => setFileError(describeError(error)))}>Mostrar na pasta</button>
      </div>}
      {fileError && <p className="note error" role="alert">{fileError}</p>}
      {preview && <AttributeImportDialog file={preview.profile} fileName={preview.name} target={details.name}
        session={session} busy={pending.busy} onClose={closePreview} onStage={count => {
          setFileMessage(`${count} atributos adicionados ao rascunho. Use Salvar alterações para aplicá-los.`);
          closePreview();
        }} />}
    </div>
  );
}

/** Disk access in the browser is provided by its own picker when available. */
async function saveBrowserProfile(file: string, profile: AttributeProfile): Promise<string> {
  const data = new Blob([JSON.stringify(profile, null, 2) + "\n"], { type: "application/json" });
  const browser = window as Window & {
    showSaveFilePicker?: (options: {
      suggestedName: string;
      types: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<{ name: string; createWritable: () => Promise<WritableStream<Blob>> }>;
  };
  if (browser.showSaveFilePicker && window.top === window) {
    const handle = await browser.showSaveFilePicker({
      suggestedName: file,
      types: [{ description: "Arquivo JSON", accept: { "application/json": [".json"] } }],
    });
    const output = await handle.createWritable();
    const writer = output.getWriter();
    await writer.write(data);
    await writer.close();
    return handle.name;
  }

  const download = document.createElement("a");
  const url = URL.createObjectURL(data);
  download.download = file;
  download.href = url;
  document.body.append(download);
  download.click();
  download.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return file;
}
