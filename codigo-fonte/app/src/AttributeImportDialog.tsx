import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useModal } from "./useModal";
import { fieldLabel } from "./labels";
import { previewAttributeImport, type AttributeProfile } from "./attributeProfiles";
import type { EditSession } from "./useProfileEditing";

interface AttributeImportDialogProps {
  file: AttributeProfile;
  fileName: string;
  target: string;
  session: EditSession | null;
  busy: boolean;
  onStage: (count: number) => void;
  onClose: () => void;
}

export function AttributeImportDialog({ file, fileName, target, session, busy, onStage, onClose }: AttributeImportDialogProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const id = useId();
  useModal(dialog, true, onClose);
  useEffect(() => { dialog.current?.focus(); }, []);

  const { changes, unchanged, unavailable, pending } = previewAttributeImport(file.values, key => session?.input(key) ?? null);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget) event.preventDefault();
    }}>
      <section ref={dialog} className="modal attribute-import-dialog" role="dialog" aria-modal="true"
        aria-labelledby={id} tabIndex={-1}>
        <header className="modal-head">
          <h2 id={id}>Revisar importação de atributos</h2>
          <p className="mass-scope">{file.source.name} → {target}</p>
        </header>
        <div className="modal-body">
          <p className="note attribute-import-file">{fileName}</p>
          <p className="note">O arquivo adiciona mudanças ao rascunho. Use <strong>Salvar alterações</strong> ou <strong>Ctrl+S</strong> para aplicá-las.</p>
          {changes.length > 0 ? <table className="attribute-import-grid">
            <thead><tr><th>Atributo</th><th>Atual</th><th>Importado</th></tr></thead>
            <tbody>{changes.map(({ input, value, shown }) => (
              <tr key={input.field.key}>
                <th scope="row">{fieldLabel(file.entity, input.field.key)}</th>
                <td>{input.was} {input.field.scale === "attribute" && <small>({input.stored}/100)</small>}</td>
                <td>{shown} {input.field.scale === "attribute" && <small>({value}/100)</small>}</td>
              </tr>
            ))}</tbody>
          </table> : <p className="note">Nenhuma mudança disponível para adicionar.</p>}
          {unchanged > 0 && <p className="note">{unchanged} com o mesmo valor.</p>}
          {unavailable > 0 && <p className="note">{unavailable} sem suporte de edição ou fora da faixa permitida nesta ficha.</p>}
          {pending > 0 && <p className="note">{pending} mudanças que já estavam no rascunho serão preservadas.</p>}
        </div>
        <footer className="modal-foot">
          <button type="button" onClick={onClose}>Cancelar</button>
          <button type="button" className="primary" disabled={!session || busy || changes.length === 0}
            onClick={() => {
              if (!session) return;
              session.stageAttributes(Object.fromEntries(changes.map(({ input, value }) => [input.field.key, value])));
              onStage(changes.length);
            }}>
            Adicionar ao rascunho ({changes.length})
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
