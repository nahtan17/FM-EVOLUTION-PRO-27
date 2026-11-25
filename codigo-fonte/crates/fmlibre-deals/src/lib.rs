//! Portable validation shared by the native transfer editor and its offline tests.
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Values {
    pub fee: i64,
    pub move_day: Option<i64>,
    pub wage: Option<i64>,
    pub expires: Option<i64>,
    pub contract_type: Option<u8>,
}
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Edit {
    pub fee: Option<i64>,
    pub move_day: Option<i64>,
    pub wage: Option<i64>,
    pub expires: Option<i64>,
    pub contract_type: Option<u8>,
}
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub fee: bool,
    pub contract: bool,
    pub date: bool,
    pub kind: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installment {
    pub amount: u32,
    pub months: u8,
    pub interval_months: u8,
}

/// Decode the documented twelve-byte entries of an open offer's installment list.
pub fn decode_installments(bytes: &[u8]) -> Option<Vec<Installment>> {
    if !bytes.len().is_multiple_of(12) || bytes.len() > 128 * 12 {
        return None;
    }
    bytes
        .chunks_exact(12)
        .map(|entry| {
            let amount = u32::from_le_bytes(entry[..4].try_into().ok()?);
            let (months, mark, interval) = (entry[4], entry[5], entry[8]);
            (amount > 0
                && mark <= 1
                && matches!(interval, 6 | 12)
                && months >= interval
                && months.is_multiple_of(interval))
            .then_some(Installment { amount, months, interval_months: interval })
        })
        .collect()
}

/// An offer may be negotiated before FM creates a future contract or schedule.
pub fn negotiating(state: u8) -> bool {
    matches!(state, 0 | 1 | 5 | 8 | 12)
}

/// The schedule must belong to an agreed move whose day is still ahead.
pub fn editable_schedule(state: u8, scheduled_day: Option<i64>, today: Option<i64>) -> bool {
    state == 19 && scheduled_day.zip(today).is_some_and(|(scheduled, now)| scheduled > now)
}

