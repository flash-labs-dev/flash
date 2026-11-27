use crate::audio_lanes::{lower_ascii, priority_lane, AudioLane, AudioLaneConfig};

pub fn audio_app_name(value: &str) -> String {
    let basename = value.rsplit(['/', '\\']).next().unwrap_or(value);
    let mut name = lower_ascii(basename);
    if name.len() > 4 && name.ends_with(".exe") {
        name.truncate(name.len() - 4);
    }
    name
}
pub fn matching_audio_entry<'a>(
    binary: &str,
    application: &str,
    entries: &'a [String],
) -> Option<&'a str> {
    let bin = audio_app_name(binary);
    let app = audio_app_name(application);
    entries
        .iter()
        .find(|entry| {
            let name = audio_app_name(entry);
            name == bin || name == app
        })
        .map(String::as_str)
}
pub fn pipewire_lane(
    binary: &str,
    application: &str,
    game: bool,
    is_self: bool,
    config: &AudioLaneConfig,
) -> AudioLane {
    if let Some(lane) = priority_lane(game, is_self) {
        return lane;
    }
    let discord = |name: &str| {
        matches!(
            name,
            "discord" | "discordcanary" | "discordptb" | "vesktop" | "webcord"
        )
    };
    if discord(&audio_app_name(binary))
        || discord(&audio_app_name(application))
        || matching_audio_entry(binary, application, &config.discord).is_some()
    {
        return AudioLane::Discord;
    }
    if matching_audio_entry(binary, application, &config.music).is_some() {
        return AudioLane::Music;
    }
    AudioLane::Other
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AudioChannelSide {
    Skip,
    Left,
    Right,
    Both,
}
pub fn pipewire_channel(channel: &str) -> AudioChannelSide {
    match channel {
        "FL" | "SL" | "RL" => AudioChannelSide::Left,
        "FR" | "SR" | "RR" => AudioChannelSide::Right,
        "FC" | "MONO" => AudioChannelSide::Both,
        _ => AudioChannelSide::Skip,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn routing_matches_cpp_cases() {
        let config = AudioLaneConfig {
            discord: vec!["discord.exe".into(), "overlap.exe".into()],
            music: vec!["spotify.exe".into(), "overlap.exe".into()],
        };
        assert_eq!(audio_app_name("/Games/Foo.EXE"), "foo");
        assert_eq!(
            matching_audio_entry("wine64-preloader", "Discord.EXE", &config.discord),
            Some("discord.exe")
        );
        for (binary, app, game, self_, expected) in [
            ("wine64-preloader", "Foo.exe", true, false, AudioLane::Game),
            ("spotify.exe", "Spotify", false, true, AudioLane::None),
            ("Foo.exe", "Foo", true, true, AudioLane::None),
            ("overlap.exe", "", false, false, AudioLane::Discord),
            ("webcord", "", false, false, AudioLane::Discord),
            ("discordcanary.exe", "", false, false, AudioLane::Discord),
            ("", "Spotify", false, false, AudioLane::Music),
            ("browser", "", false, false, AudioLane::Other),
        ] {
            assert_eq!(pipewire_lane(binary, app, game, self_, &config), expected);
        }
    }
    #[test]
    fn channel_side() {
        for name in ["FL", "SL", "RL"] {
            assert_eq!(pipewire_channel(name), AudioChannelSide::Left);
        }
        for name in ["FR", "SR", "RR"] {
            assert_eq!(pipewire_channel(name), AudioChannelSide::Right);
        }
        for name in ["FC", "MONO"] {
            assert_eq!(pipewire_channel(name), AudioChannelSide::Both);
        }
        for name in ["LFE", "fl", ""] {
            assert_eq!(pipewire_channel(name), AudioChannelSide::Skip);
        }
    }
}
