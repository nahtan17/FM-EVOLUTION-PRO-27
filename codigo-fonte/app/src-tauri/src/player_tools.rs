use super::development::check_connection;
use super::development_store::{PlayerRef, Rules, Snapshot};
use super::{
    AppState, Change, Connection, Entity, Failure, FmDate, PlayerDetails, PlayerSummary, not_connected, now_ms,
};
use fmlibre_core::{ATTRIBUTE_GROUPS, Check, Injury, Target};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::Manager;

const LIMIT: usize = 500;

#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub(crate) enum Tool {
    Evolve { points: i64, absolute: bool, ceiling: Option<u16> },
    Fitness { condition: Option<i64>, sharpness: Option<i64>, fatigue: Option<i64> },
    FitnessAdvanced { condition_raw: Option<i64>, sharpness: Option<i64>, club: Option<u32> },
    Contract { expires: Option<i64>, years: Option<i64>, wage: Option<i64>, percent: Option<i64> },
    Copy { origin: u32, attributes: BTreeSet<String> },
}

impl Tool {
    fn name(&self) -> &'static str {
        match self {
            Self::Evolve { .. } => "Evolução Imediata",
            Self::Fitness { .. } => "Central de condição física",
            Self::FitnessAdvanced { .. } => "Condição física avançada",
            Self::Contract { .. } => "Gestor de Contratos",
            Self::Copy { .. } => "Copiar atributos entre jogadores",
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlayerRow {
    summary: PlayerSummary,
    condition: Option<u16>,
    condition_raw: Option<i64>,
    sharpness: Option<u16>,
    sharpness_raw: Option<i64>,
    fatigue: Option<i16>,
    injuries: Vec<Injury>,
    injuries_available: bool,
    wage: Option<i32>,
    expires: Option<FmDate>,
    contract_type: Option<u8>,
    loan: bool,
    market_value: Option<i32>,
    attributes: BTreeMap<String, u8>,
    reason: Option<String>,
}

fn read_details(connection: &Connection, summary: &PlayerSummary) -> Result<PlayerDetails, Failure> {
    connection
        .session
        .player_details(summary)?
        .ok_or_else(|| invalid("A ficha do jogador mudou ou não pôde ser validada."))
}

fn invalid(message: impl Into<String>) -> Failure {
    Failure::new("players.tools", message)
}

#[tauri::command]
pub(crate) async fn player_tools_list(
    app: tauri::AppHandle,
    uids: Option<BTreeSet<u32>>,
    club: Option<u32>,
    query: Option<String>,
    whole_club: Option<bool>,
) -> Result<Vec<PlayerRow>, Failure> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let guard = state.0.lock()?;
        let connection = guard.as_ref().ok_or_else(not_connected)?;
        connection.refuse_after_load()?;
        let query = query.as_deref().unwrap_or_default().trim();
        let rows = if whole_club == Some(true) {
            let uid = club.ok_or_else(|| invalid("Selecione um clube."))?;
            let summary = connection.clubs.get(uid).ok_or_else(|| invalid("Clube indisponível."))?;
            let roster = connection.session.club_teams(summary, &connection.players)?;
            let ids: BTreeSet<_> = roster
                .into_iter()
                .flat_map(|team| team.players)
                .filter(|member| member.plays_here)
                .map(|member| member.uid)
                .collect();
            if ids.len() > LIMIT {
                return Err(invalid(format!("O elenco excede o limite de {LIMIT} jogadores por lote.")));
            }
            ids.into_iter().filter_map(|uid| connection.players.get(uid)).collect()
        } else if let Some(uids) = uids.filter(|uids| !uids.is_empty()) {
            uids.into_iter().filter_map(|uid| connection.players.get(uid)).collect::<Vec<_>>()
        } else if !query.is_empty() {
            connection.players.search(query)
        } else if club.is_some() {
            connection.players.iter().filter(|player| player.club_uid == club).collect()
        } else {
            Vec::new()
        };
        let include_attrs = rows.len() <= 5;
        let session = &connection.session;
        let live_values = session.known_build() && session.health().passed(Check::LiveValues);
        let field = |name| live_values.then(|| session.field(Entity::Player, name).ok()).flatten();
        let condition_field = field("condition");
        let sharpness_field = field("match_sharpness");
        let raw_value = |field: &Option<fmlibre_core::Field>, value| {
            let raw = i64::from(value);
            field.as_ref().filter(|field| field.is_plausible(raw)).map(|_| raw)
        };
        let rows = rows
            .into_iter()
            .filter(|row| whole_club == Some(true) || club.is_none_or(|club| row.club_uid == Some(club)))
            .take(LIMIT)
            .map(|summary| {
                let mut row = PlayerRow {
                    summary: summary.clone(),
                    condition: None,
                    condition_raw: None,
                    sharpness: None,
                    sharpness_raw: None,
                    fatigue: None,
                    injuries: Vec::new(),
                    injuries_available: false,
                    wage: None,
                    expires: None,
                    contract_type: None,
                    loan: false,
                    market_value: summary.transfer_value,
                    attributes: BTreeMap::new(),
                    reason: None,
                };
                match read_details(connection, summary) {
                    Ok(details) => {
                        row.summary = details.summary;
                        row.condition = Some(details.condition);
                        row.condition_raw = raw_value(&condition_field, details.condition);
                        row.sharpness = Some(details.match_sharpness);
                        row.sharpness_raw = raw_value(&sharpness_field, details.match_sharpness);
                        row.fatigue = Some(details.jadedness);
                        if let Ok(injuries) = connection.session.injuries(summary) {
                            row.injuries = injuries;
                            row.injuries_available = true;
                        }
                        row.market_value = row.summary.transfer_value;
                        row.loan = details.loan.is_some();
                        if include_attrs {
                            row.attributes =
                                details.attributes.into_iter().map(|(key, value)| (key, value.value)).collect();
                        }
                        if let Some(contract) = details.contract {
                            row.wage = Some(contract.wage);
                            row.expires = contract.expires;
                            row.contract_type = contract.contract_type;
                        }
                    }
                    Err(error) => row.reason = Some(error.message),
                }
                row
            })
            .collect();
        connection.refuse_after_load()?;
        Ok(rows)
    })
    .await?
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Row {
    uid: u32,
    name: String,
    club: Option<String>,
    status: &'static str,
    reason: Option<String>,
    changes: Vec<Change>,
    batch: Option<u32>,
    batch_session: Option<String>,
}

