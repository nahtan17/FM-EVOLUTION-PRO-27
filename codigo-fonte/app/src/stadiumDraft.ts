import type { Pending } from "./editDraft";
import { dimensions } from "./stadiumFields";
import type { FieldValues } from "./types";

const capacity = "stadium.capacity";
const seating = "stadium.seating";

function consistent(values: FieldValues, affected: string) {
  if (affected === capacity || affected === seating) {
    return values[seating] === undefined || values[capacity] === undefined || values[seating] <= values[capacity];
  }
  const axis = dimensions.find(keys => keys.some(key => `stadium.${key}` === affected));
  if (!axis) return true;
  const [min, actual, max] = axis.map(key => values[`stadium.${key}`]);
  return (min === undefined || max === undefined || min <= max)
    && (actual === undefined || min === undefined || actual >= min)
    && (actual === undefined || max === undefined || actual <= max);
}

/** Save reductions first where possible, then write each field while its related limits still hold. */
export function orderStadiumEdits(changes: readonly Pending[], start: FieldValues): Pending[] {
  const other = changes.filter(change => !change.edit.field.startsWith("stadium."));
  const remaining = changes.filter(change => change.edit.field.startsWith("stadium."))
    .sort((a, b) => Number(a.edit.value > a.wasStored) - Number(b.edit.value > b.wasStored));
  const result = { ...start, ...Object.fromEntries(remaining.map(({ edit }) => [edit.field, edit.value])) };

  for (const { edit } of remaining) {
    if (!consistent(result, edit.field)) {
      throw Error(edit.field === capacity || edit.field === seating
        ? "A capacidade sentada deve ser igual ou inferior à capacidade total."
        : "As dimensões atuais do gramado devem ficar entre as dimensões mínimas e máximas.");
    }
  }
  const standsTotal = Object.entries(result).reduce((sum, [field, value]) =>
    sum + (/^stadium\.stand\.\d+\.capacity$/.test(field) ? value : 0), 0);
  if (standsTotal > 300_000) throw Error("A soma das capacidades das arquibancadas deve ser de até 300.000.");

  const current = { ...start };
  const ordered: Pending[] = [];
  while (remaining.length) {
    const index = remaining.findIndex(({ edit }) => consistent({ ...current, [edit.field]: edit.value }, edit.field));
    if (index < 0) throw Error("Revise as capacidades e dimensões. Os valores atuais do estádio estão inconsistentes.");
    const [change] = remaining.splice(index, 1);
    current[change.edit.field] = change.edit.value;
    ordered.push(change);
  }
  return [...other, ...ordered];
}
