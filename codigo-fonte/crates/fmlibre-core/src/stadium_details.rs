//! Extended stadium reads for the Windows Steam 26620374 fingerprint.
//! Field locations are from Football Manager 27 Editor v1.5.2 (GPL-3.0).
//! Other profiles keep the original stadium reader and editor.

use std::collections::BTreeMap;

use fmlibre_mem::is_user_pointer;
use serde::Serialize;

use crate::clubs::club_stadium;
use crate::{ClubIndex, ClubSummary, FmDate, PluginFingerprint, Session, read_fm_string};

const STEAM: PluginFingerprint = PluginFingerprint::Pe { size_of_image: 0x18878000, link_timestamp: 0x6AF5C68F };
const STADIUM_CLASS: u64 = 0x4F52C08;
const CITY_CLASS: u64 = 0x4F478C8;
const DETAILS_SIZE: usize = 0xB8;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StadiumDirectoryEntry {
    pub stadium_name: String,
    pub stadium_uid: Option<u32>,
    pub city: Option<String>,
    pub country: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum Value {
    Integer(i64),
    Decimal(f64),
    Flag(bool),
    Date(FmDate),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StadiumStand {
    index: usize,
    capacity: u32,
    roof: bool,
    seats: bool,
    tunnel: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StadiumDetails {
    /// Identifies a shared stadium within this connection. The UI never uses this key as a write address.
    key: String,
    #[serde(flatten)]
    place: StadiumDirectoryEntry,
    owner: Option<String>,
    nearby: Option<String>,
    fields: BTreeMap<&'static str, Value>,
    /// None when the profile cannot validate the sector table.
    stands: Option<Vec<StadiumStand>>,
}

impl Session {
    /// A lookup row for the stadium currently assigned to this club.
    pub fn stadium_directory_entry(&self, club: &ClubSummary) -> Option<StadiumDirectoryEntry> {
        let (_, bytes) = self.checked_club_stadium(club)?;
        let layout = self.layout.stadium.as_ref()?;
        let name = read_fm_string(&self.process, u64_at(&bytes, layout.name as usize))?;
        Some(self.stadium_place(&bytes, name))
    }

    /// Reads a stadium through the club and verifies the extended record against the exact build and class.
    pub fn stadium_details(&self, club: &ClubSummary, clubs: &ClubIndex) -> Option<StadiumDetails> {
        let (address, bytes) = self.checked_club_stadium(club)?;
        let layout = self.layout.stadium.as_ref()?;
        let name = read_fm_string(&self.process, u64_at(&bytes, layout.name as usize)).unwrap_or_default();
        let owner_address = u64_at(&bytes, layout.owner as usize);
        let owner = is_user_pointer(owner_address)
            .then(|| self.process.read_u32(owner_address + self.layout.club.uid).ok())
            .flatten()
            .and_then(|uid| clubs.get(uid))
            .filter(|found| found.address == owner_address)
            .map(|found| found.name.clone());
        let mut details = StadiumDetails {
            key: format!("{address:x}"),
            place: self.stadium_place(&bytes, name),
            owner,
            nearby: None,
            fields: BTreeMap::new(),
            stands: None,
        };

        if self.is_extended_stadium(&bytes)
            && let Ok(record) = self.process.read_bytes(address, DETAILS_SIZE)
            && self.is_extended_stadium(&record)
            && record.get(..bytes.len()) == Some(bytes.as_slice())
        {
            let nearby = u64_at(&record, 0x68);
            if self.object_has_class(nearby, STADIUM_CLASS) {
                details.nearby = self
                    .process
                    .read_u64(nearby + layout.name)
                    .ok()
                    .and_then(|name| read_fm_string(&self.process, name));
            }
            details.fields = read_fields(&record);
            let stands = u64_at(&record, 0x20);
            if is_user_pointer(stands)
                && stands % 8 == 0
                && let Ok(data) = self.process.read_bytes(stands, 8 * 8)
                && self.process.read_u64(address + 0x20).ok() == Some(stands)
            {
                details.stands = read_stands(&data);
            }
        }
        Some(details)
    }

    pub fn club_stadium_key(&self, club: &ClubSummary) -> Option<String> {
        self.checked_club_stadium(club).map(|(address, _)| format!("{address:x}"))
    }

    fn checked_club_stadium(&self, club: &ClubSummary) -> Option<(u64, Vec<u8>)> {
        if self.process.read_u32(club.address + self.layout.club.uid).ok()? != club.uid {
            return None;
        }
        club_stadium(&self.process, &self.layout, club.address)
    }

    pub(crate) fn has_extended_stadium_profile(&self) -> bool {
        self.profile.is_some() && self.fingerprint == STEAM
    }

    pub(crate) fn extended_stadium_record(&self, club_address: u64) -> Option<u64> {
        let (address, bytes) = club_stadium(&self.process, &self.layout, club_address)?;
        if !self.is_extended_stadium(&bytes) {
            return None;
        }
        let record = self.process.read_bytes(address, DETAILS_SIZE).ok()?;
        (record.get(..bytes.len()) == Some(bytes.as_slice())).then_some(address)
    }

    pub(crate) fn stadium_stand_record(&self, club_address: u64, index: u8) -> Option<(u64, u32)> {
        let stadium = self.extended_stadium_record(club_address)?;
        let pointer = self.process.read_u64(stadium + 0x20).ok()?;
        if !is_user_pointer(pointer) || pointer % 8 != 0 || index >= 8 {
            return None;
        }
        let data = self.process.read_bytes(pointer, 8 * 8).ok()?;
        let stands = read_stands(&data)?;
        if self.process.read_u64(stadium + 0x20).ok()? != pointer {
            return None;
        }
        Some((pointer + u64::from(index) * 8, stands.iter().map(|stand| stand.capacity).sum()))
    }

    fn is_extended_stadium(&self, bytes: &[u8]) -> bool {
        self.has_extended_stadium_profile()
            && u64_at(bytes, 0) == self.plugin.base + STADIUM_CLASS
            && u32_at(bytes, 0x0C) > 0
            && u32_at(bytes, 0x0C) <= i32::MAX as u32
    }

    fn object_has_class(&self, address: u64, class: u64) -> bool {
        is_user_pointer(address) && self.process.read_u64(address).ok() == Some(self.plugin.base + class)
    }

    fn stadium_place(&self, bytes: &[u8], stadium_name: String) -> StadiumDirectoryEntry {
        let mut place = StadiumDirectoryEntry { stadium_name, stadium_uid: None, city: None, country: None };
        if self.is_extended_stadium(bytes) {
            place.stadium_uid = Some(u32_at(bytes, 0x0C));
            let city = u64_at(bytes, 0x60);
            if self.object_has_class(city, CITY_CLASS) {
                place.city = self.city_at(city).map(|record| record.name);
                let layout = self.layout.city.as_ref();
                place.country = layout
                    .and_then(|city_layout| self.process.read_u64(city + city_layout.nation).ok())
                    .filter(|&nation| is_user_pointer(nation))
                    .and_then(|nation| self.process.read_u64(nation + self.layout.nation.name).ok())
                    .and_then(|name| read_fm_string(&self.process, name));
            }
        }
        place
    }
}

fn u64_at(bytes: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(bytes[offset..offset + 8].try_into().expect("eight bytes"))
}

fn u32_at(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().expect("four bytes"))
}

fn u16_at(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes(bytes[offset..offset + 2].try_into().expect("two bytes"))
}

fn read_fields(bytes: &[u8]) -> BTreeMap<&'static str, Value> {
    let mut fields = BTreeMap::new();
    for (key, offset) in [
        ("decay", 0xAA),
        ("deterioration", 0xAC),
        ("pitchType", 0xAD),
        ("recovery", 0xAE),
        ("environment", 0xB0),
        ("national", 0xB1),
        ("nationalU21", 0xB2),
        ("nationalU19", 0xB3),
        ("ownerType", 0xB4),
    ] {
        fields.insert(key, Value::Integer(bytes[offset].into()));
    }
    let all_seater = u32_at(bytes, 0x88);
    if all_seater <= 300_000 {
        fields.insert("allSeater", Value::Integer(all_seater.into()));
    }
    fields.insert("seatColour", Value::Integer((u32_at(bytes, 0x78) & 0xFF_FF_FF).into()));
    fields.insert("pitchCondition", Value::Integer(u16_at(bytes, 0xA8).into()));
    for (key, offset, min, max) in [("latitude", 0x70, -90.0, 90.0), ("longitude", 0x74, -180.0, 180.0)] {
        let value = f32::from_bits(u32_at(bytes, offset));
        if (min..=max).contains(&value) {
            fields.insert(key, Value::Decimal(value.into()));
        }
    }
    for (key, offset) in [("pitchRelaid", 0x28), ("pitchRelay", 0x2C), ("built", 0x30), ("rebuilt", 0x34)] {
        if let Some(date) = FmDate::from_raw(u16_at(bytes, offset), u16_at(bytes, offset + 2)) {
            fields.insert(key, Value::Date(date));
        }
    }
    for (key, offset) in [
        ("length", 0x98),
        ("width", 0x9A),
        ("internationalLength", 0x9C),
        ("internationalWidth", 0x9E),
        ("minLength", 0xA0),
        ("minWidth", 0xA2),
        ("maxLength", 0xA4),
        ("maxWidth", 0xA6),
    ] {
        let tenths = u16_at(bytes, offset);
        if (1..=2_000).contains(&tenths) {
            fields.insert(key, Value::Decimal(f64::from(tenths) / 10.0));
        }
    }
    for (key, byte, mask) in [
        ("covered", 0xB6, 0x01),
        ("undersoilHeating", 0xB6, 0x02),
        ("extinct", 0xB6, 0x04),
        ("noContinentalFinal", 0xB6, 0x80),
        ("retractableRoof", 0xB6, 0x40),
        ("trainingGround", 0xAB, 0x04),
        ("digitalBoards", 0xAB, 0x40),
    ] {
        fields.insert(key, Value::Flag(bytes[byte] & mask != 0));
    }
    fields
}

fn read_stands(bytes: &[u8]) -> Option<Vec<StadiumStand>> {
    if bytes.len() != 8 * 8 {
        return None;
    }
    let mut stands = Vec::new();
    for (index, bytes) in bytes.chunks_exact(8).enumerate() {
        let capacity = u32_at(bytes, 0);
        let flags = bytes[7];
        if capacity > 200_000 {
            return None;
        }
        if capacity > 0 || flags & 0x1A != 0 {
            stands.push(StadiumStand {
                index,
                capacity,
                roof: flags & 0x10 != 0,
                seats: flags & 0x02 != 0,
                tunnel: flags & 0x08 != 0,
            });
        }
    }
    (stands.iter().map(|stand| stand.capacity).sum::<u32>() <= 300_000).then_some(stands)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_sector_positions_and_rejects_unplausible_records() {
        let mut record = [0; 64];
        record[32..36].copy_from_slice(&4_000u32.to_le_bytes());
        record[39] = 0x1A;
        let stands = read_stands(&record).unwrap();
        assert_eq!(stands.len(), 1);
        assert_eq!((stands[0].index, stands[0].capacity), (4, 4_000));
        assert!(stands[0].roof && stands[0].seats && stands[0].tunnel);
        record[..4].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(read_stands(&record).is_none());
    }

    #[test]
    fn decodes_dimensions_and_flags_without_turning_sentinels_into_values() {
        let mut record = [0; DETAILS_SIZE];
        record[0x98..0x9A].copy_from_slice(&1_055u16.to_le_bytes());
        record[0x9C..0x9E].copy_from_slice(&u16::MAX.to_le_bytes());
        record[0xB6] = 0x41;
        let fields = read_fields(&record);
        assert!(matches!(fields["length"], Value::Decimal(105.5)));
        assert!(!fields.contains_key("internationalLength"));
        assert!(matches!(fields["retractableRoof"], Value::Flag(true)));
    }
}
