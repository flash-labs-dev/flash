//! Clip name validation and collision-free file names (port of shared/rename.ts).

use crate::clip_path::{case_key, js_trim};

/// Returns `None` if `name` is a valid clip name, otherwise returns an
/// appropriate error message.
///
/// The validation rules are:
/// - Name must not be empty after trimming whitespace.
/// - Name must not consist solely of one or more dots.
/// - Name must not contain any of the characters `\ / : * ? " < > |`.
/// - Name must not be a Windows-reserved device name (`CON`, `PRN`, `AUX`,
///   `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`) possibly followed by a dot.
/// - Name must not end with a space or a dot.
pub fn validate_clip_name(name: &str) -> Option<&'static str> {
    let trimmed = js_trim(name);

    if trimmed.is_empty() {
        return Some("Enter a name");
    }

    if trimmed.chars().all(|c| c == '.') {
        return Some("A name cannot contain only dots");
    }

    // The raw name, so a trailing tab or newline is refused rather than trimmed away.
    if name.bytes().any(|b| {
        b < 0x20 || matches!(b, b'\\' | b'/' | b':' | b'*' | b'?' | b'"' | b'<' | b'>' | b'|')
    }) {
        return Some("Names cannot contain \\ / : * ? \" < > or |");
    }

    if is_reserved_device_name(trimmed) {
        return Some("That name is reserved by Windows");
    }

    if name.ends_with(' ') || name.ends_with('.') {
        return Some("Names cannot end with a dot or space");
    }

    None
}

/// Resolves a filename that does not clash with any of `existing_filenames`.
///
/// `extension` should include the leading dot (e.g. ".txt").
/// Collisions ignore case on Windows and macOS only.
pub fn resolve_clip_filename(
    name: &str,
    extension: &str,
    existing_filenames: &[&str],
    platform: &str,
) -> String {
    let existing: std::collections::HashSet<String> = existing_filenames
        .iter()
        .map(|s| case_key(s, platform))
        .collect();

    let mut counter = 1usize;
    loop {
        let suffix = if counter == 1 {
            String::new()
        } else {
            format!(" ({})", counter)
        };
        let basename = format!("{}{}", name, suffix);

        // The three candidate filenames we must ensure are all absent.
        let candidate1 = format!("{}{}", basename, extension);
        let candidate2 = format!("{}{}{}", basename, extension, ".json");
        let candidate3 = format!("{}.json", basename);

        if !existing.contains(&case_key(&candidate1, platform))
            && !existing.contains(&case_key(&candidate2, platform))
            && !existing.contains(&case_key(&candidate3, platform))
        {
            return candidate1;
        }

        counter += 1;
    }
}

// ------------------------------------------------------------------------
// Helper functions (private)
// ------------------------------------------------------------------------

fn is_reserved_device_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();

    // Simple names that must match exactly or be followed by a dot.
    const SIMPLE: &[&str] = &["con", "prn", "aux", "nul"];
    for &prefix in SIMPLE {
        if lower == prefix || lower.starts_with(&format!("{}.", prefix)) {
            return true;
        }
    }

    // COM1-COM9 and LPT1-LPT9
    if lower.starts_with("com") && lower.len() >= 4 {
        let digit = lower.as_bytes()[3];
        if (b'1'..=b'9').contains(&digit) {
            if lower.len() == 4 || lower.as_bytes()[4] == b'.' {
                return true;
            }
        }
    }
    if lower.starts_with("lpt") && lower.len() >= 4 {
        let digit = lower.as_bytes()[3];
        if (b'1'..=b'9').contains(&digit) {
            if lower.len() == 4 || lower.as_bytes()[4] == b'.' {
                return true;
            }
        }
    }

    false
}

// ------------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_empty() {
        assert_eq!(validate_clip_name("   "), Some("Enter a name"));
    }

    #[test]
    fn test_validate_only_dots() {
        assert_eq!(validate_clip_name(".."), Some("A name cannot contain only dots"));
    }

    #[test]
    fn test_validate_forbidden_chars() {
        let chars = r#"\ / : * ? " < > |"#.split_whitespace();
        for c in chars {
            let s = format!("test{}name", c);
            assert_eq!(
                validate_clip_name(&s),
                Some("Names cannot contain \\ / : * ? \" < > or |")
            );
        }
    }

    #[test]
    fn test_validate_reserved_names() {
        let reserved = [
            "con", "CON", "Con.", "prn", "aux.", "nul", "COM1", "com2.", "lpt9", "LPT3.",
        ];
        for name in &reserved {
            assert_eq!(
                validate_clip_name(name),
                Some("That name is reserved by Windows"),
                "failed on {}",
                name
            );
        }
    }

    #[test]
    fn test_validate_trailing_dot_or_space() {
        assert_eq!(
            validate_clip_name("test "),
            Some("Names cannot end with a dot or space")
        );
        assert_eq!(
            validate_clip_name("test."),
            Some("Names cannot end with a dot or space")
        );
    }

    #[test]
    fn test_validate_valid_name() {
        assert_eq!(validate_clip_name("my_clip-01"), None);
    }

    #[test]
    fn test_validate_matches_typescript_whitespace_and_controls() {
        assert_eq!(validate_clip_name("\u{feff}"), Some("Enter a name"));
        assert_eq!(validate_clip_name("\u{0085}"), None);
        for name in ["a\nb", "a\u{0}b", "clip\t"] {
            assert_eq!(
                validate_clip_name(name),
                Some("Names cannot contain \\ / : * ? \" < > or |")
            );
        }
    }

    #[test]
    fn test_resolve_keeps_case_on_linux() {
        assert_eq!(
            resolve_clip_filename("myclip", ".txt", &["MYCLIP.TXT"], "linux"),
            "myclip.txt"
        );
        assert_eq!(
            resolve_clip_filename("myclip", ".txt", &["MYCLIP.TXT"], "darwin"),
            "myclip (2).txt"
        );
    }

    #[test]
    fn test_resolve_no_collision() {
        let existing = &["other.txt", "another.json"];
        let result = resolve_clip_filename("myclip", ".txt", existing, "win32");
        assert_eq!(result, "myclip.txt");
    }

    #[test]
    fn test_resolve_collision_with_json_variants() {
        let existing = &[
            "myclip.txt",
            "myclip.txt.json",
            "myclip.json",
            "myclip (2).txt",
            "myclip (2).txt.json",
            "myclip (2).json",
        ];
        let result = resolve_clip_filename("myclip", ".txt", existing, "win32");
        // The first free name should be "myclip (3).txt"
        assert_eq!(result, "myclip (3).txt");
    }

    #[test]
    fn test_resolve_non_ascii_case() {
        assert_eq!(
            resolve_clip_filename("\u{e9}t\u{e9}", ".mp4", &["\u{c9}T\u{c9}.mp4"], "win32"),
            "\u{e9}t\u{e9} (2).mp4"
        );
    }

    #[test]
    fn test_resolve_case_insensitivity() {
        let existing = &["MyClip.txt", "MYCLIP.JSON", "myclip (2).txt"];
        let result = resolve_clip_filename("myclip", ".txt", existing, "win32");
        // "myclip.txt" collides case-insensitively, as does "myclip (2).txt"
        // So we get "myclip (3).txt"
        assert_eq!(result, "myclip (3).txt");
    }
}
