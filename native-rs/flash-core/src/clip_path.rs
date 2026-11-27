//! Clip and screenshot file naming (port of shared/clipPath.ts).

use std::collections::HashSet;

use crate::sanitise::Value;

const SIDECAR_KEYS: [&str; 7] = [
    "duration",
    "game",
    "marksSec",
    "trim",
    "starred",
    "tags",
    "cachedShare",
];

/// File names fold case only where the file system usually does (shared/clipsRoot.ts).
pub(crate) fn case_key(value: &str, platform: &str) -> String {
    if platform == "win32" || platform == "darwin" {
        value.to_lowercase()
    } else {
        value.to_string()
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FileStat {
    pub birthtime_ms: f64,
    pub mtime_ms: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalDateTime {
    pub year: i32,
    pub month: u32,
    pub day: u32,
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
}

fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{0009}'
            | '\u{000A}'
            | '\u{000B}'
            | '\u{000C}'
            | '\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
}

pub(crate) fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| is_js_whitespace(c))
}

fn is_forbidden(c: char) -> bool {
    matches!(
        c,
        '\0'..='\u{1f}' | '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
    )
}

pub fn sidecar_path(file_path: &str) -> String {
    format!("{file_path}.json")
}

pub fn is_flash_clip_name(file_name: &str) -> bool {
    let bytes = file_name.as_bytes();
    if bytes.len() < 19 {
        return false;
    }

    for index in [0usize, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18] {
        if !bytes[index].is_ascii_digit() {
            return false;
        }
    }

    if bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'_'
        || bytes[13] != b'-'
        || bytes[16] != b'-'
    {
        return false;
    }

    let mut index = 19;

    if index < bytes.len() && bytes[index] == b'_' {
        index += 1;
        let suffix_start = index;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        if index == suffix_start {
            return false;
        }
    }

    if index >= bytes.len() || bytes[index] != b'.' {
        return false;
    }
    index += 1;

    if bytes.len() - index != 3 {
        return false;
    }

    let extension = &bytes[index..];
    extension.eq_ignore_ascii_case(b"mp4") || extension.eq_ignore_ascii_case(b"png")
}

/// `sidecar` is the parsed JSON, or `None` when the file has no sidecar. Anything
/// unrecognised returns false, which keeps the clip safe from auto-delete.
pub fn is_flash_clip(file_name: &str, sidecar: Option<&Value>) -> bool {
    let items = match sidecar {
        None => return is_flash_clip_name(file_name),
        Some(Value::Object(items)) => items,
        Some(_) => return false,
    };
    if items.iter().any(|(k, _)| !SIDECAR_KEYS.contains(&k.as_str())) {
        return false;
    }
    let get = |key: &str| items.iter().rev().find(|(k, _)| k == key).map(|(_, v)| v);
    let game = match get("game") {
        Some(Value::String(game)) => game.as_str(),
        _ => "",
    };
    let has_duration =
        matches!(get("duration"), Some(Value::Number(d)) if d.is_finite() && *d >= 0.0);
    is_flash_clip_name(file_name) || (has_duration && !game.is_empty()) || game == "Shared clip"
}

pub fn clip_created_at(stat: FileStat) -> f64 {
    if stat.birthtime_ms > 0.0 {
        stat.birthtime_ms
    } else if stat.mtime_ms > 0.0 {
        stat.mtime_ms
    } else {
        0.0
    }
}

pub fn clip_timestamp(when: LocalDateTime) -> String {
    format!(
        "{}-{:02}-{:02}_{:02}-{:02}-{:02}",
        when.year, when.month, when.day, when.hour, when.minute, when.second
    )
}

pub fn game_folder_name(game: &str, platform: &str) -> String {
    let replaced: String = js_trim(game)
        .chars()
        .map(|c| if is_forbidden(c) { '_' } else { c })
        .collect();
    let windows = platform == "win32";
    // Windows silently drops trailing dots and spaces.
    let safe = if windows {
        replaced.trim_end_matches(['.', ' '])
    } else {
        replaced.as_str()
    };
    if safe.is_empty() {
        return "Unknown".to_string();
    }
    let device = safe.split('.').next().unwrap_or("").to_ascii_lowercase();
    let reserved = matches!(device.as_str(), "con" | "prn" | "aux" | "nul")
        || (device.len() == 4
            && (device.starts_with("com") || device.starts_with("lpt"))
            && matches!(device.as_bytes()[3], b'1'..=b'9'));
    if windows && reserved {
        format!("_{safe}")
    } else {
        safe.to_string()
    }
}

pub fn numbered_name(stem: &str, counter: i64, extension: &str) -> String {
    if counter <= 1 {
        format!("{stem}{extension}")
    } else {
        format!("{stem}_{counter}{extension}")
    }
}

