pub const AUDIO_TRACK_ORDER: [&str; 5] = ["game", "mic", "other", "discord", "music"];
pub const AUDIO_TRACK_COUNT: usize = AUDIO_TRACK_ORDER.len();

pub fn audio_track_index(id: &str) -> usize {
    AUDIO_TRACK_ORDER
        .iter()
        .position(|name| *name == id)
        .unwrap_or(AUDIO_TRACK_COUNT)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stable_file_order_and_exact_lookup() {
        assert_eq!(
            AUDIO_TRACK_ORDER,
            ["game", "mic", "other", "discord", "music"]
        );
        for (i, name) in AUDIO_TRACK_ORDER.iter().enumerate() {
            assert_eq!(audio_track_index(name), i);
        }
        for name in ["Game", "", "system"] {
            assert_eq!(audio_track_index(name), AUDIO_TRACK_COUNT);
        }
    }
}
