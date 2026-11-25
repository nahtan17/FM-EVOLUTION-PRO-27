import { useState } from "react";
import { useEditSession } from "./useProfileEditing";

interface Recipe {
  id: string;
  label: string;
  description: string;
  fields: Record<string, string>;
}

const PLAYER_RECIPES: readonly Recipe[] = [
  {
    id: "wonderkid",
    label: "Tornar prodígio",
    description: "PA 200, Determinação 20, Ambição 20 e Profissionalismo 20.",
    fields: {
      potential_ability: "200",
      "attribute.determination": "20",
      "personality.ambition": "20",
      "personality.professionalism": "20",
    },
  },
  {
    id: "injury-proof",
    label: "À prova de lesões",
    description: "Aptidão física natural 20 e Propensão a lesões 1.",
    fields: {
      "attribute.natural_fitness": "20",
      "attribute.injury_proneness": "1",
    },
  },
  {
    id: "extend-career",
    label: "Estender carreira",
    description: "Aptidão física natural 20, Resistência 18 e Profissionalismo 20.",
    fields: {
      "attribute.natural_fitness": "20",
      "attribute.stamina": "18",
      "personality.professionalism": "20",
    },
  },
];

const CLUB_RECIPES: readonly Recipe[] = [
  {
    id: "rich-club",
    label: "Clube rico",
    description: "Saldo 500M, orçamento de transferências 500M e orçamento salarial 20M.",
    fields: {
      "finance.balance": "500000000",
      "finance.transfer_budget": "500000000",
      "finance.wage_budget": "20000000",
      "finance.total_wage_budget": "50000000",
    },
  },
  {
    id: "top-facilities",
    label: "Infraestrutura máxima",
    description: "Instalações de treino, base, formação, recrutamento e corporativas em 20.",
    fields: {
      "facilities.training": "20",
      "facilities.youth_facilities": "20",
      "facilities.youth_coaching": "20",
      "facilities.youth_recruitment": "20",
      "facilities.corporate": "20",
    },
  },
];

export function QuickRecipes({ entity }: { entity: "player" | "club" }) {
  const session = useEditSession();
  const [notice, setNotice] = useState("");
  if (!session) return null;

  const recipes = entity === "player" ? PLAYER_RECIPES : CLUB_RECIPES;
  const applyRecipe = (recipe: Recipe) => {
    let staged = 0;
    for (const [key, value] of Object.entries(recipe.fields)) {
      if (!session.has(key)) continue;
      session.type(key, value);
      staged += 1;
    }
    setNotice(
      staged > 0
        ? `${recipe.label}: ${staged} campos adicionados ao rascunho. Use Salvar alterações para aplicar.`
        : `${recipe.label}: nenhum campo editável disponível nesta ficha.`,
    );
  };

  return (
    <section className="profile-group quick-recipes" aria-label="Receitas rápidas">
      <div className="quick-recipes-row">
        <span className="quick-recipes-title">Receitas rápidas</span>
        <div className="quick-recipes-buttons">
          {recipes.map((recipe) => (
            <button
              key={recipe.id}
              type="button"
              disabled={session.busy}
              title={recipe.description}
              onClick={() => applyRecipe(recipe)}
            >
              {recipe.label}
            </button>
          ))}
        </div>
      </div>
      {notice && (
        <p className="note" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
