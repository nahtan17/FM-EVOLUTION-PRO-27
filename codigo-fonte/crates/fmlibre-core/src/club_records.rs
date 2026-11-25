//! Club lists adapted from the GPL-3.0 FM27 Editor reference readers.
//! The embedded build profiles, record membership and original bytes guard writes.

use std::collections::{BTreeMap, HashMap, HashSet};

use fmlibre_mem::is_user_pointer;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::club_extensions::{ClubRecordChange, number, rev};
use crate::edit::Kind;
use crate::transfer::Patch;
use crate::{ClubIndex, ClubSummary, FmDate, PlayerIndex, Session};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ClubRecordSection {
    Debts,
    Affiliations,
    Clauses,
}

impl ClubRecordSection {
    fn title(self) -> &'static str {
        match self {
            Self::Debts => "Dívida ou empréstimo",
            Self::Affiliations => "Afiliação",
            Self::Clauses => "Cláusula de transferência",
        }
    }
}

type Guards = Vec<(u64, Vec<u8>)>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClubRecords {
    pub rows: Vec<ClubRecord>,
    pub unrecognized: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClubRecord {
    pub slot: usize,
    pub revision: String,
    pub title: String,
    pub fields: Vec<RecordField>,
    #[serde(skip)]
    address: u64,
    #[serde(skip)]
    bytes: Vec<u8>,
    #[serde(skip)]
    guards: Guards,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordField {
    pub key: &'static str,
    pub label: &'static str,
    pub value: i64,
    pub format: &'static str,
    pub editable: bool,
    #[serde(skip)]
    offset: usize,
    #[serde(skip)]
    encoding: Kind,
    #[serde(skip)]
    range: (i64, i64),
    #[serde(skip)]
    mask: u8,
}

impl RecordField {
    fn encode(&self, value: i64, bytes: &mut [u8]) -> Result<(), String> {
        if !self.editable || !(self.range.0..=self.range.1).contains(&value) {
            return Err(format!("Valor indisponível ou fora do intervalo em {}.", self.label));
        }
        if self.format == "date"
            && value != 0
            && !FmDate::from_number(value).is_some_and(|date| (1901..=2300).contains(&date.year))
        {
            return Err(format!("Data inválida em {}.", self.label));
        }
        let target = &mut bytes[self.offset..self.offset + self.encoding.size()];
        if self.mask != 0 {
            target[0] = if value == 0 { target[0] & !self.mask } else { target[0] | self.mask };
        } else {
            let encoded = if self.format == "date" && value == 0 { 19_000_101 } else { value };
            target.copy_from_slice(&self.encoding.encode(encoded, target));
        }
        Ok(())
    }
}

impl ClubRecord {
    fn field(
        &mut self,
        key: &'static str,
        label: &'static str,
        offset: Option<usize>,
        encoding: Kind,
        format: &'static str,
        range: (i64, i64),
        editable: bool,
    ) {
        let Some(offset) = offset else { return };
        let Some(bytes) = self.bytes.get(offset..offset + encoding.size()) else { return };
        let value = encoding.decode(bytes);
        let editable = editable && (range.0..=range.1).contains(&value);
        self.fields.push(RecordField { key, label, value, format, editable, offset, encoding, range, mask: 0 });
    }

    fn flag(&mut self, key: &'static str, label: &'static str, offset: Option<usize>, mask: u8) {
        let Some(offset) = offset else { return };
        let Some(byte) = self.bytes.get(offset) else { return };
        self.fields.push(RecordField {
            key,
            label,
            value: i64::from(byte & mask != 0),
            format: "boolean",
            editable: true,
            offset,
            encoding: Kind::U8,
            range: (0, 1),
            mask,
        });
    }

    fn value(&self, key: &str, changes: &BTreeMap<String, i64>) -> Option<i64> {
        changes.get(key).copied().or_else(|| self.fields.iter().find(|field| field.key == key).map(|field| field.value))
    }
}

const MONEY: (i64, i64) = (0, i32::MAX as i64);
const DATE: (i64, i64) = (19_010_101, 23_001_231);
const OPTIONAL_DATE: (i64, i64) = (0, 23_001_231);
const DEBT_SOURCES: &[i64] = &[1, 2, 5, 6, 7, 8, 9, 10, 11, 12, 15];

fn offset(value: &Value, key: &str) -> Option<usize> {
    number(&value[key]).and_then(|number| usize::try_from(number).ok())
}

fn required(value: &Value, key: &str) -> Result<u64, String> {
    number(&value[key]).ok_or_else(|| format!("Campo {} indisponível no perfil do jogo.", key))
}

fn pointer(bytes: &[u8]) -> u64 {
    u64::from_le_bytes(bytes.try_into().expect("ponteiro com oito bytes"))
}

impl Session {
    fn club_record_pointer(&self, address: u64, guards: &mut Guards) -> Result<u64, String> {
        let bytes = self.process.read_bytes(address, 8).map_err(|err| err.to_string())?;
        let target = pointer(&bytes);
        guards.push((address, bytes));
        if target != 0 && !is_user_pointer(target) {
            return Err("Ponteiro da lista do clube inválido.".into());
        }
        Ok(target)
    }

    /// Reads a bounded vector of pointers and retains the vector and exact slot for each editable record.
    fn club_record_slots(
        &self,
        vector: u64,
        guards: &mut Guards,
        limit: u64,
    ) -> Result<Vec<(usize, u64, u64)>, String> {
        let bytes = self.process.read_bytes(vector, 24).map_err(|err| err.to_string())?;
        let (begin, end, capacity) = (pointer(&bytes[..8]), pointer(&bytes[8..16]), pointer(&bytes[16..]));
        guards.push((vector, bytes));
        if begin == 0 && end == 0 && capacity == 0 {
            return Ok(Vec::new());
        }
        if !is_user_pointer(begin)
            || !is_user_pointer(end)
            || !is_user_pointer(capacity)
            || end < begin
            || capacity < end
            || (end - begin) % 8 != 0
            || (capacity - begin) / 8 > limit * 8
            || (end - begin) / 8 > limit
        {
            return Err("Estrutura da lista do clube inválida.".into());
        }
        if begin == end {
            return Ok(Vec::new());
        }
        let bytes = self.process.read_bytes(begin, (end - begin) as usize).map_err(|err| err.to_string())?;
        let mut seen = HashSet::new();
        let mut slots = Vec::new();
        for (index, bytes) in bytes.chunks_exact(8).enumerate() {
            let address = pointer(bytes);
            if !is_user_pointer(address) || !seen.insert(address) {
                return Err("A lista contém um registro inválido ou duplicado.".into());
            }
            slots.push((index, begin + 8 * index as u64, address));
        }
        Ok(slots)
    }

    pub fn club_records(
        &self,
        club: &ClubSummary,
        section: ClubRecordSection,
        clubs: &ClubIndex,
        players: &PlayerIndex,
    ) -> Result<ClubRecords, String> {
        let profile = self.extra_profile(club)?;
        let profile = &profile["club"];
        let mut view = ClubRecords { rows: Vec::new(), unrecognized: 0 };
        let mut guards =
            vec![(club.address, self.process.read_bytes(club.address, 16).map_err(|err| err.to_string())?)];
        let (layout, vector, size, limit) = match section {
            ClubRecordSection::Debts => {
                let layout = &profile["financeLists"];
                let holder = self.club_record_pointer(club.address + required(layout, "debtsPointer")?, &mut guards)?;
                let vector = if holder == 0 { 0 } else { holder + required(layout, "debtsVector")? };
                (layout, vector, required(layout, "debtSize")? as usize, 512)
            }
            ClubRecordSection::Affiliations => {
                let layout = &profile["lists"];
                (
                    layout,
                    club.address + required(layout, "affiliations")?,
                    required(layout, "affiliationSize")? as usize,
                    512,
                )
            }
            ClubRecordSection::Clauses => {
                let layout = &profile["transferClauses"];
                if layout["scan"].as_bool() != Some(false) {
                    return Err("Este perfil não tem uma lista de cláusulas por clube.".into());
                }
                let vector = self.club_record_pointer(club.address + required(layout, "pointer")?, &mut guards)?;
                (layout, vector, 0, 512)
            }
        };
        if vector == 0 {
            return Ok(view);
        }
        let slots = self.club_record_slots(vector, &mut guards, limit)?;
        if slots.is_empty() {
            return Ok(view);
        }
        let names: HashMap<_, _> = if matches!(section, ClubRecordSection::Debts) {
            HashMap::new()
        } else {
            clubs.iter().map(|club| (club.address, club.name.as_str())).collect()
        };

        for (slot, pointer_slot, address) in slots {
            let clause_kind = if matches!(section, ClubRecordSection::Clauses) {
                let vtable = self.process.read_u64(address).map_err(|err| err.to_string())?;
                let kind = ["sellOnVtable", "appearanceFeeVtable", "competitionBonusVtable"]
                    .iter()
                    .position(|key| number(&layout[key]).is_some_and(|rva| self.plugin.base + rva == vtable));
                if kind.is_none() {
                    view.unrecognized += 1;
                    continue;
                }
                kind
            } else {
                None
            };
            let size = match clause_kind {
                Some(2) => 0x38,
                Some(_) => 0x28,
                None => size,
            };
            let bytes = self.process.read_bytes(address, size).map_err(|err| err.to_string())?;
            let mut row = ClubRecord {
                slot,
                revision: String::new(),
                title: section.title().to_owned(),
                fields: Vec::new(),
                address,
                bytes,
                guards: guards.clone(),
            };
            row.guards.push((pointer_slot, address.to_le_bytes().to_vec()));
            row.guards.push((address, row.bytes.clone()));
            row.revision = rev(&row.guards);
            let listed = match section {
                ClubRecordSection::Debts => {
                    debt_fields(&mut row, layout);
                    true
                }
                ClubRecordSection::Affiliations => affiliation_fields(&mut row, layout, club.address, &names),
                ClubRecordSection::Clauses => {
                    let kind = clause_kind.expect("cláusula reconhecida");
                    let expected =
                        required(layout, ["sellOnVtable", "appearanceFeeVtable", "competitionBonusVtable"][kind])?;
                    if pointer(&row.bytes[..8]) != self.plugin.base + expected {
                        return Err("A cláusula mudou durante a leitura. Atualize a lista.".into());
                    }
                    clause_fields(&mut row, kind, &names, players);
                    true
                }
            };
            if listed && !row.fields.is_empty() {
                view.rows.push(row);
            } else {
                view.unrecognized += 1;
            }
        }
        Ok(view)
    }

    pub fn change_club_record(
        &self,
        club: &ClubSummary,
        section: ClubRecordSection,
        slot: usize,
        revision: &str,
        changes: &BTreeMap<String, i64>,
        clubs: &ClubIndex,
        players: &PlayerIndex,
    ) -> Result<ClubRecordChange, String> {
        let records = self.club_records(club, section, clubs, players)?;
        let record = records
            .rows
            .into_iter()
            .find(|row| row.slot == slot && row.revision == revision)
            .ok_or("O registro mudou no jogo. Atualize a lista e selecione o registro novamente.")?;
        let mut bytes = record.bytes.clone();
        let mut edited = 0;
        for (key, value) in changes {
            let field = record
                .fields
                .iter()
                .find(|field| field.key == key)
                .ok_or_else(|| format!("Campo de edição desconhecido: {key}."))?;
            if *value != field.value {
                field.encode(*value, &mut bytes)?;
                edited += 1;
            }
        }
        if edited == 0 || bytes == record.bytes {
            return Err("Nenhuma alteração para salvar.".into());
        }
        if (changes.contains_key("start") || changes.contains_key("end"))
            && record
                .value("start", changes)
                .zip(record.value("end", changes))
                .is_some_and(|(start, end)| start != 0 && end != 0 && end < start)
        {
            return Err("A data de fim precisa ser igual ou posterior ao início.".into());
        }
        if matches!(section, ClubRecordSection::Debts) {
            if let Some(source) = changes.get("source") {
                if !DEBT_SOURCES.contains(source) {
                    return Err("Tipo de dívida sem edição disponível.".into());
                }
            }
            if (changes.contains_key("payment") || changes.contains_key("interest"))
                && record
                    .value("payment", changes)
                    .zip(record.value("interest", changes))
                    .is_some_and(|(payment, interest)| interest > payment)
            {
                return Err("Os juros incluídos na prestação não podem superar a prestação total.".into());
            }
        }
        let change = ClubRecordChange {
            club: club.uid,
            label: section.title().to_owned(),
            fields: edited,
            patches: vec![Patch { address: record.address, before: record.bytes, after: bytes }],
            guards: record.guards,
        };
        self.apply_club_record(&change).map_err(|err| err.to_string())?;
        Ok(change)
    }
}

fn debt_fields(row: &mut ClubRecord, layout: &Value) {
    let source = offset(layout, "debtSource").and_then(|at| row.bytes.get(at)).copied().unwrap_or_default();
    let pik = source == 13;
    let mapped = DEBT_SOURCES.contains(&i64::from(source));
    let editable = |key: &str| layout[key].as_bool() == Some(true);
    row.field(
        "source",
        "Tipo de dívida",
        offset(layout, "debtSource"),
        Kind::U8,
        "debtSource",
        (1, 15),
        mapped && editable("debtSourceEditable"),
    );
    row.field(
        "original",
        "Valor original",
        offset(layout, "debtOriginal"),
        Kind::I32,
        "money",
        MONEY,
        (mapped || pik) && editable("debtOriginalEditable"),
    );
    row.field(
        "payment",
        if pik { "Valor no vencimento" } else { "Prestação mensal" },
        offset(layout, "monthlyRepayment"),
        Kind::I32,
        "money",
        MONEY,
        mapped,
    );
    row.field(
        "interest",
        if pik { "Juros totais" } else { "Juros na prestação" },
        offset(layout, "monthlyInterestRepayment"),
        Kind::I32,
        "money",
        MONEY,
        mapped,
    );
    row.field(
        "start",
        "Início",
        offset(layout, "debtStart"),
        Kind::Date,
        "date",
        DATE,
        (mapped || pik) && editable("debtDatesEditable"),
    );
    row.field(
        "end",
        "Vencimento",
        offset(layout, "debtEnd"),
        Kind::Date,
        "date",
        DATE,
        (mapped || pik) && editable("debtDatesEditable"),
    );
}

fn affiliation_fields(row: &mut ClubRecord, layout: &Value, club: u64, names: &HashMap<u64, &str>) -> bool {
    let club_pointer = |key| offset(layout, key).and_then(|at| row.bytes.get(at..at + 8)).map(pointer);
    let (Some(parent), Some(feeder)) = (club_pointer("parent"), club_pointer("feeder")) else { return false };
    if parent == feeder || (club != parent && club != feeder) {
        return false;
    }
    let other = if club == parent { feeder } else { parent };
    row.title = names.get(&other).copied().unwrap_or("Clube afiliado").to_owned();
    row.field("kind", "Tipo de acordo", offset(layout, "affiliationType"), Kind::U8, "code", (0, 255), false);
    row.field("fee", "Taxa anual", offset(layout, "affiliationAnnualFee"), Kind::I32, "money", MONEY, true);
    row.field(
        "start",
        "Início",
        offset(layout, "affiliationStart"),
        Kind::Date,
        "date",
        DATE,
        layout["affiliationStartEditable"].as_bool() == Some(true),
    );
    row.field("end", "Vencimento", offset(layout, "affiliationEnd"), Kind::Date, "date", OPTIONAL_DATE, true);
    row.field(
        "friendlyChance",
        "Chance de amistoso",
        offset(layout, "affiliationFriendlyChance"),
        Kind::U8,
        "percent",
        (0, 100),
        true,
    );
    row.field(
        "parentWages",
        "Parcela salarial do clube principal",
        offset(layout, "affiliationParentWagePercent"),
        Kind::U8,
        "percent",
        (0, 100),
        true,
    );
    row.flag("friendly", "Disputar amistosos", offset(layout, "affiliationPlayFriendlies"), 0x10);
    row.flag("firstOption", "Preferência de compra", offset(layout, "affiliationFirstOption"), 0x08);
    row.flag("loans", "Emprestar jogadores", offset(layout, "affiliationPlayersOnLoan"), 0x04);
    row.flag("scouting", "Compartilhar observação", offset(layout, "affiliationScoutingShared"), 0x40);
    true
}

fn clause_fields(row: &mut ClubRecord, kind: usize, names: &HashMap<u64, &str>, players: &PlayerIndex) {
    let uid = u32::from_le_bytes(row.bytes[8..12].try_into().expect("cláusula com ID"));
    let beneficiary_offset = if kind == 2 { 0x30 } else { 0x10 };
    let beneficiary = names.get(&pointer(&row.bytes[beneficiary_offset..beneficiary_offset + 8])).copied();
    let player = players.get(uid).map(|player| player.name.clone()).unwrap_or_else(|| format!("Jogador #{uid}"));
    let title = match kind {
        0 => "Percentual de revenda",
        1 if row.bytes[0x20] == 3 => "Bônus por gols na liga",
        1 if row.bytes[0x20] == 0 => "Bônus por jogos na liga",
        1 => "Pagamento por participação",
        _ => "Bônus por competição",
    };
    row.title = format!("{player} · {title}");
    if let Some(beneficiary) = beneficiary {
        row.title.push_str(&format!(" · {beneficiary}"));
    }
    match kind {
        0 => {
            row.field("percent", "Percentual de revenda", Some(0x22), Kind::I16, "percent", (1, 100), true);
            row.field("fee", "Valor da contratação", Some(0x18), Kind::I32, "optionalMoney", (-1, MONEY.1), true);
        }
        1 => {
            row.field("amount", "Valor da cláusula", Some(0x18), Kind::I32, "money", MONEY, true);
            row.field("threshold", "Quantidade exigida", Some(0x1c), Kind::I16, "number", (1, 1000), true);
            if matches!(row.bytes[0x20], 0 | 3) {
                row.field(
                    "progress",
                    "Quantidade já cumprida",
                    Some(0x1e),
                    Kind::I16,
                    "number",
                    (0, i16::MAX as i64),
                    false,
                );
            }
        }
        _ => {
            row.field("amount", "Valor da cláusula", Some(0x28), Kind::I32, "money", MONEY, true);
            row.field(
                "competition",
                "Código da competição",
                Some(0x24),
                Kind::I32,
                "code",
                (0, i32::MAX as i64),
                false,
            );
            row.field("end", "Validade", Some(0x10), Kind::Date, "date", OPTIONAL_DATE, true);
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementPeriod {
    pub index: usize,
    pub income: BTreeMap<String, i64>,
    pub expenditure: BTreeMap<String, i64>,
}

impl Session {
    pub fn club_statements(&self, club: &ClubSummary) -> Result<Vec<StatementPeriod>, String> {
        let profile = self.extra_profile(club)?;
        let club_layout = &profile["club"];
        let layout = &club_layout["financeLists"]["statements"];
        let finance =
            self.process.read_u64(club.address + required(layout, "financePointer")?).map_err(|err| err.to_string())?;
        if finance == 0 {
            return Ok(Vec::new());
        }
        let expected = self.plugin.base + required(&club_layout["finance"], "vtable")?;
        if !is_user_pointer(finance) || self.process.read_u64(finance).ok() != Some(expected) {
            return Err("Este clube não tem um registro financeiro completo identificado.".into());
        }
        let count = required(layout, "periods")?;
        let stride = required(layout, "stride")?;
        let income_base = required(layout, "incomeBase")? as usize;
        let base = finance + required(layout, "base")?;
        if !(1..=24).contains(&count) || !(4..=1024).contains(&stride) {
            return Err("Perfil do demonstrativo financeiro inválido.".into());
        }
        let bytes = self.process.read_bytes(base, (count * stride) as usize).map_err(|err| err.to_string())?;
        let read_fields = |block: &[u8], key: &str, start: usize| -> Result<BTreeMap<String, i64>, String> {
            let fields = layout[key]
                .as_object()
                .filter(|fields| !fields.is_empty())
                .ok_or("Rubricas do demonstrativo não identificadas.")?;
            fields
                .iter()
                .map(|(key, value)| {
                    let at = start + number(value).ok_or("Rubrica inválida.")? as usize;
                    let bytes = block.get(at..at + 4).ok_or("Rubrica fora do período financeiro.")?;
                    Ok((key.clone(), Kind::I32.decode(bytes)))
                })
                .collect()
        };
        let mut periods = Vec::new();
        for (index, block) in bytes.chunks_exact(stride as usize).enumerate() {
            periods.push(StatementPeriod {
                index,
                income: read_fields(block, "income", income_base)?,
                expenditure: read_fields(block, "expenditure", 0)?,
            });
        }
        while periods
            .last()
            .is_some_and(|period| period.income.values().chain(period.expenditure.values()).all(|value| *value == 0))
        {
            periods.pop();
        }
        Ok(periods)
    }
}
