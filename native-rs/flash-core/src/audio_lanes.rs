#[derive(Clone, Debug, Default)]
pub struct AudioLaneConfig {
    pub discord: Vec<String>,
    pub music: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AudioLane {
    Game,
    Discord,
    Music,
    Other,
    None,
}

pub fn lower_ascii(text: &str) -> String {
    text.chars()
        .map(|c| {
            if c.is_ascii_uppercase() {
                c.to_ascii_lowercase()
            } else {
                c
            }
        })
        .collect()
}
pub fn audio_lane_track(lane: AudioLane) -> &'static str {
    match lane {
        AudioLane::Game => "game",
        AudioLane::Discord => "discord",
        AudioLane::Music => "music",
        AudioLane::Other => "other",
        AudioLane::None => "",
    }
}
// Flash's process tree must never be captured, even if it also matches the game.
pub(crate) fn priority_lane(in_game_tree: bool, is_self: bool) -> Option<AudioLane> {
    if is_self {
        Some(AudioLane::None)
    } else if in_game_tree {
        Some(AudioLane::Game)
    } else {
        None
    }
}
pub fn lane_for_app(
    exe: &str,
    in_game_tree: bool,
    is_self: bool,
    config: &AudioLaneConfig,
) -> AudioLane {
    if let Some(lane) = priority_lane(in_game_tree, is_self) {
        return lane;
    }
    let name = lower_ascii(exe);
    if config.discord.contains(&name) {
        AudioLane::Discord
    } else if config.music.contains(&name) {
        AudioLane::Music
    } else {
        AudioLane::Other
    }
}

#[derive(Clone, Debug, Default)]
pub struct ProcessInfo {
    pub pid: u32,
    pub parent_pid: u32,
    pub exe: String,
    pub start_ticks: i64,
}

