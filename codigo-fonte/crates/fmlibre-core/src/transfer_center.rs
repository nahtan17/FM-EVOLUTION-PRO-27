//! Existing bids and future contracts. No acceptance/state, team pointer or allocation is fabricated here.
use crate::edit::Kind;
use crate::rtti;
use crate::transfer::{MoveError, Patch, PointerList};
use crate::{ClubIndex, ClubSummary, FmDate, PlayerIndex, Session};
use fmlibre_deals::{Capabilities, Edit, Installment, Values, decode_installments, editable_schedule, negotiating};
use fmlibre_mem::is_user_pointer;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferDeal {
    pub id: String,
    pub revision: String,
    pub number: u32,
    pub player: u32,
    pub name: String,
    pub from_club: Option<u32>,
    pub from: String,
    pub to_club: u32,
    pub to: String,
    pub state: u8,
    pub kind: u8,
    pub loan: bool,
    pub modality: &'static str,
    pub contract_start: Option<i64>,
    pub reference_day: Option<i64>,
    pub fee_note: &'static str,
    pub date_note: &'static str,
    pub values: Values,
    pub capabilities: Capabilities,
    pub note: String,
    pub installments: usize,
    pub installment_details: Option<Vec<Installment>>,
    pub evidence: TransferEvidence,
    #[serde(skip)]
    snapshot: Snapshot,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferEvidence {
    game: String,
    identified_teams: bool,
    open_offers_with_number: usize,
    linked_contracts: usize,
    contract_class: Option<&'static str>,
    schedules_with_number: usize,
    writes_available: bool,
    proposed_day: Option<i64>,
}

#[derive(Debug, Clone, Default)]
struct Snapshot {
    offer: u64,
    contract: Option<u64>,
    due: Option<u64>,
    mirrors: Vec<u64>,
    guards: Vec<(u64, Vec<u8>)>,
}

#[derive(Debug, Clone)]
pub struct TransferDealPlan {
    pub before: TransferDeal,
    pub after: Values,
    pub fields: usize,
    patches: Vec<Patch>,
    moves_contract_start: bool,
}
impl TransferDealPlan {
    pub fn updated_deal(&self) -> TransferDeal {
        let mut row = self.before.clone();
        let changes = self.patches.iter().map(|patch| (patch.address, patch.after.clone())).collect::<Vec<_>>();
        for (address, before) in &mut row.snapshot.guards {
            *before = fmlibre_deals::expected_after(*address, before, &changes);
        }
        row.revision = revision(&row.snapshot.guards);
        row.values = self.after.clone();
        if self.moves_contract_start {
            row.contract_start = row.values.move_day;
        }
        row
    }
}

fn word(bytes: &[u8], at: u64) -> u64 {
    u64::from_le_bytes(bytes[at as usize..at as usize + 8].try_into().unwrap())
}
fn half(bytes: &[u8], at: u64) -> u32 {
    u32::from_le_bytes(bytes[at as usize..at as usize + 4].try_into().unwrap())
}
fn day(bytes: &[u8], at: u64) -> Option<i64> {
    let v = &bytes[at as usize..at as usize + 4];
    FmDate::from_raw(u16::from_le_bytes([v[0], v[1]]), u16::from_le_bytes([v[2], v[3]])).map(|d| d.to_number())
}
fn revision(guards: &[(u64, Vec<u8>)]) -> String {
    let mut h = 0xcbf29ce484222325u64;
    for (address, bytes) in guards {
        for byte in address.to_le_bytes().iter().chain(bytes) {
            h = (h ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        }
    }
    format!("{h:016x}")
}

struct ScheduledMove {
    address: u64,
    bytes: Vec<u8>,
    guards: Vec<(u64, Vec<u8>)>,
}

impl Session {
    fn documented_installments(&self, payment: u64, state: u8) -> Option<Vec<Installment>> {
        // docs/recon/fm27-transfer-offers.md records these two Windows builds and this existing list only.
        let observed = self.game.steam_build.as_deref() == Some("26340721")
            || self.game.package_version.as_deref() == Some("0.9.2435.0");
        if !cfg!(windows)
            || !observed
            || self.profile.is_none()
            || !(negotiating(state) || state == 19)
            || !is_user_pointer(payment)
        {
            return None;
        }
        let header = self.process.read_bytes(payment, 24).ok()?;
        if header.iter().all(|&byte| byte == 0) {
            return Some(Vec::new());
        }
        let (begin, end, cap) = (word(&header, 0), word(&header, 8), word(&header, 16));
        if !is_user_pointer(begin)
            || !(begin <= end && end <= cap)
            || cap - begin > 12 * 128
            || !(end - begin).is_multiple_of(12)
            || !(cap - begin).is_multiple_of(12)
        {
            return None;
        }
        let bytes = if end > begin { self.process.read_bytes(begin, (end - begin) as usize).ok()? } else { Vec::new() };
        self.expect(payment, &header).ok()?;
        decode_installments(&bytes)
    }

    fn scheduled_moves(
        &self,
        t: &crate::profile::TransfersLayout,
        manager: u64,
    ) -> HashMap<(u64, u32), Vec<ScheduledMove>> {
        let root = t.future_root_rva.zip(t.future_root_due).and_then(|(rva, due)| {
            let slot = self.plugin.base + rva;
            let pointer = self.process.read_u64(slot).ok().filter(|&pointer| is_user_pointer(pointer))?;
            Some((pointer + due, (slot, pointer.to_le_bytes().to_vec())))
        });
        let headers =
            std::iter::once((manager + t.due, None)).chain(root.into_iter().map(|(at, guard)| (at, Some(guard))));
        let mut moves = HashMap::<(u64, u32), Vec<ScheduledMove>>::new();
        let mut headers_read = HashSet::new();
        for (header_at, root_guard) in headers {
            if !headers_read.insert(header_at) {
                continue;
            }
            let Ok(header) = self.process.read_bytes(header_at, 24) else { continue };
            let Ok(list) = self.manager_list(header_at) else { continue };
            let Ok(addresses) = list.elements(&self.process) else { continue };
            if self.expect(header_at, &header).is_err() {
                continue;
            }
            for (index, address) in addresses.into_iter().enumerate() {
                if !is_user_pointer(address) {
                    continue;
                }
                let Ok(bytes) = self.process.read_bytes(address, t.due_size as usize) else { continue };
                let key = (word(&bytes, t.due_person), half(&bytes, t.due_number));
                let records = moves.entry(key).or_default();
                // The manager and the alternate view can point to the same scheduled move.
                if records.iter().any(|record| record.address == address) {
                    continue;
                }
                let slot = word(&header, 0) + index as u64 * 8;
                let mut guards = vec![(header_at, header.clone()), (slot, address.to_le_bytes().to_vec())];
                guards.extend(root_guard.clone());
                records.push(ScheduledMove { address, bytes, guards });
            }
        }
        moves
    }

    pub fn club_transfer_center(
        &self,
        club: &ClubSummary,
        players: &PlayerIndex,
        clubs: &ClubIndex,
    ) -> Result<Vec<TransferDeal>, MoveError> {
        if self.save_changed() {
            return Err(MoveError::Changed { address: 0 });
        }
        let t = self.layout.transfers.as_ref().ok_or(MoveError::NoTransfers)?;
        let manager = self.transfer_manager(t)?;
        let writable = self.process.can_write() && self.structure_lock().is_none();
        let today = self.game_date().map(FmDate::to_number);
        let offer_header = self.process.read_bytes(manager + t.offers, 24)?;
        let list = self.manager_list(manager + t.offers)?;
        let offers = list.elements(&self.process)?;
        self.expect(manager + t.offers, &offer_header)?;
        let vtables: HashSet<_> = rtti::vtables(&self.process, &self.plugin, &t.offer_class).into_iter().collect();
        let full: HashSet<_> = rtti::vtables(&self.process, &self.plugin, "db::FULL_CONTRACT").into_iter().collect();
        let loan_tables: HashSet<_> =
            rtti::vtables(&self.process, &self.plugin, "db::LOAN_CONTRACT").into_iter().collect();
        if vtables.is_empty() {
            return Err(MoveError::NoTransfers);
        }
        let p = &self.layout.player;
        let c = &self.layout.contract;
        let people: HashMap<_, _> = players.iter().map(|v| (v.address + p.at(p.identity(), v.shift), v)).collect();
        let club_map: HashMap<_, _> = clubs.iter().map(|v| (v.address, v)).collect();
        let team_club = |team: u64| {
            if !is_user_pointer(team) {
                return None;
            }
            let address = self.process.read_u64(team + self.layout.team.club).ok()?;
            let summary = club_map.get(&address).copied()?;
            (self.process.read_u32(address + self.layout.club.uid).ok()? == summary.uid).then_some(summary)
        };
        let dues = self.scheduled_moves(t, manager);
        let mut number_uses = HashMap::<(u64, u32), usize>::new();
        let records: Vec<_> = offers
            .into_iter()
            .enumerate()
            .filter_map(|(index, address)| {
                if !is_user_pointer(address) {
                    return None;
                }
                let bytes = self.process.read_bytes(address, t.offer_size as usize).ok()?;
                if !vtables.contains(&word(&bytes, 0)) {
                    return None;
                }
                let state = bytes[t.offer_state as usize];
                if negotiating(state) || state == 19 {
                    let key = (word(&bytes, t.offer_person), half(&bytes, t.offer_number));
                    *number_uses.entry(key).or_default() += 1;
                }
                Some((index, address, bytes))
            })
            .collect();
        self.expect(manager + t.offers, &offer_header)?;
        let mut out = Vec::new();
        for (index, address, bytes) in records {
            let person = word(&bytes, t.offer_person);
            let Some(player) = people.get(&person) else { continue };
            let player_uid = player.address + p.at(p.uid, player.shift);
            if self.process.read_u32(player_uid).ok() != Some(player.uid) {
                continue;
            }
            let buyer = word(&bytes, t.offer_buyer);
            let seller = word(&bytes, t.offer_seller);
            let Some(to) = team_club(buyer) else { continue };
            let from = if seller == 0 { None } else { team_club(seller) };
            if to.uid != club.uid && from.is_none_or(|v| v.uid != club.uid) {
                continue;
            }
            let state = bytes[t.offer_state as usize];
            let kind = bytes[t.offer_kind as usize];
            let number = half(&bytes, t.offer_number);
            let count = half(&bytes, t.offer_count);
            let number_uses = number_uses.get(&(person, number)).copied().unwrap_or(0);
            let reused_number = number_uses > 1;
            let mut snapshot = Snapshot { offer: address, ..Default::default() };
            snapshot.guards.push((address, bytes.clone()));
            snapshot.guards.push((player_uid, player.uid.to_le_bytes().to_vec()));
            for (team, club) in [(buyer, Some(to)), (seller, from)] {
                if let Some(club) = club {
                    snapshot.guards.push((team + self.layout.team.club, club.address.to_le_bytes().to_vec()));
                    snapshot.guards.push((club.address + self.layout.club.uid, club.uid.to_le_bytes().to_vec()));
                }
            }
            snapshot.guards.push((manager, self.process.read_bytes(manager, 8)?));
            snapshot.guards.push((manager + t.offers, offer_header.clone()));
            snapshot.guards.push((word(&offer_header, 0) + index as u64 * 8, address.to_le_bytes().to_vec()));

            let offer_day = day(&bytes, t.offer_move_day);
            let scheduled = dues.get(&(person, number)).and_then(|records| match records.as_slice() {
                [record] if state == 19 && !reused_number => Some(record),
                _ => None,
            });
            let scheduled_day = scheduled.and_then(|record| day(&record.bytes, t.due_day));
            let mut values = Values {
                fee: i64::from(half(&bytes, t.offer_fee)),
                move_day: if state == 20 { day(&bytes, t.offer_moved) } else { scheduled_day },
                ..Default::default()
            };
            if let Some(record) = scheduled {
                snapshot.due = Some(record.address);
                snapshot.guards.extend(record.guards.iter().cloned());
                snapshot.guards.push((record.address, record.bytes.clone()));
                if scheduled_day.is_some() && offer_day == scheduled_day {
                    snapshot.mirrors.push(address + t.offer_move_day);
                }
            }
            let mut contracts = Vec::new();
            let entries_at = player.address + p.at(t.player_entries, player.shift);
            let entries = (|| {
                let record = self.process.read_u64(entries_at).ok()?;
                let header = self.process.read_bytes(record, 24).ok()?;
                let entries = PointerList::read_up_to(&self.process, record, 512).ok()??;
                let members = entries.elements(&self.process).ok()?;
                self.expect(record, &header).ok()?;
                Some((record, header, members))
            })();
            if let Some((record, header, members)) = entries {
                snapshot.guards.push((entries_at, record.to_le_bytes().to_vec()));
                let begin = word(&header, 0);
                snapshot.guards.push((record, header));
                for (index, entry) in members.into_iter().enumerate() {
                    if !is_user_pointer(entry) {
                        continue;
                    }
                    let Ok(entry_bytes) = self.process.read_bytes(entry, t.entry_size as usize) else { continue };
                    if half(&entry_bytes, t.entry_one) != 1
                        || entry_bytes[t.entry_one_again as usize] != 1
                        || half(&entry_bytes, t.entry_number) != number
                    {
                        continue;
                    }
                    let contract = word(&entry_bytes, t.entry_contract);
                    if !is_user_pointer(contract) {
                        continue;
                    }
                    let Some(size) = c.size else { continue };
                    let Ok(contract_bytes) = self.process.read_bytes(contract, size as usize) else { continue };
                    if word(&contract_bytes, c.owner) != person || word(&contract_bytes, c.team) != buyer {
                        continue;
                    }
                    let valid = matches!((state, entry_bytes[t.entry_state as usize]), (8, 1) | (19, 2));
                    if valid
                        && (full.contains(&word(&contract_bytes, 0)) || loan_tables.contains(&word(&contract_bytes, 0)))
                    {
                        contracts.push((entry, entry_bytes, contract, contract_bytes, begin + index as u64 * 8));
                    }
                }
            }
            // Kind 1 alone is ambiguous. The matched contract's class distinguishes a loan from a permanent move.
            let mut loan = false;
            let mut contract_start = None;
            let linked_contracts = contracts.len();
            let ambiguous_contract = linked_contracts > 1 || reused_number;
            let mut contract_valid = false;
            if linked_contracts == 1 && !reused_number {
                let (entry, entry_bytes, contract, contract_bytes, slot) = contracts.remove(0);
                loan = loan_tables.contains(&word(&contract_bytes, 0));
                contract_valid = full.contains(&word(&contract_bytes, 0));
                values.wage = Some(i64::from(half(&contract_bytes, c.wage) as i32));
                values.expires = day(&contract_bytes, c.expires);
                contract_start = day(&contract_bytes, c.signed);
                values.contract_type =
                    if contract_valid { c.contract_type.map(|at| contract_bytes[at as usize]) } else { None };
                snapshot.contract = Some(contract);
                snapshot.guards.push((slot, entry.to_le_bytes().to_vec()));
                snapshot.guards.push((entry, entry_bytes));
                snapshot.guards.push((contract, contract_bytes.clone()));
                if contract_valid && scheduled_day.is_some() {
                    for offset in [c.signed, c.joined] {
                        if day(&contract_bytes, offset) == scheduled_day
                            && !snapshot.mirrors.contains(&(contract + offset))
                        {
                            snapshot.mirrors.push(contract + offset);
                        }
                    }
                }
            }
            let payment = word(&bytes, t.offer_payment);
            let mut installments = 0;
            if is_user_pointer(payment) {
                if let Ok(header) = self.process.read_bytes(payment, 24) {
                    let (begin, end, cap) = (word(&header, 0), word(&header, 8), word(&header, 16));
                    if end >= begin && cap >= end && (end - begin) % 12 == 0 && (end - begin) / 12 <= 128 {
                        installments = ((end - begin) / 12) as usize;
                    }
                }
            }
            let installment_details = self.documented_installments(payment, state);
            let date_valid = editable_schedule(state, scheduled_day, today);
            let early = negotiating(state);
            let active = early || date_valid;
            let identified = buyer != seller
                && (seller == 0 || from.is_some_and(|club| club.uid != to.uid))
                && !ambiguous_contract
                && !loan;
            // The FULL_TRANSFER_OFFER class was checked above. Its cash field exists before the
            // offered contract exists, including paid offers whose internal kind byte is 1.
            let paid = identified && from.is_some() && matches!(kind, 1 | 2);
            let old_contract_gate = half(&bytes, t.offer_one) == 1
                && buyer == word(&bytes, t.offer_buyer_again)
                && (kind == 2 || contract_valid);
            let contract =
                snapshot.contract.filter(|_| writable && active && identified && contract_valid && old_contract_gate);
            let capabilities = Capabilities {
                fee: writable && active && paid && values.fee >= 0 && self.heap_writable(address + t.offer_fee, 4),
                contract: contract
                    .is_some_and(|ptr| self.heap_writable(ptr + c.wage, 4) && self.heap_writable(ptr + c.expires, 4)),
                date: writable
                    && identified
                    && (paid || contract.is_some())
                    && date_valid
                    && snapshot.due.is_some_and(|due| self.heap_writable(due + t.due_day, 4))
                    && snapshot.mirrors.iter().all(|&at| self.heap_writable(at, 4)),
                kind: contract.zip(c.contract_type).is_some_and(|(ptr, at)| self.heap_writable(ptr + at, 1)),
            };
            let modality = if loan {
                "Empréstimo"
            } else if kind == 8 && seller == 0 && values.fee == 0 && payment == 0 && !ambiguous_contract {
                "Transferência gratuita"
            } else if date_valid && identified {
                "Transferência futura"
            } else if paid && (kind == 2 || contract_valid) {
                "Transferência definitiva"
            } else if paid {
                "Proposta entre clubes"
            } else {
                "Modalidade não confirmada"
            };
            let note = if reused_number {
                "Há propostas abertas com o mesmo número e jogador. O vínculo com contrato ou agendamento ficou ambíguo."
            } else if !writable {
                "A conexão ou as verificações desta versão do jogo não permitem gravar propostas."
            } else if loan {
                "Contrato de empréstimo identificado. A gravação desta modalidade ainda não foi validada."
            } else if ambiguous_contract {
                "Mais de um contrato corresponde à proposta. A gravação requer um vínculo único."
            } else if early && capabilities.fee {
                "O valor à vista pode ser editado durante a negociação. A data fica disponível quando o FM confirma e agenda a transferência."
            } else if state == 19 && scheduled_day.is_none() {
                "O FM não retornou um agendamento único para esta proposta. Atualize a lista depois de conferir a transferência no jogo."
            } else if !active {
                "Proposta fora de negociação ou com data já alcançada. Somente leitura."
            } else if capabilities.date {
                "Agendamento identificado. Confira a nova data antes de aplicar."
            } else if capabilities.fee || capabilities.contract || capabilities.kind {
                "Os campos disponíveis podem ser editados. O agendamento permanece somente para leitura."
            } else {
                "Nenhum campo desta proposta está validado para gravação."
            };
            let fee_note = if reused_number {
                "Número reutilizado em mais de uma proposta aberta para este jogador."
            } else if capabilities.fee {
                "Parcela à vista disponível para edição."
            } else if !writable {
                "Conexão sem gravação disponível para propostas."
            } else if loan {
                "Edição do valor de empréstimo não validada."
            } else if !active {
                "Proposta fora de uma etapa editável."
            } else if !identified {
                "Vínculo entre jogador, clubes e proposta não confirmado."
            } else if !paid {
                "Parcela à vista desta modalidade não validada."
            } else {
                "O valor lido ou o campo de gravação está fora da faixa validada."
            };
            let date_note = if reused_number {
                "O número da proposta não identifica um agendamento único."
            } else if capabilities.date {
                "Data prevista do agendamento confirmado pelo FM."
            } else if early {
                "O FM ainda não confirmou e agendou esta transferência."
            } else if state == 19 && scheduled_day.is_none() {
                "Confirmação encontrada, mas sem registro único de agendamento."
            } else if state == 19 && !date_valid {
                "O dia agendado foi alcançado ou a data atual do FM está indisponível."
            } else if state == 20 {
                "Data de uma transferência concluída."
            } else {
                "O vínculo ou os campos necessários para reagendar não foram validados."
            };
            let token = revision(&snapshot.guards);
            out.push(TransferDeal {
                id: format!("{}-{number}-{count}", player.uid),
                revision: token,
                number,
                player: player.uid,
                name: player.name.clone(),
                from_club: from.map(|v| v.uid),
                from: from.map(|v| v.name.clone()).unwrap_or_else(|| "Sem clube".into()),
                to_club: to.uid,
                to: to.name.clone(),
                state,
                kind,
                loan,
                modality,
                contract_start,
                reference_day: day(&bytes, t.offer_made),
                fee_note,
                date_note,
                values,
                capabilities,
                note: note.into(),
                installments,
                installment_details,
                evidence: TransferEvidence {
                    game: self.game.name(),
                    identified_teams: buyer != seller && (seller == 0 || from.is_some_and(|club| club.uid != to.uid)),
                    open_offers_with_number: number_uses,
                    linked_contracts,
                    contract_class: if loan {
                        Some("Empréstimo")
                    } else if contract_valid {
                        Some("Definitivo")
                    } else {
                        None
                    },
                    schedules_with_number: dues.get(&(person, number)).map_or(0, Vec::len),
                    writes_available: writable,
                    proposed_day: offer_day,
                },
                snapshot,
            });
        }
        let mut repetitions = HashMap::<String, usize>::new();
        for row in &out {
            *repetitions.entry(row.id.clone()).or_default() += 1;
        }
        for row in &mut out {
            if repetitions[&row.id] > 1 {
                row.capabilities = Capabilities::default();
                row.note = "Mais de um registro corresponde ao mesmo identificador. Atualize a lista no FM.".into();
                row.fee_note = "Identificador de proposta repetido.";
                row.date_note = row.fee_note;
            }
        }
        out.sort_by_key(|v| (std::cmp::Reverse(v.number), v.player));
        Ok(out)
    }

    /// Whether this player has an outstanding or agreed contract entry tied to a real contract.
    pub fn has_pending_contract(&self, player: &crate::PlayerSummary) -> Result<bool, MoveError> {
        let t = self.layout.transfers.as_ref().ok_or(MoveError::NoTransfers)?;
        let p = &self.layout.player;
        let c = &self.layout.contract;
        let target = player.target();
        let person = target.address + p.at(p.identity(), target.shift);
        let uid = target.address + p.at(p.uid, target.shift);
        if self.process.read_u32(uid)? != target.uid {
            return Err(MoveError::Moved { uid: target.uid });
        }
        let slot = target.address + p.at(t.player_entries, target.shift);
        let record = self.process.read_u64(slot)?;
        if record == 0 {
            return Ok(false);
        }
        if !is_user_pointer(record) {
            return Err(MoveError::UnusualContract);
        }
        let header = self.process.read_bytes(record, 24)?;
        let members = match PointerList::read_up_to(&self.process, record, 512)? {
            Some(list) => list.elements(&self.process)?,
            None if header.iter().all(|&byte| byte == 0) => Vec::new(),
            None => return Err(MoveError::UnusualContract),
        };
        self.expect(record, &header)?;
        self.expect(slot, &record.to_le_bytes())?;
        for entry in members {
            if !is_user_pointer(entry) {
                return Err(MoveError::UnusualContract);
            }
            let bytes = self.process.read_bytes(entry, t.entry_size as usize)?;
            if half(&bytes, t.entry_one) != 1 || bytes[t.entry_one_again as usize] != 1 {
                return Err(MoveError::UnusualContract);
            }
            let contract = word(&bytes, t.entry_contract);
            if matches!(bytes[t.entry_state as usize], 1 | 2) && contract != 0 {
                if !is_user_pointer(contract) || self.process.read_u64(contract + c.owner)? != person {
                    return Err(MoveError::UnusualContract);
                }
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub fn plan_transfer_deal(&self, row: TransferDeal, edit: &Edit) -> Result<TransferDealPlan, String> {
        let today = self.game_date().map_or(0, FmDate::to_number);
        let after = fmlibre_deals::validate(&row.values, edit, row.capabilities, today)?;
        let t = self.layout.transfers.as_ref().ok_or("Leitura de transferências indisponível.")?;
        let c = &self.layout.contract;
        let mut patches = Vec::new();
        // Identity and state guards remain part of undo, so a completed/recycled offer is never restored.
        for (at, size) in [
            (t.offer_person, 8),
            (t.offer_number, 4),
            (t.offer_count, 4),
            (t.offer_state, 1),
            (t.offer_buyer, 8),
            (t.offer_seller, 8),
        ] {
            let bytes = self.process.read_bytes(row.snapshot.offer + at, size).map_err(|e| e.to_string())?;
            patches.push(Patch { address: row.snapshot.offer + at, before: bytes.clone(), after: bytes });
        }
        let mut add = |address: u64, new: Vec<u8>| -> Result<(), String> {
            let before = self.process.read_bytes(address, new.len()).map_err(|e| e.to_string())?;
            if before != new {
                patches.push(Patch { address, before, after: new })
            }
            Ok(())
        };
        let mut fields = 0;
        if after.fee != row.values.fee {
            add(row.snapshot.offer + t.offer_fee, (after.fee as u32).to_le_bytes().to_vec())?;
            fields += 1;
        }
        if let Some(contract) = row.snapshot.contract {
            if after.wage != row.values.wage {
                add(contract + c.wage, (after.wage.unwrap() as i32).to_le_bytes().to_vec())?;
                fields += 1;
            }
            if after.expires != row.values.expires {
                let old = self.process.read_bytes(contract + c.expires, 4).map_err(|e| e.to_string())?;
                add(contract + c.expires, Kind::Date.encode(after.expires.unwrap(), &old))?;
                fields += 1;
            }
            if after.contract_type != row.values.contract_type {
                add(contract + c.contract_type.unwrap(), vec![after.contract_type.unwrap()])?;
                fields += 1;
            }
        }
        if after.move_day != row.values.move_day {
            let new = after.move_day.ok_or("Nova data ausente.")?;
            let due = row.snapshot.due.ok_or("Agendamento ausente.")?;
            for address in std::iter::once(due + t.due_day).chain(row.snapshot.mirrors.iter().copied()) {
                let old = self.process.read_bytes(address, 4).map_err(|e| e.to_string())?;
                add(address, Kind::Date.encode(new, &old))?;
            }
            fields += 1;
        }
        let moves_contract_start = after.move_day != row.values.move_day
            && row.snapshot.contract.is_some_and(|contract| row.snapshot.mirrors.contains(&(contract + c.signed)));
        let contract_start = if moves_contract_start { after.move_day } else { row.contract_start };
        if (after.expires != row.values.expires || moves_contract_start)
            && after.expires.zip(contract_start).is_some_and(|(expires, start)| expires <= start)
        {
            return Err("O contrato precisa terminar depois do seu início.".into());
        }
        Ok(TransferDealPlan { before: row, after, fields, patches, moves_contract_start })
    }
    pub fn apply_transfer_deal(&self, plan: &TransferDealPlan) -> Result<(), MoveError> {
        if self.save_changed()
            || (plan.before.state == 19
                && self.game_date().is_none_or(|today| {
                    [plan.before.values.move_day, plan.after.move_day]
                        .into_iter()
                        .flatten()
                        .any(|day| day <= today.to_number())
                }))
        {
            return Err(MoveError::Changed { address: plan.before.snapshot.offer });
        }
        for (address, bytes) in &plan.before.snapshot.guards {
            self.expect(*address, bytes)?;
        }
        self.apply_patches(&plan.patches)
    }
    pub fn undo_transfer_deal(&self, plan: &TransferDealPlan) -> Result<(), MoveError> {
        if let Some(lock) = self.structure_lock() {
            return Err(MoveError::Locked(lock));
        }
        if plan.before.state == 19
            && self.game_date().is_none_or(|today| {
                [plan.before.values.move_day, plan.after.move_day]
                    .into_iter()
                    .flatten()
                    .any(|day| day <= today.to_number())
            })
        {
            return Err(MoveError::Changed { address: plan.before.snapshot.offer });
        }
        let changes = plan.patches.iter().map(|p| (p.address, p.after.clone())).collect::<Vec<_>>();
        for (address, before) in &plan.before.snapshot.guards {
            self.expect(*address, &fmlibre_deals::expected_after(*address, before, &changes))?;
        }
        self.undo_patches(&plan.patches)
    }
}
