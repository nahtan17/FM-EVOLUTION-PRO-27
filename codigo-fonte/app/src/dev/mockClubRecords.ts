// Browser preview fixtures. The desktop app always uses the native commands.
import type { ClubRecord, RecordField, RecordSection } from "../ClubRecords";

const lists = new Map<string, ClubRecord[]>();
const history = new Map<number, () => void>();
let nextChange = 60_000;

function field(key: string, label: string, value: number, format: RecordField["format"], editable = true): RecordField {
  return { key, label, value, format, editable };
}

function sample(section: RecordSection): ClubRecord[] {
  switch (section) {
    case "debts":
      return [{ slot: 0, revision: "1", title: "Dívida ou empréstimo", fields: [
        field("source", "Tipo de dívida", 1, "debtSource"),
        field("original", "Valor original", 18_000_000, "money"),
        field("payment", "Prestação mensal", 325_000, "money"),
        field("interest", "Juros na prestação", 25_000, "money"),
        field("start", "Início", 20250701, "date"),
        field("end", "Vencimento", 20300630, "date"),
      ] }];
    case "affiliations":
      return [{ slot: 0, revision: "1", title: "Atlético de Vila Nova", fields: [
        field("fee", "Taxa anual", 80_000, "money"),
        field("friendly", "Disputar amistosos", 1, "boolean"),
        field("loans", "Emprestar jogadores", 0, "boolean"),
        field("scouting", "Compartilhar observação", 0, "boolean"),
        field("start", "Início", 20250701, "date"),
        field("end", "Vencimento", 20290630, "date"),
      ] }];
    case "clauses":
      return [
        { slot: 0, revision: "1", title: "Caio · Percentual de revenda · Atlético de Vila Nova", fields: [
          field("percent", "Percentual de revenda", 20, "percent"),
          field("fee", "Valor da contratação", 1_000_000, "optionalMoney"),
        ] },
        { slot: 1, revision: "1", title: "Caio · Bônus por jogos na liga · Atlético de Vila Nova", fields: [
          field("amount", "Valor da cláusula", 150_000, "money"),
          field("threshold", "Quantidade exigida", 30, "number"),
          field("progress", "Quantidade já cumprida", 17, "number", false),
        ] },
      ];
  }
}

export function mockRecordsUndo(id: number) {
  const undo = history.get(id);
  if (!undo) return undefined;
  undo();
  history.delete(id);
  return { id };
}

export function mockClubRecords(command: string, args: Record<string, unknown> = {}) {
  if (command === "club_statements") {
    return [
      { index: 0, income: { gateReceipts: 800_000, sponsorship: 1_400_000, playersSold: 500_000 },
        expenditure: { playerWages: 1_600_000, staffWages: 200_000, transferExpenditure: 750_000 } },
      { index: 1, income: { gateReceipts: 460_000, sponsorship: 1_500_000 },
        expenditure: { playerWages: 1_580_000, staffWages: 199_000, loanRepayment: 350_000 } },
    ];
  }
  const section = args.section as RecordSection;
  const key = `${args.club}:${section}`;
  let rows = lists.get(key);
  if (!rows) {
    rows = sample(section);
    lists.set(key, rows);
  }
  if (command === "club_records") return { rows: structuredClone(rows), unrecognized: 0 };
  const index = rows.findIndex((row) => row.slot === args.slot && row.revision === args.revision);
  if (index < 0) throw new Error("O registro mudou no jogo. Atualize a lista e selecione o registro novamente.");
  const row = rows[index];
  const values = args.values as Record<string, number>;
  const fields = row.fields.map((field) => values[field.key] === undefined ? field : { ...field, value: values[field.key] });
  const replacement = { ...row, revision: String(Number(row.revision) + 1), fields };
  rows[index] = replacement;
  const change = nextChange++;
  history.set(change, () => { rows[index] = row; });
  return { change };
}
