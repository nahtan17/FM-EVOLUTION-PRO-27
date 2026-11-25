//! In-place edits to the two mapped supporter arrays in a club's info record.
use std::hash::{DefaultHasher, Hash, Hasher};

use fmlibre_mem::is_user_pointer;
use serde::{Deserialize, Serialize};

use crate::transfer::{MoveError, Patch};
use crate::{ClubSummary, Session};

const SIZE: usize = 6;
type Values = [u8; SIZE];

#[derive(Debug, Serialize)]
pub struct SupporterAccess {
    pub revision: String,
    pub traits: bool,
    pub mix: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SupporterEdit {
    pub traits: Option<Values>,
    pub mix: Option<Values>,
}

#[derive(Clone)]
pub struct SupporterChange {
    patches: Vec<Patch>,
    pub fields: usize,
}

#[derive(Hash)]
struct Snapshot {
    uid: u32,
    club: u64,
    info: u64,
    traits: Values,
    mix: Values,
}

fn valid_traits(values: &Values) -> bool {
    values.iter().all(|value| (1..=20).contains(value))
}

fn valid_mix(values: &Values) -> bool {
    values.iter().map(|&value| u16::from(value)).sum::<u16>() == 100
}

impl Session {
    fn supporter_snapshot(&self, club: &ClubSummary) -> Option<Snapshot> {
        if !self.known_build() || !self.process.can_write() || self.save_changed() || self.structure_lock().is_some() {
            return None;
        }
        let layout = &self.layout.club;
        let club_at = club.address;
        let info = self.process.read_u64(club_at + layout.info).ok()?;
        if !is_user_pointer(info) || self.process.read_u32(club_at + layout.uid).ok()? != club.uid {
            return None;
        }
        let offsets = &self.layout.club_info;
        let bytes = self.process.read_bytes(info, offsets.end() as usize).ok()?;
        let values =
            |offset: u64| -> Option<Values> { bytes.get(offset as usize..offset as usize + SIZE)?.try_into().ok() };
        Some(Snapshot {
            uid: club.uid,
            club: club_at,
            info,
            traits: values(offsets.supporter_traits)?,
            mix: values(offsets.supporter_mix)?,
        })
    }

    fn supporter_access_for(&self, snapshot: &Snapshot) -> SupporterAccess {
        let offsets = &self.layout.club_info;
        let mut revision = DefaultHasher::new();
        snapshot.hash(&mut revision);
        SupporterAccess {
            revision: format!("{:016x}", revision.finish()),
            traits: valid_traits(&snapshot.traits)
                && self.heap_writable(snapshot.info + offsets.supporter_traits, SIZE),
            mix: valid_mix(&snapshot.mix) && self.heap_writable(snapshot.info + offsets.supporter_mix, SIZE),
        }
    }

    pub fn supporter_access(&self, club: &ClubSummary, details: &crate::ClubDetails) -> Option<SupporterAccess> {
        let snapshot = self.supporter_snapshot(club)?;
        // Tie capabilities to the exact values shown with this response.
        for (values, keys, displayed) in [
            (snapshot.traits, crate::SUPPORTER_TRAITS, &details.supporter_traits),
            (snapshot.mix, crate::SUPPORTER_MIX, &details.supporter_mix),
        ] {
            if keys.into_iter().zip(values).any(|(key, value)| displayed.get(key) != Some(&value)) {
                return None;
            }
        }
        Some(self.supporter_access_for(&snapshot))
    }

    pub fn set_supporters(
        &self,
        club: &ClubSummary,
        revision: &str,
        edit: SupporterEdit,
    ) -> Result<SupporterChange, String> {
        let snapshot = self
            .supporter_snapshot(club)
            .ok_or("A estrutura da torcida não está disponível para gravação neste clube ou versão do jogo.")?;
        let access = self.supporter_access_for(&snapshot);
        if access.revision != revision {
            return Err("O jogo atualizou os dados da torcida. Atualize a ficha antes de salvar.".into());
        }
        if let Some(traits) = edit.traits {
            if !access.traits {
                return Err("Os atributos desta torcida estão disponíveis somente para leitura.".into());
            }
            if !valid_traits(&traits) {
                return Err("Os atributos da torcida devem ser inteiros de 1 a 20.".into());
            }
        }
        if let Some(mix) = edit.mix {
            if !access.mix {
                return Err("O perfil desta torcida está disponível somente para leitura.".into());
            }
            if !valid_mix(&mix) {
                return Err("As seis categorias da torcida precisam somar 100%.".into());
            }
        }

        let layout = &self.layout.club;
        let guard =
            |offset, bytes: Vec<u8>| Patch { address: snapshot.club + offset, before: bytes.clone(), after: bytes };
        let mut patches = vec![
            guard(layout.uid, snapshot.uid.to_le_bytes().to_vec()),
            guard(layout.info, snapshot.info.to_le_bytes().to_vec()),
        ];
        let offsets = &self.layout.club_info;
        let mut fields = 0;
        for (offset, before, after) in
            [(offsets.supporter_traits, snapshot.traits, edit.traits), (offsets.supporter_mix, snapshot.mix, edit.mix)]
        {
            let after = after.unwrap_or(before);
            fields += before.iter().zip(after).filter(|(before, after)| **before != *after).count();
            patches.push(Patch { address: snapshot.info + offset, before: before.to_vec(), after: after.to_vec() });
        }
        if fields == 0 {
            return Err("Nenhuma alteração na torcida para salvar.".into());
        }
        self.apply_patches(&patches).map_err(|error| error.to_string())?;
        Ok(SupporterChange { patches, fields })
    }

    pub fn undo_supporters(&self, change: &SupporterChange) -> Result<(), MoveError> {
        if let Some(lock) = self.structure_lock() {
            return Err(MoveError::Locked(lock));
        }
        self.undo_patches(&change.patches)
    }
}
