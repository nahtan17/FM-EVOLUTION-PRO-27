//! Amplifies observed development through validated player fields as the game advances.
use std::collections::{BTreeMap, BTreeSet};

use crate::growth::{DevelopmentMinimum, Growth, ability_bonus, requested_ability_bonus};
use crate::transfer::{Patches, PointerList};
use crate::{
    ATTRIBUTE_GROUPS, Change, Check, ClubSummary, Entity, FmDate, Lock, MoveError, POSITIONS, PlayerIndex, Session,
    Target,
};

#[derive(Clone, PartialEq, Eq)]
pub struct DevelopmentPlayer {
    target: Target,
    team: u64,
    born: FmDate,
    potential: i16,
    positions: Vec<&'static str>,
    growth: Growth,
}

impl DevelopmentPlayer {
    pub fn same_player(&self, current: &Self) -> bool {
        self.target == current.target
            && self.team == current.team
            && self.born == current.born
            && self.potential == current.potential
    }

    pub fn age(&self, date: FmDate) -> Option<u16> {
        self.born.age_on(date)
    }
    pub fn ability(&self) -> u16 {
        self.growth.ability
    }
    pub fn potential(&self) -> u16 {
        u16::try_from(self.potential).ok().filter(|pa| (1..=200).contains(pa)).unwrap_or(0)
    }

    pub fn raw_potential(&self) -> i16 {
        self.potential
    }

    pub fn born(&self) -> FmDate {
        self.born
    }

    pub fn positions(&self) -> &[&'static str] {
        &self.positions
    }

    pub fn attributes(&self, fields: &DevelopmentFields) -> BTreeMap<String, u8> {
        fields
            .attributes
            .iter()
            .zip(&self.growth.attributes)
            .filter(|&(_, &value)| value != 0)
            .filter_map(|((key, _), &value)| {
                Some((key.strip_prefix("attribute.")?.into(), crate::Attribute::from_raw(value).value))
            })
            .collect()
    }

    /// Retain the best applied values so recovery from a drop is not treated as a new gain.
    /// A temporary fall followed by a return to the same value does not establish new growth.
    pub fn observe(&mut self, current: &Self, applied: bool) {
        if !self.same_player(current) {
            *self = current.clone();
        } else if applied || current.ability() == current.potential() {
            self.growth.observe(&current.growth);
        }
    }
}

pub struct DevelopmentFields {
    attributes: Vec<(String, u64)>,
}

pub enum DevelopmentAttributes<'a> {
    AbilityOnly,
    AllObserved,
    Focus(&'a [String]),
}

#[derive(Default)]
pub struct DevelopmentGain {
    pub changes: Vec<Change>,
    pub bonus: u16,
    pub potential_limited: bool,
    pub weekly_limited: bool,
    pub resolved: bool,
}

impl Session {
    pub fn development_fields(&self) -> Result<DevelopmentFields, MoveError> {
        self.check_development_fields()?;
        let mut offsets = BTreeSet::new();
        let attributes: Vec<_> = ATTRIBUTE_GROUPS
            .iter()
            .filter(|(group, _)| matches!(*group, "technical" | "mental" | "physical" | "goalkeeping"))
            .flat_map(|(_, keys)| keys.iter())
            .filter_map(|key| {
                self.layout.player.attributes.get(*key).map(|&offset| (format!("attribute.{key}"), offset))
            })
            .filter(|(_, offset)| offsets.insert(*offset))
            .collect();
        if attributes.is_empty() {
            return Err(MoveError::Locked(Lock::Failed(Check::Attributes)));
        }
        Ok(DevelopmentFields { attributes })
    }

    fn check_development_fields(&self) -> Result<(), MoveError> {
        if let Some(lock) = self.structure_lock() {
            return Err(MoveError::Locked(lock));
        }
        for key in ["current_ability", "potential_ability", "date_of_birth", "attribute.finishing"] {
            let field =
                self.field(Entity::Player, key).map_err(|_| MoveError::Locked(Lock::Failed(Check::Attributes)))?;
            if let Some(lock) = self.field_lock(&field) {
                return Err(MoveError::Locked(lock));
            }
        }
        Ok(())
    }

    pub fn development_roster(
        &self,
        club: &ClubSummary,
        team_index: Option<usize>,
        players: &PlayerIndex,
        selected: Option<&BTreeSet<u32>>,
        fields: &DevelopmentFields,
    ) -> Result<BTreeMap<u32, Result<Option<DevelopmentPlayer>, MoveError>>, MoveError> {
        let teams =
            if let Some(index) = team_index { vec![self.team_object(club, index)?] } else { self.team_objects(club)? };
        let p = &self.layout.player;
        let mut result = BTreeMap::new();
        for team in teams {
            let Some(list) = PointerList::read(&self.process, team + self.layout.team.players)? else {
                continue;
            };
            if list.len() > 500 {
                return Err(MoveError::NotInTeam);
            }
            for address in list.elements(&self.process)? {
                let target = p.person_block_shifts.iter().find_map(|&shift| {
                    let uid = self.process.read_u32(address + p.at(p.uid, shift)).ok()?;
                    players
                        .get(uid)
                        .filter(|player| player.address == address && player.shift == shift)
                        .map(|p| p.target())
                });
                if let Some(target) = target
                    && selected.is_none_or(|ids| ids.contains(&target.uid))
                {
                    let sample = self.development_sample(target, team, fields);
                    if matches!(sample, Ok(Some(_))) {
                        result.insert(target.uid, sample);
                    } else {
                        result.entry(target.uid).or_insert(sample);
                    }
                }
            }
        }
        Ok(result)
    }

