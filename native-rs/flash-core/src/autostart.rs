//! Port of `shared/autostart.ts`.
//! The marker can only turn autostart on, never off.

#[derive(Debug, Clone, Copy)]
pub struct AutostartInput {
    pub installer_requested: bool,
    pub marker_consumed: bool,
    pub currently_enabled: bool,
    pub packaged: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AutostartDecision {
    pub apply: bool,
    pub consume_marker: bool,
}

pub fn decide_autostart(input: AutostartInput) -> AutostartDecision {
    let pending = input.packaged && input.installer_requested && !input.marker_consumed;
    AutostartDecision {
        apply: pending && !input.currently_enabled,
        consume_marker: pending,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_input_combination_follows_the_typescript_rules() {
        for bits in 0..16u8 {
            let [requested, consumed, enabled, packaged] = [0, 1, 2, 3].map(|i| bits & (1 << i) != 0);
            let expected = if !packaged || !requested || consumed {
                (false, false)
            } else if enabled {
                (false, true)
            } else {
                (true, true)
            };
            let got = decide_autostart(AutostartInput {
                installer_requested: requested,
                marker_consumed: consumed,
                currently_enabled: enabled,
                packaged,
            });
            assert_eq!((got.apply, got.consume_marker), expected, "bits {bits}");
        }
    }
}
