#[derive(Clone, Copy, PartialEq, Eq)]
pub enum DevelopmentMinimum {
    NotDue,
    Due,
}

/// A weekly fallback is due only after crossing the game's week boundary and before a reservation exists.
pub fn weekly_minimum_due<W: Ord>(last_read: W, week: W, last_processed: Option<W>) -> bool {
    last_read < week && last_processed.is_none_or(|processed| processed < week)
}

pub(crate) fn requested_ability_bonus(natural: u16, factor: u8, minimum: DevelopmentMinimum) -> u16 {
    let total = natural.saturating_mul(u16::from(factor));
    let floor = if minimum == DevelopmentMinimum::Due { u16::from(factor) } else { 0 };
    total.max(floor).saturating_sub(natural)
}

pub(crate) fn ability_bonus(requested: u16, current: u16, ceiling: u16, budget: u16) -> u16 {
    requested.min(ceiling.saturating_sub(current)).min(budget)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Growth {
    pub ability: u16,
    pub attributes: Vec<u8>,
}

impl Growth {
    /// Extra growth only where both ability and trainable attributes have advanced.
    /// When potential limits the extra ability, scale down the attribute bonus too.
    pub fn accelerated(
        &self,
        peak: &Self,
        potential: u16,
        multiplier: u8,
        budget: u16,
        includes: impl Fn(usize) -> bool,
    ) -> Option<Self> {
        let gain = u32::from(self.ability.checked_sub(peak.ability)?);
        let room = u32::from(potential.checked_sub(self.ability)?);
        let extra = (gain * u32::from(multiplier.saturating_sub(1))).min(room).min(u32::from(budget));
        if extra == 0 {
            return None;
        }
        let attributes: Vec<_> = self
            .attributes
            .iter()
            .zip(&peak.attributes)
            .enumerate()
            .map(|(index, (&now, &before))| {
                if before == 0 || !includes(index) {
                    return now;
                }
                let bonus = u32::from(now.saturating_sub(before)) * extra / gain;
                (u32::from(now) + bonus).min(100) as u8
            })
            .collect();
        (attributes != self.attributes).then_some(Self { ability: self.ability + extra as u16, attributes })
    }

    pub fn observe(&mut self, seen: &Self) {
        self.ability = self.ability.max(seen.ability);
        for (peak, seen) in self.attributes.iter_mut().zip(&seen.attributes) {
            *peak = (*peak).max(*seen);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(ability: u16, attributes: &[u8]) -> Growth {
        Growth { ability, attributes: attributes.to_vec() }
    }

    fn traditional_bonus(natural: u16, current: u16, ceiling: u16, factor: u8, budget: u16) -> u16 {
        ability_bonus(requested_ability_bonus(natural, factor, DevelopmentMinimum::NotDue), current, ceiling, budget)
    }

    #[test]
    fn extra_ca_covers_every_positive_gain_up_to_the_verified_limits() {
        for count in [1, 10, 50] {
            let results =
                (0..count).map(|player| traditional_bonus(1 + player % 3, 120, 170, 5, 200)).collect::<Vec<_>>();
            assert_eq!(results.len(), count as usize);
            assert!(results.into_iter().all(|bonus| [4, 8, 12].contains(&bonus)));
        }
        assert_eq!(traditional_bonus(3, 169, 170, 5, 20), 1);
        assert_eq!(traditional_bonus(3, 169, 170, 5, 0), 0);
        assert_eq!(traditional_bonus(0, 120, 170, 5, 20), 0);
        assert_eq!(traditional_bonus(2, 170, 0, 5, 20), 0);
    }

    #[test]
    fn zero_natural_gain_uses_the_selected_weekly_minimum() {
        use DevelopmentMinimum::*;
        for factor in [1, 2, 5, 10] {
            assert_eq!(requested_ability_bonus(0, factor, NotDue), 0);
            assert_eq!(requested_ability_bonus(0, factor, Due), u16::from(factor));
        }
        let requested = requested_ability_bonus(0, 10, Due);
        assert_eq!(ability_bonus(requested, 168, 170, 200), 2);
        assert_eq!(ability_bonus(requested, 170, 170, 200), 0);
        assert_eq!(ability_bonus(requested, 199, 200, 200), 1);
        assert_eq!(ability_bonus(requested, 120, 170, 3), 3);
        assert_eq!(ability_bonus(requested, 120, 170, 0), 0);
        assert_eq!(ability_bonus(requested, 120, 0, 200), 0);
        assert_eq!(snapshot(120, &[55]).accelerated(&snapshot(120, &[50]), 170, 5, requested, |_| true), None);
    }

    #[test]
    fn a_processed_week_cannot_grant_the_minimum_again() {
        assert!(weekly_minimum_due(10, 11, Some(10)));
        assert!(!weekly_minimum_due(10, 11, Some(11)));
        assert!(!weekly_minimum_due(10, 11, Some(12)));
        assert!(!weekly_minimum_due(11, 11, None));
        assert!(weekly_minimum_due(11, 12, Some(11)));
    }

    #[test]
    fn positive_growth_counts_toward_the_floor_without_stacking() {
        for factor in [1, 2, 5, 10] {
            for natural in [1, 2, 7] {
                let bonus = requested_ability_bonus(natural, factor, DevelopmentMinimum::Due);
                assert_eq!(natural + bonus, natural * u16::from(factor));
                assert_eq!(bonus, requested_ability_bonus(natural, factor, DevelopmentMinimum::NotDue));
            }
        }
    }

    #[test]
    fn five_times_the_gain_adds_four_times_the_observed_increase() {
        let before = snapshot(110, &[50, 70, 65]);
        let after = snapshot(111, &[51, 69, 65]);
        assert_eq!(after.accelerated(&before, 150, 5, u16::MAX, |_| true), Some(snapshot(115, &[55, 69, 65])));
        assert_eq!(after.accelerated(&before, 150, 1, u16::MAX, |_| true), None);
    }

    #[test]
    fn caps_potential_and_attributes_without_reallocating_unset_attributes() {
        let before = snapshot(110, &[96, 54, 0]);
        let after = snapshot(112, &[98, 56, 50]);
        assert_eq!(after.accelerated(&before, 115, 5, u16::MAX, |_| true), Some(snapshot(115, &[100, 59, 50])));
        assert_eq!(after.accelerated(&before, 112, 5, u16::MAX, |_| true), None);
    }

    #[test]
    fn one_hundred_times_is_applied_with_the_same_potential_cap() {
        let before = snapshot(80, &[39, 95]);
        let after = snapshot(81, &[40, 96]);
        assert_eq!(after.accelerated(&before, 200, 100, u16::MAX, |_| true), Some(snapshot(180, &[100, 100])));
        assert_eq!(after.accelerated(&before, 90, 100, u16::MAX, |_| true), Some(snapshot(90, &[49, 100])));
    }

    #[test]
    fn a_dip_and_recovery_does_not_multiply_the_same_gain_again() {
        let mut peak = snapshot(115, &[55, 80]);
        peak.observe(&snapshot(113, &[53, 76]));
        assert_eq!(snapshot(115, &[55, 80]).accelerated(&peak, 150, 5, u16::MAX, |_| true), None);
        assert_eq!(snapshot(116, &[55, 80]).accelerated(&peak, 150, 5, u16::MAX, |_| true), None);
        assert_eq!(snapshot(115, &[56, 80]).accelerated(&peak, 150, 5, u16::MAX, |_| true), None);
    }

    #[test]
    fn focus_only_amplifies_observed_gains_in_matching_attributes() {
        let before = snapshot(110, &[40, 40, 60, 0, 90]);
        let after = snapshot(112, &[42, 44, 58, 10, 99]);
        let result = after.accelerated(&before, 115, 5, 20, |index| index != 1).unwrap();
        assert_eq!(result, snapshot(115, &[45, 44, 58, 10, 100]));
        assert_eq!(after.accelerated(&before, 150, 5, 20, |index| index == 2), None);
        assert_eq!(after.accelerated(&before, 150, 5, 20, |_| false), None);
        assert_eq!(traditional_bonus(2, 112, 115, 5, 20), 3);
    }

    #[test]
    fn weekly_cap_limits_ability_and_scales_attributes_together() {
        let before = snapshot(110, &[50, 75]);
        let after = snapshot(112, &[54, 75]);
        assert_eq!(after.accelerated(&before, 200, 100, 3, |_| true), Some(snapshot(115, &[60, 75])));
        assert_eq!(after.accelerated(&before, 200, 100, 0, |_| true), None);
    }
}
