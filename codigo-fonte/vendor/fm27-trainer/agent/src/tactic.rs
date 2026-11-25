//! De tactieken van de menselijke manager en wat de tactiekhulp van de app nodig heeft: per
//! tactiek de elf plekken met hun rol met en zonder bal, en van elke speler van de selectie de
//! attributen en de posities. Alleen lezen.
//!
//! Feiten uit FMLibreEditor (`profiles/fm27/layout*.toml`, `docs/recon/fm27-tactics-and-value.md`),
//! op de Mac nagekeken tegen FM's tactiekscherm (Steam-build 26577676, Ajax-save, 14 nov 2026):
//!
//! - `simatch::PREPARED_TACTICS_CREATOR_ARRAY`: `+0x08` lijst van hoogstens drie tactiekblokken,
//!   `+0x20` i8 de tactiek in gebruik, `+0x28` 26 persoons-id's (basiself, dan de bank).
//! - Tactiekblok (0x800 bytes): `+0x100` u32 stijl als tekst achterstevoren (`GEGE`, `NULL` = eigen),
//!   elf plekken met bal en elf zonder bal, 0x48 bytes per plek, met het rolmasker (u64) op
//!   Windows vanaf `+0x158` / `+0x478`, op de Mac 8 verder. Een masker heeft één bit uit 21–23 en
//!   één bit dat de rol noemt. De plekken met bal staan in de volgorde van de opstelling; de
//!   plekken zonder bal in veldvolgorde, met een tabel (na een byte 0x1B, rond `+0x7A0`) die
//!   zegt welke plek zonder bal bij een plek met bal hoort.
//! - Speler: 15 positiecijfers (1–20: GK, SW, DL, DC, DR, DM, ML, MC, MR, AML, AMC, AMR, ST, WBL,
//!   WBR) en de attributen als u8 0–100 (in FM getoond als (x + 2) / 5).

use serde::Serialize;
use std::collections::HashMap;

use crate::game::{self, PlayerInfo};
use crate::{mem, rtti};

const SEL_LIST: u64 = 0x08;
const SEL_CURRENT: u64 = 0x20;
const SEL_SLOTS: u64 = 0x28;
const SEL_COUNT: usize = 26;
const EMPTY_SLOT: u32 = u32::MAX;
const BLOCK: usize = 0x800;
const STYLE: usize = 0x100;
const SLOT: usize = 0x48;
const SLOTS: usize = 11;
/// de bits die elk masker naast de rol heeft
const CLASS_BITS: u64 = 0b111 << 21;

/// Attributen: (naam, plek op de Mac). Op Windows ligt alles 8 verder (`Layout.p_positions`).
pub const ATTRIBUTES: [(&str, u64); 47] = [
    ("corners", 0x172),
    ("crossing", 0x157),
    ("dribbling", 0x158),
    ("finishing", 0x159),
    ("first_touch", 0x16D),
    ("free_kicks", 0x17A),
    ("heading", 0x15A),
    ("long_shots", 0x15B),
    ("long_throws", 0x175),
    ("marking", 0x15C),
    ("passing", 0x15E),
    ("penalty_taking", 0x15F),
    ("tackling", 0x160),
    ("technique", 0x16E),
    ("aggression", 0x184),
    ("anticipation", 0x168),
    ("bravery", 0x182),
    ("composure", 0x18B),
    ("concentration", 0x18C),
    ("decisions", 0x169),
    ("determination", 0x18A),
    ("flair", 0x171),
    ("leadership", 0x17F),
    ("off_the_ball", 0x15D),
    ("positioning", 0x16B),
    ("teamwork", 0x173),
    ("vision", 0x161),
    ("work_rate", 0x174),
    ("acceleration", 0x179),
    ("agility", 0x185),
    ("balance", 0x181),
    ("jumping_reach", 0x17E),
    ("natural_fitness", 0x189),
    ("pace", 0x17D),
    ("stamina", 0x17C),
    ("strength", 0x17B),
    ("aerial_reach", 0x163),
    ("command_of_area", 0x164),
    ("communication", 0x165),
    ("eccentricity", 0x176),
    ("handling", 0x162),
    ("kicking", 0x166),
    ("one_on_ones", 0x16A),
    ("punching", 0x178),
    ("reflexes", 0x16C),
    ("rushing_out", 0x177),
    ("throwing", 0x167),
];
const LEFT_FOOT: u64 = 0x16F;
const RIGHT_FOOT: u64 = 0x170;
const MAC_POSITIONS: u64 = 0x148;