#[derive(Clone, PartialEq, Eq)]
struct Planned {
    player: PlayerRef,
    target: Target,
    club: Option<u32>,
    date: FmDate,
    signature: Option<String>,
    changes: Vec<Change>,
    guards: Vec<(&'static str, i64)>,
}

fn get_live(connection: &Connection, uid: u32) -> Result<(&PlayerSummary, PlayerDetails), Failure> {
    let summary = connection.players.get(uid).ok_or_else(|| invalid("Jogador indisponível."))?;
    let details = read_details(connection, summary)?;
    if details.summary.uid != uid || details.summary.date_of_birth != summary.date_of_birth {
        return Err(invalid("A identidade do jogador mudou."));
    }
    Ok((summary, details))
}

fn copy_source(connection: &Connection, uid: u32) -> Result<PlayerDetails, Failure> {
    let (_, details) = get_live(connection, uid)?;
    Ok(details)
}

fn plan(
    connection: &Connection,
    tool: &Tool,
    uid: u32,
    origin: Option<&PlayerDetails>,
    transfers: &mut BTreeMap<u32, BTreeSet<u32>>,
) -> Result<Planned, Failure> {
    let (summary, details) = get_live(connection, uid)?;
    let player =
        PlayerRef::from_summary(&details.summary).ok_or_else(|| invalid("Data de nascimento indisponível."))?;
    let target = summary.target();
    let club = details.summary.club_uid;
    let date = connection.session.game_date().ok_or_else(|| invalid("Data do FM indisponível."))?;
    let session = &connection.session;
    let mut changes = Vec::new();
    let mut guards = Vec::new();
    let mut signature = None;
    let mut put = |key: &str, new: i64| -> Result<(), Failure> {
        let field = session.field(Entity::Player, key)?;
        if !field.takes(new) || session.field_lock(&field).is_some() {
            return Err(invalid(format!("Valor fora da faixa ou campo bloqueado: {key}.")));
        }
        let old = session.read_field(&target, &field)?;
        if matches!(tool, Tool::FitnessAdvanced { .. }) && !field.is_plausible(old) {
            return Err(invalid(format!("Valor atual fora da faixa validada: {key}.")));
        }
        if old != new {
            changes.push(Change { entity: Entity::Player, uid, field: key.into(), old, new });
        }
        Ok(())
    };
    match tool {
        Tool::Evolve { points, absolute, ceiling } => {
            if !(1..=200).contains(points) || ceiling.is_some_and(|limit| !(1..=200).contains(&limit)) {
                return Err(invalid("Informe um valor entre 1 e 200."));
            }
            if connection.frozen.attributes.contains_key(&uid) {
                return Err(invalid("Atributos congelados."));
            }
            let ca = i64::from(details.summary.current_ability);
            let pa = i64::from(details.summary.potential_ability);
            if !(1..=200).contains(&ca) || !(ca..=200).contains(&pa) {
                return Err(invalid("CA ou PA indefinido ou incoerente."));
            }
            let (rules, _) =
                connection.development.store.document.settings.rules_for(player, &Rules::default()).map_err(invalid)?;
            let cap = pa.min(i64::from(rules.ceiling.unwrap_or(200))).min(i64::from(ceiling.unwrap_or(200)));
            let new = if *absolute { *points } else { ca + points }.min(cap);
            if new <= ca {
                return Err(invalid("CA já está no teto ou no patamar solicitado."));
            }
            guards.push(("potential_ability", pa));
            guards.push(("current_ability", ca));
            put("current_ability", new)?;
            guards.pop();
            if changes.first().is_none_or(|change| change.old != ca) {
                return Err(invalid("CA mudou durante a leitura."));
            }
        }
        Tool::Fitness { condition, sharpness, fatigue } => {
            if connection.frozen.fitness.contains_key(&uid) {
                return Err(invalid("Condição física congelada."));
            }
            for (key, value) in [("condition", *condition), ("match_sharpness", *sharpness), ("jadedness", *fatigue)] {
                if let Some(value) = value {
                    put(key, value)?;
                }
            }
        }
        Tool::FitnessAdvanced { condition_raw, sharpness, club: expected_club } => {
            if expected_club.is_some_and(|uid| club != Some(uid)) {
                return Err(invalid("O jogador já não pertence ao clube selecionado."));
            }
            if connection.frozen.fitness.contains_key(&uid) {
                return Err(invalid("Condição física congelada."));
            }
            if !session.health().passed(Check::LiveValues) {
                return Err(invalid("Os campos físicos deste build não passaram pela verificação."));
            }
            let fields =
                [("condition", "Condição física", *condition_raw), ("match_sharpness", "Ritmo de jogo", *sharpness)];
            let mut refused = Vec::new();
            for (key, label, value) in fields {
                if let Some(value) = value {
                    let field = session.field(Entity::Player, key)?;
                    if !field.takes(value) {
                        refused.push(format!(
                            "{label}: {value} fora da faixa de gravação validada ({}–{}).",
                            field.min, field.max
                        ));
                    }
                }
            }
            if !refused.is_empty() {
                return Err(invalid(format!("{} Nenhum campo deste jogador foi gravado.", refused.join(" "))));
            }
            for (key, _, value) in fields {
                if let Some(value) = value {
                    put(key, value)?;
                }
            }
        }
        Tool::Contract { expires, years, wage, percent } => {
            let club = club
                .filter(|club| summary.club_uid == Some(*club))
                .ok_or_else(|| invalid("Clube do contrato indisponível ou alterado."))?;
            let contract = details.contract.as_ref().ok_or_else(|| invalid("Sem contrato ativo."))?;
            let old_expiry = contract
                .expires
                .filter(|end| *end >= date)
                .ok_or_else(|| invalid("Contrato sem data válida ou vencido."))?;
            let Some(signed) = contract.signed.filter(|signed| *signed <= date && *signed <= old_expiry) else {
                return Err(invalid("Data de assinatura indisponível."));
            };
            if session.loan(summary)?.is_some() || contract.contract_type.is_none_or(|kind| !matches!(kind, 0 | 1)) {
                return Err(invalid("Contrato fora dos tipos integral e parcial validados ou jogador emprestado."));
            }
            if !transfers.contains_key(&club) {
                let owner = connection.clubs.get(club).ok_or_else(|| invalid("Clube indisponível."))?;
                let active = session
                    .club_transfer_center(owner, &connection.players, &connection.clubs)?
                    .into_iter()
                    .filter(|deal| fmlibre_deals::negotiating(deal.state) || deal.state == 19)
                    .map(|deal| deal.player)
                    .collect();
                transfers.insert(club, active);
            }
            if transfers[&club].contains(&uid) || session.has_pending_contract(summary)? {
                return Err(invalid(
                    "Jogador tem uma negociação ou transferência agendada no Centro de Transferências.",
                ));
            }
            let current_wage = i64::from(contract.wage);
            if !(0..=10_000_000).contains(&current_wage) {
                return Err(invalid("Salário original fora da faixa validada."));
            }
            signature = Some(format!(
                "{signed:?}:{old_expiry:?}:{current_wage}:{:?}:{:?}",
                contract.contract_type, contract.clauses
            ));
            match (expires, years) {
                (Some(_), Some(_)) => return Err(invalid("Escolha uma data ou uma extensão em anos.")),
                (None, Some(years)) if !(1..=10).contains(years) => return Err(invalid("Informe de 1 a 10 anos.")),
                _ => {}
            }
            if let Some(next) =
                expires.or_else(|| years.and_then(|years| old_expiry.plus_years(years).map(FmDate::to_number)))
            {
                let value = FmDate::from_number(next)
                    .filter(|end| *end > date)
                    .ok_or_else(|| invalid("A data final precisa vir depois da data do FM."))?;
                put("contract.expires", value.to_number())?;
            }
            if wage.is_some() && percent.is_some() || percent.is_some_and(|value| !(-100..=1000).contains(&value)) {
                return Err(invalid("Escolha salário fixo ou ajuste percentual entre -100% e 1.000%."));
            }
            if let Some(value) = wage.or_else(|| percent.map(|value| (current_wage * (100 + value) + 50) / 100)) {
                put("contract.wage", value)?;
            }
        }
        Tool::Copy { origin: source_uid, attributes } => {
            let source = origin.ok_or_else(|| invalid("Ficha de origem indisponível."))?;
            if uid == *source_uid || connection.frozen.attributes.contains_key(&uid) {
                return Err(invalid("O destino é a origem ou tem atributos congelados."));
            }
            let supported =
                |key: &str| ATTRIBUTE_GROUPS.iter().any(|(group, keys)| *group != "feet" && keys.contains(&key));
            if attributes.is_empty() || attributes.len() > 60 || attributes.iter().any(|key| !supported(key)) {
                return Err(invalid("Escolha atributos com suporte a gravação."));
            }
            let ca = details.summary.current_ability;
            let pa = details.summary.potential_ability;
            if ca == 0 || ca > 200 || pa < ca as i16 || pa > 200 {
                return Err(invalid("CA/PA incompatível no destino."));
            }
            let same_position = source
                .summary
                .positions
                .first()
                .zip(details.summary.positions.first())
                .is_some_and(|(left, right)| left == right);
            for key in attributes {
                let Some(value) =
                    source.attributes.get(key).map(|value| value.raw).filter(|value| (1..=100).contains(value))
                else {
                    return Err(invalid(format!("Atributo de origem indisponível: {key}.")));
                };
                let old = details
                    .attributes
                    .get(key)
                    .ok_or_else(|| invalid(format!("Atributo de destino indisponível: {key}.")))?;
                let hidden =
                    ATTRIBUTE_GROUPS.iter().any(|(group, keys)| *group == "hidden" && keys.contains(&key.as_str()));
                if !hidden
                    && value > old.raw
                    && (ca as i16 == pa || !same_position || !(1..=ca).contains(&source.summary.current_ability))
                {
                    return Err(invalid(
                        "O aumento exige a mesma posição principal, CA de origem até o CA do destino e margem para o PA.",
                    ));
                }
                put(&format!("attribute.{key}"), value.into())?;
            }
            guards.extend([("potential_ability", pa.into()), ("current_ability", ca.into())]);
            signature = Some(format!(
                "{:?}:{:?}:{:?}",
                source.summary.date_of_birth, source.summary.positions, source.summary.current_ability
            ));
        }
    }
    Ok(Planned { player, target, club, date, signature, changes, guards })
}

#[derive(Serialize)]
pub(crate) struct Preview {
    token: u64,
    rows: Vec<Row>,
}

struct Pending {
    token: u64,
    session: String,
    label: Option<String>,
    tool: Tool,
    rows: Vec<Row>,
    operations: BTreeMap<u32, Planned>,
}

#[derive(Clone, Serialize)]
pub(crate) struct Progress {
    token: u64,
    processed: usize,
    total: usize,
}

#[derive(Default)]
pub(crate) struct BatchState {
    next: AtomicU64,
    pending: Mutex<Option<Pending>>,
    active: Mutex<Option<Progress>>,
    cancel: AtomicU64,
}

#[tauri::command]
pub(crate) async fn player_tools_preview(
    app: tauri::AppHandle,
    tool: Tool,
    uids: BTreeSet<u32>,
) -> Result<Preview, Failure> {
    tauri::async_runtime::spawn_blocking(move || {
        if uids.is_empty() || uids.len() > LIMIT {
            return Err(invalid(format!("Selecione entre 1 e {LIMIT} jogadores.")));
        }
        let state = app.state::<AppState>();
        let guard = state.0.lock()?;
        let connection = guard.as_ref().ok_or_else(not_connected)?;
        check_connection(connection)?;
        let origin = match &tool {
            Tool::Copy { origin, .. } => Some(copy_source(connection, *origin)?),
            _ => None,
        };
        let mut operations = BTreeMap::new();
        let mut rows = Vec::new();
        let mut transfers = BTreeMap::new();
        for uid in uids {
            let summary = connection.players.get(uid);
            let mut row = Row {
                uid,
                name: summary.map_or_else(|| uid.to_string(), |p| p.name.clone()),
                club: summary.and_then(|p| p.club.clone()),
                changes: Vec::new(),
                batch: None,
                batch_session: None,
                status: "Sem alteração",
                reason: None,
            };
            match plan(connection, &tool, uid, origin.as_ref(), &mut transfers) {
                Ok(operation) if !operation.changes.is_empty() => {
                    row.status = "Pronto";
                    row.changes = operation.changes.clone();
                    operations.insert(uid, operation);
                }
                Ok(_) => {}
                Err(error) => {
                    row.status = "Bloqueado";
                    row.reason = Some(error.message);
                }
            }
            rows.push(row);
        }
        connection.refuse_after_load()?;
        let batches = app.state::<BatchState>();
        let token = batches.next.fetch_add(1, Ordering::Relaxed) + 1;
        *batches.pending.lock()? = Some(Pending {
            token,
            session: connection.history.session.clone(),
            label: connection.development.store.label.clone(),
            tool,
            rows: rows.clone(),
            operations,
        });
        Ok(Preview { token, rows })
    })
    .await?
}

fn confirm(
    connection: &mut Connection,
    pending: &Pending,
    expected: &Planned,
    name: &str,
    batch: u32,
) -> Result<Option<String>, Failure> {
    check_connection(connection)?;
    if connection.history.session != pending.session || connection.development.store.label != pending.label {
        return Err(invalid("A partida mudou. Faça uma nova prévia."));
    }
    let origin = match &pending.tool {
        Tool::Copy { origin, .. } => Some(copy_source(connection, *origin)?),
        _ => None,
    };
    if plan(connection, &pending.tool, expected.player.uid, origin.as_ref(), &mut BTreeMap::new())? != *expected
        || connection.session.game_date() != Some(expected.date)
    {
        return Err(invalid("Os dados mudaram desde a prévia. Nenhum campo deste jogador foi aplicado."));
    }
    connection.session.apply_player_values(&expected.target, &expected.changes, &expected.guards)?;
    for change in &expected.changes {
        connection.log_tool_change(change.clone(), name.into(), batch, pending.tool.name());
    }
    if !matches!(pending.tool, Tool::Evolve { .. } | Tool::Copy { .. }) {
        return Ok(None);
    }
    let (_, details) = match get_live(connection, expected.player.uid) {
        Ok(result) if connection.session.game_date() == Some(expected.date) => result,
        _ => return Ok(Some("Edição confirmada, mas a ficha mudou antes da coleta para o gráfico.".into())),
    };
    connection.development.store.observe([Snapshot {
        player: expected.player,
        name: name.into(),
        club: details.summary.club,
        date: expected.date,
        read_at: now_ms(),
        ability: details.summary.current_ability,
        potential: details.summary.potential_ability,
        attributes: details.attributes.into_iter().map(|(key, value)| (key, value.value)).collect(),
        source: pending.tool.name().into(),
    }]);
    Ok(connection.development.store.save().err().map(|error| error.message))
}

#[tauri::command]
pub(crate) async fn player_tools_apply(app: tauri::AppHandle, token: u64) -> Result<Vec<Row>, Failure> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let batches = app.state::<BatchState>();
        let (pending, batch) = {
            let mut guard = state.0.lock()?;
            let connection = guard.as_mut().ok_or_else(not_connected)?;
            let mut active = batches.active.lock()?;
            if active.is_some() {
                return Err(invalid("Há um lote em andamento."));
            }
            let mut slot = batches.pending.lock()?;
            if slot.as_ref().is_none_or(|next| next.token != token || next.session != connection.history.session) {
                return Err(invalid("Prévia expirada. Confira os valores novamente."));
            }
            let pending = slot.take().expect("matched preview");
            batches.cancel.store(0, Ordering::Release);
            *active = Some(Progress { token, processed: 0, total: pending.rows.len() });
            (pending, connection.fresh_id())
        };
        let mut rows = pending.rows.clone();
        for (index, row) in rows.iter_mut().enumerate() {
            if let Some(expected) = pending.operations.get(&row.uid) {
                if batches.cancel.load(Ordering::Acquire) == token {
                    row.status = "Cancelado";
                } else {
                    let outcome = state.0.lock().map_err(Failure::from).and_then(|mut guard| {
                        confirm(guard.as_mut().ok_or_else(not_connected)?, &pending, expected, &row.name, batch)
                    });
                    match outcome {
                        Ok(warning) => {
                            row.status = "Aplicado e relido";
                            if matches!(pending.tool, Tool::FitnessAdvanced { .. }) {
                                row.batch = Some(batch);
                                row.batch_session = Some(pending.session.clone());
                            }
                            row.reason = warning;
                        }
                        Err(error) => {
                            row.status = "Falhou";
                            row.reason = Some(error.message);
                        }
                    }
                }
            }
            if let Some(active) = batches.active.lock()?.as_mut() {
                active.processed = index + 1;
            }
            std::thread::yield_now();
        }
        *batches.active.lock()? = None;
        Ok(rows)
    })
    .await?
}

#[tauri::command]
pub(crate) fn player_tools_progress(state: tauri::State<'_, BatchState>) -> Result<Option<Progress>, Failure> {
    Ok(state.active.lock()?.clone())
}

#[tauri::command]
pub(crate) fn player_tools_cancel(state: tauri::State<'_, BatchState>, token: u64) -> Result<(), Failure> {
    if state.active.lock()?.as_ref().is_some_and(|active| active.token == token) {
        state.cancel.store(token, Ordering::Release);
    }
    Ok(())
}