fn find(processes: &[ProcessInfo], pid: u32) -> Option<&ProcessInfo> {
    processes.iter().find(|p| p.pid == pid)
}
fn parent<'a>(processes: &'a [ProcessInfo], child: &ProcessInfo) -> Option<&'a ProcessInfo> {
    if child.parent_pid == 0 || child.parent_pid == child.pid {
        return None;
    }
    let parent = find(processes, child.parent_pid)?;
    if parent.start_ticks != 0 && child.start_ticks != 0 && parent.start_ticks > child.start_ticks {
        return None;
    }
    Some(parent)
}
pub fn app_root(pid: u32, processes: &[ProcessInfo]) -> u32 {
    let Some(mut current) = find(processes, pid) else {
        return pid;
    };
    for _ in 0..64 {
        let Some(next) = parent(processes, current) else {
            break;
        };
        if lower_ascii(&next.exe) != lower_ascii(&current.exe) {
            break;
        }
        current = next;
    }
    current.pid
}
pub fn is_in_process_tree(pid: u32, ancestor_pid: u32, processes: &[ProcessInfo]) -> bool {
    if ancestor_pid == 0 {
        return false;
    }
    if pid == ancestor_pid {
        return true;
    }
    let mut current = find(processes, pid);
    for _ in 0..64 {
        let Some(p) = current else {
            break;
        };
        if p.pid == ancestor_pid {
            return true;
        }
        current = parent(processes, p);
    }
    false
}
pub fn has_captured_descendant(
    root: u32,
    other_roots: &[u32],
    game_pid: u32,
    processes: &[ProcessInfo],
) -> bool {
    (game_pid != 0 && game_pid != root && is_in_process_tree(game_pid, root, processes))
        || other_roots
            .iter()
            .any(|&other| other != root && is_in_process_tree(other, root, processes))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn p(pid: u32, parent_pid: u32, exe: &str, start_ticks: i64) -> ProcessInfo {
        ProcessInfo {
            pid,
            parent_pid,
            exe: exe.into(),
            start_ticks,
        }
    }
    #[test]
    fn route_priority_and_track_names() {
        let config = AudioLaneConfig {
            discord: vec!["discord.exe".into(), "overlap.exe".into()],
            music: vec!["spotify.exe".into(), "overlap.exe".into()],
        };
        assert_eq!(
            lane_for_app("spotify.exe", true, true, &config),
            AudioLane::None
        );
        assert_eq!(
            lane_for_app("discord.exe", false, true, &config),
            AudioLane::None
        );
        assert_eq!(
            lane_for_app("overlap.exe", false, false, &config),
            AudioLane::Discord
        );
        assert_eq!(
            lane_for_app("Spotify.exe", false, false, &config),
            AudioLane::Music
        );
        assert_eq!(
            lane_for_app("chrome.exe", false, false, &config),
            AudioLane::Other
        );
        assert_eq!(lower_ascii("DiscOrd.EXE"), "discord.exe");
        for (lane, name) in [
            (AudioLane::Game, "game"),
            (AudioLane::Discord, "discord"),
            (AudioLane::Music, "music"),
            (AudioLane::Other, "other"),
            (AudioLane::None, ""),
        ] {
            assert_eq!(audio_lane_track(lane), name);
        }
    }
    #[test]
    fn self_exclusion_precedes_game_in_both_routers() {
        let config = AudioLaneConfig::default();
        for (game, self_, expected) in [
            (true, true, AudioLane::None),
            (true, false, AudioLane::Game),
            (false, true, AudioLane::None),
            (false, false, AudioLane::Other),
        ] {
            assert_eq!(lane_for_app("Flash.exe", game, self_, &config), expected);
            assert_eq!(
                crate::pipewire_audio_route::pipewire_lane(
                    "Flash.exe",
                    "Flash",
                    game,
                    self_,
                    &config
                ),
                expected
            );
        }
    }
    #[test]
    fn process_roots_and_trees() {
        let all = vec![
            p(100, 4, "explorer.exe", 10),
            p(200, 100, "Discord.exe", 20),
            p(201, 200, "Discord.exe", 21),
            p(202, 200, "discord.exe", 22),
            p(203, 202, "Discord.exe", 23),
            p(300, 100, "RocketLeague.exe", 30),
            p(301, 300, "EasyAntiCheat.exe", 31),
            p(302, 301, "helper.exe", 32),
        ];
        for pid in [200, 201, 202, 203] {
            assert_eq!(app_root(pid, &all), 200);
        }
        assert_eq!(app_root(301, &all), 301);
        assert_eq!(app_root(999, &all), 999);
        for pid in [300, 301, 302] {
            assert!(is_in_process_tree(pid, 300, &all));
        }
        assert!(!is_in_process_tree(200, 300, &all));
        assert!(!is_in_process_tree(300, 0, &all));
        assert!(is_in_process_tree(4242, 4242, &all));
    }
    #[test]
    fn reused_pid_loop_and_descendants() {
        let reused = vec![p(50, 0, "Spotify.exe", 500), p(60, 50, "Spotify.exe", 100)];
        assert_eq!(app_root(60, &reused), 60);
        assert!(!is_in_process_tree(60, 50, &reused));
        let looped = vec![p(1, 2, "a.exe", 0), p(2, 1, "a.exe", 0)];
        assert!([1, 2].contains(&app_root(1, &looped)));
        assert!(!is_in_process_tree(1, 77, &looped));
        let tree = vec![
            p(400, 0, "steam.exe", 40),
            p(402, 400, "game.exe", 42),
            p(600, 0, "a.exe", 60),
            p(601, 600, "b.exe", 61),
            p(602, 601, "c.exe", 62),
        ];
        assert!(has_captured_descendant(400, &[400], 402, &tree));
        assert!(!has_captured_descendant(400, &[400], 0, &tree));
        assert!(has_captured_descendant(600, &[600, 601, 602], 0, &tree));
        assert!(!has_captured_descendant(602, &[600, 601, 602], 0, &tree));
    }
}