#[derive(Serialize, Clone, Debug)]
pub struct Slot {
    /// uid van de speler op deze plek (None: leeg, of niet van de selectie)
    pub uid: Option<u32>,
    /// het bit dat de rol met bal noemt (None: geen rol leesbaar)
    pub ip: Option<u8>,
    /// het bit dat de rol zonder bal noemt
    pub oop: Option<u8>,
    /// plaats van deze plek in FM's veldvolgorde zonder bal (0 = keeper)
    pub oop_order: u8,
}

#[derive(Serialize, Clone, Debug)]
pub struct Tactic {
    pub index: usize,
    /// stijl van het sjabloon: "GEGE", "TIKI", …; leeg voor een eigen tactiek
    pub style: String,
    pub slots: Vec<Slot>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Player {
    pub uid: u32,
    pub name: String,
    /// GK, SW, DL, DC, DR, DM, ML, MC, MR, AML, AMC, AMR, ST, WBL, WBR (1–20)
    pub positions: Vec<u8>,
    /// attributen 1–20, zoals FM ze toont
    pub attributes: HashMap<&'static str, u8>,
    pub left_foot: u8,
    pub right_foot: u8,
    pub injured: bool,
    pub banned: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct Tactics {
    /// de tactiek in gebruik (index in `tactics`)
    pub current: usize,
    pub tactics: Vec<Tactic>,
    pub players: Vec<Player>,
    /// uids van de bank, in FM's volgorde
    pub bench: Vec<u32>,
}

/// Het bit dat de rol noemt: het enige bit buiten 21–23. Iets anders is geen rolmasker.
pub fn role_bit(mask: u64) -> Option<u8> {
    let role = mask & !CLASS_BITS;
    (role.count_ones() == 1 && (mask & CLASS_BITS).count_ones() == 1).then(|| role.trailing_zeros() as u8)
}

/// De tabel plek-met-bal → plek-zonder-bal: elf verschillende getallen 0–10 direct na een byte
/// 0x1B, in het stuk van het blok na de plekken. Niet gevonden: dezelfde volgorde.
fn oop_table(block: &[u8], from: usize) -> [u8; SLOTS] {
    let end = (from + 0x80).min(block.len());
    for i in from..end.saturating_sub(SLOTS + 1) {
        if block[i] != 0x1B {
            continue;
        }
        let t = &block[i + 1..i + 1 + SLOTS];
        let mut seen = [false; SLOTS];
        if t.iter().all(|&x| (x as usize) < SLOTS && !std::mem::replace(&mut seen[x as usize], true)) {
            return t.try_into().unwrap();
        }
    }
    std::array::from_fn(|i| i as u8)
}

fn read_tactic(index: usize, block: u64, ids: &[u32], by_person: &HashMap<u32, u32>) -> Option<Tactic> {
    let b = mem::read_bytes(block, BLOCK)?;
    // de plekken liggen op de Mac 8 verder dan op Windows, net als de eigen velden van een speler
    let d = (game::layout().p_positions.wrapping_sub(MAC_POSITIONS)) as usize;
    let (ip0, oop0) = (0x160 - d, 0x480 - d);
    let mask = |at: usize| b.get(at..at + 8).map(|s| u64::from_le_bytes(s.try_into().unwrap())).and_then(role_bit);
    let table = oop_table(&b, oop0 + SLOTS * SLOT - 0x10);
    let slots: Vec<Slot> = (0..SLOTS)
        .map(|i| {
            let o = table[i] as usize;
            Slot { uid: ids.get(i).and_then(|id| by_person.get(id)).copied(), ip: mask(ip0 + i * SLOT), oop: mask(oop0 + o * SLOT), oop_order: o as u8 }
        })
        .collect();
    // een blok zonder één leesbare rol is geen tactiek (vrijgegeven geheugen)
    if slots.iter().filter(|s| s.ip.is_some()).count() < 6 {
        return None;
    }
    let tag: String = b[STYLE..STYLE + 4].iter().rev().filter(|c| c.is_ascii_uppercase()).map(|&c| c as char).collect();
    Some(Tactic { index, style: if tag == "NULL" { String::new() } else { tag }, slots })
}

fn player(p: &PlayerInfo) -> Option<Player> {
    let d = game::layout().p_positions.wrapping_sub(MAC_POSITIONS);
    let positions = mem::read_bytes(p.addr + game::layout().p_positions, 15)?;
    if positions.iter().any(|&r| r > 20) {
        return None;
    }
    let lo = ATTRIBUTES.iter().map(|a| a.1).min().unwrap();
    let hi = ATTRIBUTES.iter().map(|a| a.1).max().unwrap();
    let raw = mem::read_bytes(p.addr + lo + d, (hi - lo + 1) as usize)?;
    let shown = |at: u64| ((raw[(at - lo) as usize] as u32 + 2) / 5).clamp(1, 20) as u8;
    if raw.iter().any(|&x| x > 100) {
        return None;
    }
    Some(Player {
        uid: p.uid,
        name: p.name.clone(),
        positions,
        attributes: ATTRIBUTES.iter().map(|&(n, at)| (n, shown(at))).collect(),
        left_foot: shown(LEFT_FOOT),
        right_foot: shown(RIGHT_FOOT),
        injured: !p.injuries.is_empty(),
        banned: p.bans > 0,
    })
}

pub fn tactics() -> Result<Tactics, String> {
    let squad = game::squad()?;
    let lay = game::layout();
    let by_person: HashMap<u32, u32> = squad.iter().filter_map(|p| Some((mem::u32_at(p.addr + lay.p_identity + p.shift + 8)?, p.uid))).collect();
    let img = mem::game_plugin().ok_or("game_plugin niet geladen")?;
    let vts = rtti::vtables_of(&img, &rtti::decorated("simatch", "PREPARED_TACTICS_CREATOR_ARRAY"));
    if vts.is_empty() {
        return Err("opstellingen niet gevonden / selections not found".into());
    }
    // de opstelling van de club: de kopie met de meeste eigen spelers in de basiself
    let mut best: Option<(usize, u64, Vec<u32>, Vec<u64>)> = None;
    for obj in rtti::instances(&vts, 4_000) {
        let Some(h) = mem::read_bytes(obj + SEL_LIST, 16) else { continue };
        let (begin, end) = (u64::from_le_bytes(h[..8].try_into().unwrap()), u64::from_le_bytes(h[8..].try_into().unwrap()));
        if !mem::is_ptr(begin) || end < begin + 8 || end > begin + 24 || (end - begin) % 8 != 0 {
            continue;
        }
        let Some(raw) = mem::read_bytes(obj + SEL_SLOTS, SEL_COUNT * 4) else { continue };
        let ids: Vec<u32> = raw.chunks_exact(4).map(|c| u32::from_le_bytes(c.try_into().unwrap())).collect();
        // van de club als de meeste gevulde plekken van de basiself eigen spelers zijn (een
        // selectie van een nationaal team niet), zoals bij verkopen
        let filled = ids[..SLOTS].iter().filter(|id| **id != EMPTY_SLOT).count();
        let mine = ids[..SLOTS].iter().filter(|id| by_person.contains_key(id)).count();
        if mine == 0 || 2 * mine <= filled || best.as_ref().is_some_and(|b| b.0 >= mine) {
            continue;
        }
        let Some(lb) = mem::read_bytes(begin, (end - begin) as usize) else { continue };
        let blocks: Vec<u64> = lb.chunks_exact(8).map(|c| u64::from_le_bytes(c.try_into().unwrap())).collect();
        best = Some((mine, obj, ids, blocks));
    }
    let (_, obj, ids, blocks) = best.ok_or("geen opstelling van je club gevonden: open in FM het tactiekscherm en kies een basiself / no selection of your club found: open the tactics screen in FM and pick a starting eleven")?;
    let tactics: Vec<Tactic> = blocks.iter().enumerate().filter(|(_, b)| mem::is_ptr(**b)).filter_map(|(i, b)| read_tactic(i, *b, &ids, &by_person)).collect();
    if tactics.is_empty() {
        return Err("tactiek niet leesbaar / tactic not readable".into());
    }
    let cur = mem::read_bytes(obj + SEL_CURRENT, 1).map(|b| b[0] as usize).unwrap_or(0);
    let current = tactics.iter().position(|t| t.index == cur).unwrap_or(0);
    Ok(Tactics {
        current,
        tactics,
        players: squad.iter().filter_map(player).collect(),
        bench: ids[SLOTS..].iter().filter(|id| **id != EMPTY_SLOT).filter_map(|id| by_person.get(id)).copied().collect(),
    })
}