    fn development_sample(
        &self,
        target: Target,
        team: u64,
        fields: &DevelopmentFields,
    ) -> Result<Option<DevelopmentPlayer>, MoveError> {
        let p = &self.layout.player;
        let bytes = self.process.read_bytes(target.address, (p.end() + target.shift) as usize)?;
        let at = |offset| p.at(offset, target.shift) as usize;
        let u16_at = |offset| u16::from_le_bytes(bytes[at(offset)..at(offset) + 2].try_into().expect("two bytes"));
        let uid = u32::from_le_bytes(bytes[at(p.uid)..at(p.uid) + 4].try_into().expect("four bytes"));
        let player_team = u64::from_le_bytes(bytes[at(p.team)..at(p.team) + 8].try_into().expect("eight bytes"));
        if uid != target.uid || team != player_team {
            return Ok(None);
        }
        let Some(born) = FmDate::from_raw(u16_at(p.date_of_birth), u16_at(p.date_of_birth + 2)) else {
            return Ok(None);
        };
        let ability = u16_at(p.current_ability);
        let potential = u16_at(p.potential_ability) as i16;
        let attributes: Vec<_> = fields.attributes.iter().map(|(_, offset)| bytes[at(*offset)]).collect();
        if !(1..=200).contains(&ability) || attributes.iter().any(|&attr| attr > 100) {
            return Ok(None);
        }
        let position_offset = at(p.positions);
        let ratings: [u8; POSITIONS.len()] =
            bytes[position_offset..position_offset + POSITIONS.len()].try_into().expect("positional ratings");
        let positions = if self.health().passed(Check::Positions) && ratings.iter().all(|&rating| rating <= 20) {
            crate::players::natural_positions(&ratings)
        } else {
            Vec::new()
        };
        Ok(Some(DevelopmentPlayer { target, team, born, potential, positions, growth: Growth { ability, attributes } }))
    }

    /// Applies one player's bonus as a unit. Already observed values are verified again before writing.
    pub fn apply_development(
        &self,
        fields: &DevelopmentFields,
        date: FmDate,
        current: &mut DevelopmentPlayer,
        peak: &DevelopmentPlayer,
        multiplier: u8,
        remaining: u16,
        ceiling: u16,
        attribute_mode: DevelopmentAttributes<'_>,
        minimum: DevelopmentMinimum,
    ) -> Result<DevelopmentGain, MoveError> {
        if !peak.same_player(current) {
            return Ok(DevelopmentGain::default());
        }
        let natural = current.ability().saturating_sub(peak.ability());
        if natural == 0 && minimum != DevelopmentMinimum::Due {
            return Ok(DevelopmentGain::default());
        }
        let requested = requested_ability_bonus(natural, multiplier, minimum);
        let cap = current.potential().min(ceiling);
        let room = cap.saturating_sub(current.ability());
        let bonus = ability_bonus(requested, current.ability(), cap, remaining);
        let mut result = DevelopmentGain {
            potential_limited: room < requested && room <= remaining,
            weekly_limited: remaining < requested.min(room),
            ..DevelopmentGain::default()
        };
        if bonus == 0 {
            result.resolved = true;
            return Ok(result);
        }
        let growth = current
            .growth
            .accelerated(&peak.growth, cap, multiplier, bonus, |index| match &attribute_mode {
                DevelopmentAttributes::AbilityOnly => false,
                DevelopmentAttributes::AllObserved => true,
                DevelopmentAttributes::Focus(keys) => keys.contains(&fields.attributes[index].0),
            })
            .unwrap_or_else(|| Growth {
                ability: current.ability() + bonus,
                attributes: current.growth.attributes.clone(),
            });
        self.check_development_fields()?;
        if self.game_date() != Some(date)
            || self.development_sample(current.target, current.team, fields)?.as_ref() != Some(current)
        {
            return Err(MoveError::Changed { address: current.target.address });
        }
        let p = &self.layout.player;
        let target = current.target;
        let at = |offset| target.address + p.at(offset, target.shift);
        let mut changes = Vec::new();
        let mut patches = Patches::default();
        patches.push(at(p.current_ability), current.growth.ability.to_le_bytes(), growth.ability.to_le_bytes());
        changes.push(Change {
            entity: Entity::Player,
            uid: target.uid,
            field: "current_ability".into(),
            old: i64::from(current.growth.ability),
            new: i64::from(growth.ability),
        });
        for ((key, offset), (&old, &new)) in
            fields.attributes.iter().zip(current.growth.attributes.iter().zip(&growth.attributes))
        {
            if old != new {
                patches.push(at(*offset), [old], [new]);
                changes.push(Change {
                    entity: Entity::Player,
                    uid: target.uid,
                    field: key.clone(),
                    old: old.into(),
                    new: new.into(),
                });
            }
        }
        self.apply_patches(&patches.0)?;
        result.bonus = growth.ability - current.ability();
        result.changes = changes;
        result.resolved = true;
        current.growth = growth;
        Ok(result)
    }
}