pub fn first_free_name(stem: &str, extension: &str, taken: &[String], platform: &str) -> String {
    let used: HashSet<String> = taken.iter().map(|name| case_key(name, platform)).collect();

    let mut counter: i64 = 1;
    loop {
        let candidate = numbered_name(stem, counter, extension);
        if !used.contains(&case_key(&candidate, platform))
            && !used.contains(&case_key(&sidecar_path(&candidate), platform))
        {
            return candidate;
        }
        counter += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidecar_path_appends_json() {
        assert_eq!(sidecar_path("clip.mp4"), "clip.mp4.json");
        assert_eq!(sidecar_path(""), ".json");
        assert_eq!(sidecar_path("a.b.png"), "a.b.png.json");
    }

    #[test]
    fn is_flash_clip_name_accepts_timestamp_names() {
        assert!(is_flash_clip_name("2026-11-26_09-08-07.mp4"));
        assert!(is_flash_clip_name("2026-11-26_09-08-07.png"));
        assert!(is_flash_clip_name("2026-11-26_09-08-07_1.mp4"));
        assert!(is_flash_clip_name("2026-11-26_09-08-07_42.PNG"));
        assert!(is_flash_clip_name("0000-99-99_99-99-99_0001.mp4"));
        assert!(is_flash_clip_name("2026-13-99_25-61-61.mp4"));
    }

    #[test]
    fn is_flash_clip_name_rejects_other_names() {
        assert!(!is_flash_clip_name("clip.mp4"));
        assert!(!is_flash_clip_name("2026-11-26_09-08-07"));
        assert!(!is_flash_clip_name("2026-11-26_09-08-07.mkv"));
        assert!(!is_flash_clip_name("2026-11-26_09-08-07.mp4x"));
        assert!(!is_flash_clip_name("2026-11-26_09-08-07.mp4 "));
        assert!(!is_flash_clip_name("2026-11-26_09-08-07.mp4\n"));
        assert!(!is_flash_clip_name("2026-11-26_09-08-07_.mp4"));
        assert!(!is_flash_clip_name("2026-11-26_09-08-07_1_2.mp4"));
        assert!(!is_flash_clip_name("x2026-11-26_09-08-07.mp4"));
        assert!(!is_flash_clip_name("\u{ff12}\u{ff10}\u{ff12}\u{ff16}-11-26_09-08-07.mp4"));
    }

    #[test]
    fn is_flash_clip_honours_sidecar() {
        let object = |items: &[(&str, Value)]| {
            Value::Object(items.iter().map(|(k, v)| (k.to_string(), v.clone())).collect())
        };
        let text = |s: &str| Value::String(s.to_string());
        let named = "2026-11-26_09-08-07.mp4";
        assert!(is_flash_clip(named, None));
        assert!(!is_flash_clip("anything.mov", None));
        assert!(is_flash_clip(named, Some(&object(&[]))));
        assert!(!is_flash_clip("anything.mov", Some(&object(&[]))));
        assert!(!is_flash_clip(named, Some(&Value::Array(vec![]))));
        assert!(!is_flash_clip(named, Some(&object(&[("newField", Value::Bool(true))]))));
        let full = object(&[("duration", Value::Number(1.0)), ("game", text("Arena"))]);
        assert!(is_flash_clip("anything.mp4", Some(&full)));
        for duration in [-1.0, f64::NAN, f64::INFINITY] {
            let bad = object(&[("duration", Value::Number(duration)), ("game", text("Arena"))]);
            assert!(!is_flash_clip("anything.mp4", Some(&bad)));
        }
        let shared = object(&[("game", text("Shared clip"))]);
        assert!(is_flash_clip("anything.mp4", Some(&shared)));
    }

    #[test]
    fn first_free_name_keeps_case_on_linux() {
        let taken = vec!["CLIP.MP4".to_string()];
        assert_eq!(first_free_name("clip", ".mp4", &taken, "linux"), "clip.mp4");
    }

    #[test]
    fn clip_created_at_prefers_birthtime() {
        assert_eq!(
            clip_created_at(FileStat {
                birthtime_ms: 100.0,
                mtime_ms: 200.0,
            }),
            100.0
        );
    }

    #[test]
    fn clip_created_at_falls_back_to_mtime() {
        assert_eq!(
            clip_created_at(FileStat {
                birthtime_ms: 0.0,
                mtime_ms: 200.0,
            }),
            200.0
        );
        assert_eq!(
            clip_created_at(FileStat {
                birthtime_ms: -1.0,
                mtime_ms: 200.0,
            }),
            200.0
        );
        assert_eq!(
            clip_created_at(FileStat {
                birthtime_ms: f64::NAN,
                mtime_ms: 200.0,
            }),
            200.0
        );
    }

    #[test]
    fn clip_created_at_reports_unknown_as_zero() {
        assert_eq!(
            clip_created_at(FileStat {
                birthtime_ms: 0.0,
                mtime_ms: 0.0,
            }),
            0.0
        );
        assert_eq!(
            clip_created_at(FileStat {
                birthtime_ms: -1.0,
                mtime_ms: -2.0,
            }),
            0.0
        );
    }

    #[test]
    fn clip_timestamp_formats_local_components() {
        assert_eq!(
            clip_timestamp(LocalDateTime {
                year: 2026,
                month: 11,
                day: 26,
                hour: 9,
                minute: 8,
                second: 7,
            }),
            "2026-11-26_09-08-07"
        );
        assert_eq!(
            clip_timestamp(LocalDateTime {
                year: 2026,
                month: 1,
                day: 2,
                hour: 0,
                minute: 3,
                second: 4,
            }),
            "2026-01-02_00-03-04"
        );
        assert_eq!(
            clip_timestamp(LocalDateTime {
                year: 999,
                month: 12,
                day: 31,
                hour: 23,
                minute: 59,
                second: 59,
            }),
            "999-12-31_23-59-59"
        );
    }

    #[test]
    fn game_folder_name_trims_javascript_whitespace() {
        assert_eq!(game_folder_name("  Game  ", "win32"), "Game");
        assert_eq!(game_folder_name("\u{feff}Game\u{feff}", "win32"), "Game");
        assert_eq!(game_folder_name("\t\nGame\r\n", "win32"), "Game");
        assert_eq!(
            game_folder_name("\u{0085}Game\u{0085}", "win32"),
            "\u{0085}Game\u{0085}"
        );
        assert_eq!(game_folder_name("\u{2028}Game\u{2029}", "win32"), "Game");
    }

    #[test]
    fn game_folder_name_falls_back_to_unknown() {
        assert_eq!(game_folder_name("", "win32"), "Unknown");
        assert_eq!(game_folder_name("   ", "win32"), "Unknown");
        assert_eq!(game_folder_name("\u{feff}\u{00a0}", "win32"), "Unknown");
        assert_eq!(game_folder_name("\u{0085}", "win32"), "\u{0085}");
    }

    #[test]
    fn game_folder_name_replaces_forbidden_characters() {
        assert_eq!(
            game_folder_name("a<b>c:d\"e/f\\g|h?i*j", "win32"),
            "a_b_c_d_e_f_g_h_i_j"
        );
        assert_eq!(game_folder_name("  A:B  ", "win32"), "A_B");
        assert_eq!(game_folder_name("::", "win32"), "__");
    }

    #[test]
    fn game_folder_name_applies_windows_rules_only_on_windows() {
        assert_eq!(game_folder_name("R.E.P.O.", "win32"), "R.E.P.O");
        assert_eq!(game_folder_name("R.E.P.O.", "linux"), "R.E.P.O.");
        assert_eq!(game_folder_name("..", "win32"), "Unknown");
        assert_eq!(game_folder_name("NUL.txt", "win32"), "_NUL.txt");
        assert_eq!(game_folder_name("CON", "linux"), "CON");
        assert_eq!(game_folder_name("A\u{1}B", "win32"), "A_B");
    }

    #[test]
    fn numbered_name_matches_native_counter() {
        assert_eq!(numbered_name("clip", 1, ".mp4"), "clip.mp4");
        assert_eq!(numbered_name("clip", 0, ".mp4"), "clip.mp4");
        assert_eq!(numbered_name("clip", -3, ".mp4"), "clip.mp4");
        assert_eq!(numbered_name("clip", 2, ".mp4"), "clip_2.mp4");
        assert_eq!(numbered_name("shot", 123, ".png"), "shot_123.png");
    }

    #[test]
    fn first_free_name_starts_at_one() {
        assert_eq!(first_free_name("clip", ".mp4", &[], "win32"), "clip.mp4");
    }

    #[test]
    fn first_free_name_skips_existing_and_sidecars() {
        let taken = vec!["clip.mp4".to_string()];
        assert_eq!(first_free_name("clip", ".mp4", &taken, "win32"), "clip_2.mp4");

        let taken = vec!["CLIP.MP4".to_string()];
        assert_eq!(first_free_name("clip", ".mp4", &taken, "win32"), "clip_2.mp4");

        let taken = vec!["clip.mp4.json".to_string()];
        assert_eq!(first_free_name("clip", ".mp4", &taken, "win32"), "clip_2.mp4");

        let taken = vec![
            "clip.mp4".to_string(),
            "clip_2.mp4".to_string(),
            "clip_3.mp4.json".to_string(),
        ];
        assert_eq!(first_free_name("clip", ".mp4", &taken, "win32"), "clip_4.mp4");
    }
}
