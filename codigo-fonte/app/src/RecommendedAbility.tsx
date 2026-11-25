import type { InputState } from "./editDraft";
import { positionLabel } from "./labels";
import { estimateAbility } from "./recommendedAbilityModel";
import type { PlayerDetails } from "./types";
import { useEditSession } from "./useProfileEditing";

function draftNumber(input: InputState | null | undefined, saved?: number): number | undefined {
  if (!input) return saved;
  return input.status === "invalid" ? undefined : input.status === "same" ? input.was : Number(input.text);
}

export function RecommendedAbility({ details }: { details: PlayerDetails }) {
  const session = useEditSession();
  const currentInput = session?.input("current_ability");
  const current = draftNumber(currentInput, details.currentAbility);
  const potential = draftNumber(session?.input("potential_ability"), details.potentialAbility);

  // Use the player's most familiar position. The role guide never participates in the estimate.
  const positions = [...new Set([...details.positions, ...Object.keys(details.positionRatings)])]
    .map((key) => ({
      key,
      value: draftNumber(session?.input("position." + key), details.positionRatings[key]),
    }));
  const main = positions.some(({ value }) => value === undefined)
    ? undefined
    : positions.reduce<(typeof positions)[number] | undefined>(
      (best, next) => (next.value ?? 0) > (best?.value ?? 14) ? next : best, undefined);
  const recommended = main ? estimateAbility(main.key, (key) =>
    draftNumber(session?.input("attribute." + key), details.attributes[key]?.value),
  ) : null;

  const title = "Estimativa por posição baseada em medições de versões anteriores. O FM27 pode calcular outro valor.";
  const comparison = recommended === null || current === undefined || recommended === current
    ? "equal" : recommended > current ? "higher" : "lower";
  const outOfPA = recommended !== null && potential !== undefined && potential > 0 && recommended > potential;
  const unknownPA = potential !== undefined && potential <= 0;
  const canStage = Boolean(currentInput && session && !session.busy && current !== undefined &&
    potential !== undefined && recommended !== null && recommended !== current && !outOfPA);

  const confirm = () => {
    if (!canStage || recommended === null) return;
    const note = unknownPA ? "\n\nO PA exato está indisponível." : "";
    if (window.confirm(`Adicionar CA ${recommended} ao rascunho? Use Salvar alterações para aplicar.${note}`)) {
      session?.type("current_ability", String(recommended));
    }
  };

  return (
    <div className="recommended-ability" data-comparison={comparison}>
      <div className="recommended-ability-row">
        <div>
          <strong>CA Recomendada</strong>
          <small title={title}>{recommended !== null && main ? `Estimativa · ${positionLabel(main.key)}` : "Dados insuficientes para estimar"}</small>
        </div>
        <button type="button" disabled={!canStage} onClick={confirm} title={title}
          aria-label={recommended === null ? "CA Recomendada indisponível" : `Adicionar CA Recomendada ${recommended} ao rascunho`}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 12.5h12M4 10V8m4 2V5m4 5V2.5" /></svg>
          {recommended ?? "—"}
        </button>
      </div>
      {outOfPA && <p role="status">Acima do PA atual ({potential}). Ajuste o PA ou os atributos antes de aplicar.</p>}
      {recommended !== null && unknownPA && <p role="status">PA exato indisponível.</p>}
    </div>
  );
}