pub fn expected_after(address: u64, before: &[u8], changes: &[(u64, Vec<u8>)]) -> Vec<u8> {
    let mut expected = before.to_vec();
    for (at, bytes) in changes {
        let start = address.max(*at);
        let end = (address + before.len() as u64).min(*at + bytes.len() as u64);
        if start < end {
            expected[(start - address) as usize..(end - address) as usize]
                .copy_from_slice(&bytes[(start - at) as usize..(end - at) as usize]);
        }
    }
    expected
}
pub fn date(value: i64) -> Option<NaiveDate> {
    if !(19010101..=99991231).contains(&value) {
        return None;
    }
    NaiveDate::from_ymd_opt((value / 10000) as i32, (value / 100 % 100) as u32, (value % 100) as u32)
}
pub fn validate(before: &Values, edit: &Edit, caps: Capabilities, today: i64) -> Result<Values, String> {
    let mut after = before.clone();
    for (key, value, max) in
        [("valor à vista", edit.fee, i64::from(u32::MAX)), ("salário", edit.wage, i64::from(i32::MAX))]
    {
        if let Some(value) = value {
            if !(0..=max).contains(&value) {
                return Err(format!("O {key} deve estar entre 0 e {max} libras."));
            }
        }
    }
    if let Some(v) = edit.fee {
        if v != before.fee && !caps.fee {
            return Err("O valor desta proposta está somente para leitura.".into());
        }
        after.fee = v;
    }
    if let Some(v) = edit.wage {
        if Some(v) != before.wage && !caps.contract {
            return Err("Não há contrato futuro validado para editar o salário.".into());
        }
        after.wage = Some(v);
    }
    if let Some(v) = edit.expires {
        if Some(v) != before.expires {
            if !caps.contract {
                return Err("Não há contrato futuro validado para editar o vencimento.".into());
            }
            if date(v).is_none() {
                return Err("Data de vencimento inválida.".into());
            }
        }
        after.expires = Some(v);
    }
    if let Some(v) = edit.contract_type {
        if Some(v) != before.contract_type && (!caps.kind || !matches!(v, 0 | 1 | 2 | 3 | 4 | 10 | 11)) {
            return Err("Tipo de contrato indisponível nesta proposta.".into());
        }
        after.contract_type = Some(v);
    }
    if let Some(v) = edit.move_day {
        if Some(v) != before.move_day {
            if !caps.date {
                return Err(
                    "A data só pode ser alterada em uma transferência confirmada com agendamento futuro identificado."
                        .into(),
                );
            }
            let target = date(v).ok_or("Data da transferência inválida.")?;
            if target <= date(today).ok_or("Data atual do jogo indisponível.")? {
                return Err("A transferência deve ocorrer depois da data atual do jogo.".into());
            }
        }
        after.move_day = Some(v);
    }
    if (after.move_day != before.move_day || after.expires != before.expires)
        && after.expires.zip(after.move_day).is_some_and(|(end, start)| end <= start)
    {
        return Err("O contrato precisa terminar depois da transferência.".into());
    }
    if &after == before {
        return Err("Nenhuma alteração para aplicar.".into());
    }
    Ok(after)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn values() -> Values {
        Values { fee: 100, wage: Some(1000), move_day: Some(20270701), expires: Some(20300630), contract_type: Some(1) }
    }
    fn all() -> Capabilities {
        Capabilities { fee: true, contract: true, date: true, kind: true }
    }
    #[test]
    fn installment_amount_is_total_not_amount_per_payment() {
        let mut entry = [0; 12];
        entry[..4].copy_from_slice(&31_859_970u32.to_le_bytes());
        entry[4] = 24;
        entry[5] = 1;
        entry[8] = 12;
        assert_eq!(
            decode_installments(&entry).unwrap(),
            [Installment { amount: 31_859_970, months: 24, interval_months: 12 }]
        );
        assert!(decode_installments(&entry[..10]).is_none());
        entry[5] = 0x7f;
        assert!(decode_installments(&entry).is_none());
        entry[5] = 0;
        entry[8] = 0;
        assert!(decode_installments(&entry).is_none());
    }

    #[test]
    fn pending_bid_can_change_fee_without_a_schedule_or_contract() {
        let state = 0;
        let before = Values { fee: 13_950_000, ..Default::default() };
        let caps = Capabilities {
            fee: negotiating(state),
            date: editable_schedule(state, None, Some(20270207)),
            ..Default::default()
        };
        let edit = Edit { fee: Some(12_000_000), ..Default::default() };
        assert_eq!(validate(&before, &edit, caps, 20270207).unwrap().fee, 12_000_000);
        let date_edit = Edit { move_day: Some(20270701), ..Default::default() };
        assert!(validate(&before, &date_edit, caps, 20270207).is_err());
    }

    #[test]
    fn scheduled_move_uses_agreed_stage_and_a_future_day() {
        assert!(editable_schedule(19, Some(20270701), Some(20270207)));
        assert!(!editable_schedule(0, Some(20270701), Some(20270207)));
        assert!(!editable_schedule(19, None, Some(20270207)));
        assert!(!editable_schedule(19, Some(20270207), Some(20270207)));
        assert!(!editable_schedule(19, Some(20270701), None));
        assert!(!negotiating(2));
        assert!(!negotiating(20));
    }

    #[test]
    fn fee_only_pending_bid_has_no_contract_requirement() {
        let b = Values { fee: 100, ..Default::default() };
        assert_eq!(
            validate(
                &b,
                &Edit { fee: Some(200), ..Default::default() },
                Capabilities { fee: true, ..Default::default() },
                20261017
            )
            .unwrap()
            .fee,
            200
        )
    }
    #[test]
    fn all_terms_can_change_together() {
        assert_eq!(
            validate(
                &values(),
                &Edit {
                    fee: Some(200),
                    wage: Some(1500),
                    move_day: Some(20270801),
                    expires: Some(20310630),
                    contract_type: Some(0)
                },
                all(),
                20261017
            )
            .unwrap()
            .move_day,
            Some(20270801)
        )
    }
    #[test]
    fn missing_scheduler_blocks_date() {
        assert!(
            validate(
                &values(),
                &Edit { move_day: Some(20270801), ..Default::default() },
                Capabilities { date: false, ..all() },
                20261017
            )
            .is_err()
        )
    }
    #[test]
    fn past_and_today_are_rejected() {
        for day in [20261016, 20261017] {
            assert!(validate(&values(), &Edit { move_day: Some(day), ..Default::default() }, all(), 20261017).is_err())
        }
    }
    #[test]
    fn invalid_calendar_day_is_rejected() {
        assert!(validate(&values(), &Edit { move_day: Some(20270229), ..Default::default() }, all(), 20261017).is_err())
    }
    #[test]
    fn expiration_must_follow_rescheduled_move() {
        assert!(validate(&values(), &Edit { move_day: Some(20300701), ..Default::default() }, all(), 20261017).is_err())
    }
    #[test]
    fn negative_and_overflow_amounts_are_rejected() {
        for fee in [-1, i64::from(u32::MAX) + 1] {
            assert!(validate(&values(), &Edit { fee: Some(fee), ..Default::default() }, all(), 20261017).is_err())
        }
    }
    #[test]
    fn fee_supports_the_verified_unsigned_field() {
        let fee = i64::from(i32::MAX) + 1;
        assert_eq!(
            validate(&values(), &Edit { fee: Some(fee), ..Default::default() }, all(), 20270207).unwrap().fee,
            fee
        );
        assert!(validate(&values(), &Edit { wage: Some(fee), ..Default::default() }, all(), 20270207).is_err());
    }
    #[test]
    fn ended_or_unvalidated_deals_cannot_be_edited() {
        assert!(
            validate(&values(), &Edit { fee: Some(200), ..Default::default() }, Capabilities::default(), 20261017)
                .is_err()
        )
    }
    #[test]
    fn unchanged_read_only_fields_do_not_block_allowed_fee_edit() {
        assert!(
            validate(
                &values(),
                &Edit { fee: Some(200), move_day: values().move_day, ..Default::default() },
                Capabilities { fee: true, ..Default::default() },
                20261017
            )
            .is_ok()
        )
    }
    #[test]
    fn no_change_is_rejected() {
        assert!(validate(&values(), &Edit::default(), all(), 20261017).is_err())
    }
    #[test]
    fn unsupported_contract_type_is_rejected() {
        assert!(validate(&values(), &Edit { contract_type: Some(255), ..Default::default() }, all(), 20261017).is_err())
    }
    #[test]
    fn undo_guard_accounts_for_subfield_writes() {
        assert_eq!(expected_after(100, &[1, 2, 3, 4], &[(101, vec![8, 9])]), vec![1, 8, 9, 4])
    }
    #[test]
    fn undo_guard_handles_partial_overlap() {
        assert_eq!(expected_after(100, &[1, 2, 3, 4], &[(99, vec![7, 8]), (103, vec![9, 10])]), vec![8, 2, 3, 9])
    }
    #[test]
    fn undo_guard_preserves_unwritten_identity_bytes() {
        assert_eq!(expected_after(100, &[1, 2, 3, 4], &[(200, vec![8, 9])]), vec![1, 2, 3, 4])
    }
}
