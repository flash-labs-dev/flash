use std::collections::HashSet;

pub const MAX_CLIP_TAGS: usize = 8;
pub const MAX_TAG_LENGTH: usize = 24;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TagInput {
    String(String),
    Array(Vec<TagInput>),
    Other,
}

pub fn normalize_clip_tags(value: &TagInput) -> Option<Vec<String>> {
    let items = match value {
        TagInput::Array(items) => items,
        _ => return None,
    };

    let mut tags = Vec::new();
    let mut seen = HashSet::new();

    for item in items {
        let raw = match item {
            TagInput::String(value) => value,
            _ => return None,
        };

        let tag = collapse_whitespace(raw.trim_matches(is_js_whitespace));

        if utf16_len(&tag) > MAX_TAG_LENGTH {
            return None;
        }

        if tag.chars().all(is_ignorable) {
            continue;
        }

        let key = tag.to_lowercase();

        if seen.contains(&key) {
            continue;
        }

        if tags.len() == MAX_CLIP_TAGS {
            return None;
        }

        seen.insert(key);
        tags.push(tag);
    }

    Some(tags)
}

pub fn salvage_clip_tags(value: &[TagInput]) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();

    for item in value {
        let mut candidate: Vec<TagInput> = tags
            .iter()
            .map(|tag| TagInput::String(tag.clone()))
            .collect();
        candidate.push(item.clone());

        if let Some(next) = normalize_clip_tags(&TagInput::Array(candidate)) {
            tags = next;
        }
    }

    tags
}

pub fn change_clip_tag(
    existing: &TagInput,
    input: &TagInput,
    action: &TagInput,
) -> Option<Vec<String>> {
    let current = normalize_clip_tags(existing)?;
    let single = normalize_clip_tags(&TagInput::Array(vec![input.clone()]))?;

    if single.len() != 1 {
        return None;
    }

    let action = match action {
        TagInput::String(action) if action == "add" || action == "remove" => action.as_str(),
        _ => return None,
    };

    if action == "remove" {
        let key = single[0].to_lowercase();
        Some(
            current
                .into_iter()
                .filter(|tag| tag.to_lowercase() != key)
                .collect(),
        )
    } else {
        let mut candidate: Vec<TagInput> = current.into_iter().map(TagInput::String).collect();
        candidate.push(TagInput::String(single[0].clone()));
        normalize_clip_tags(&TagInput::Array(candidate))
    }
}

fn collapse_whitespace(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut pending_space = false;

    for c in value.chars() {
        if is_js_whitespace(c) {
            pending_space = !result.is_empty();
        } else {
            if pending_space {
                result.push(' ');
                pending_space = false;
            }
            result.push(c);
        }
    }

    result
}

fn utf16_len(value: &str) -> usize {
    value.chars().map(|c| c.len_utf16()).sum()
}

fn is_ignorable(c: char) -> bool {
    c.is_control() || is_format(c) || is_js_whitespace(c)
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

fn is_format(c: char) -> bool {
    matches!(
        c as u32,
        0x00AD
            | 0x0600..=0x0605
            | 0x061C
            | 0x06DD
            | 0x070F
            | 0x0890..=0x0891
            | 0x08E2
            | 0x180E
            | 0x200B..=0x200F
            | 0x202A..=0x202E
            | 0x2060..=0x2064
            | 0x2066..=0x206F
            | 0xFEFF
            | 0xFFF9..=0xFFFB
            | 0x110BD
            | 0x110CD
            | 0x13430..=0x1343F
            | 0x1BCA0..=0x1BCA3
            | 0x1D173..=0x1D17A
            | 0xE0001
            | 0xE0020..=0xE007F
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn string(value: &str) -> TagInput {
        TagInput::String(value.to_owned())
    }

    fn array(items: Vec<TagInput>) -> TagInput {
        TagInput::Array(items)
    }

    fn strings(items: &[&str]) -> TagInput {
        TagInput::Array(items.iter().map(|item| string(*item)).collect())
    }

    fn values(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_owned()).collect()
    }

    #[test]
    fn normalizes_and_deduplicates_case_insensitively() {
        assert_eq!(
            normalize_clip_tags(&strings(&["  Big   Win ", "big win", "  Boss\tFight  "])),
            Some(values(&["Big Win", "Boss Fight"]))
        );
    }

    #[test]
    fn omits_empty_labels() {
        assert_eq!(
            normalize_clip_tags(&strings(&["", "  ", "One"])),
            Some(values(&["One"]))
        );
    }

    #[test]
    fn accepts_an_empty_array() {
        assert_eq!(normalize_clip_tags(&array(Vec::new())), Some(Vec::new()));
    }

    #[test]
    fn rejects_non_arrays_and_non_string_items() {
        assert_eq!(normalize_clip_tags(&string("one")), None);
        assert_eq!(normalize_clip_tags(&array(vec![TagInput::Other])), None);
    }

    #[test]
    fn enforces_the_length_limit_in_utf16_units() {
        let exactly_24 = "x".repeat(24);
        let over_24 = "x".repeat(25);

        assert_eq!(
            normalize_clip_tags(&strings(&[exactly_24.as_str()])),
            Some(vec![exactly_24.clone()])
        );
        assert_eq!(normalize_clip_tags(&strings(&[over_24.as_str()])), None);

        let twelve_astral = "😀".repeat(12);
        assert_eq!(twelve_astral.chars().count(), 12);
        assert_eq!(twelve_astral.encode_utf16().count(), 24);
        assert_eq!(
            normalize_clip_tags(&strings(&[twelve_astral.as_str()])),
            Some(vec![twelve_astral.clone()])
        );

        let thirteen_astral = "😀".repeat(13);
        assert_eq!(
            normalize_clip_tags(&strings(&[thirteen_astral.as_str()])),
            None
        );
    }

    #[test]
    fn allows_repeated_labels_and_caps_unique_tags() {
        assert_eq!(
            normalize_clip_tags(&array(vec![string("Same"); 9])),
            Some(values(&["Same"]))
        );

        let nine_unique: Vec<TagInput> = (0..9)
            .map(|index| TagInput::String(index.to_string()))
            .collect();
        assert_eq!(normalize_clip_tags(&array(nine_unique)), None);
    }

    #[test]
    fn ignores_control_format_and_whitespace_only_labels() {
        assert_eq!(
            normalize_clip_tags(&strings(&["\u{200b}", "\u{0007}", "One"])),
            Some(values(&["One"]))
        );
        assert_eq!(
            normalize_clip_tags(&strings(&["\u{00ad}"])),
            Some(Vec::new())
        );
    }

    #[test]
    fn uses_javascript_whitespace_for_trimming_and_collapsing() {
        assert_eq!(
            normalize_clip_tags(&strings(&["\u{feff}  One  \u{feff}"])),
            Some(values(&["One"]))
        );
        assert_eq!(
            normalize_clip_tags(&strings(&["A\u{00a0}\u{00a0}B"])),
            Some(values(&["A B"]))
        );
    }

    #[test]
    fn salvages_readable_tags_from_bad_entries() {
        let input = vec![
            string("Win"),
            string(&"x".repeat(25)),
            TagInput::Other,
            string("win"),
            string("Boss"),
        ];

        assert_eq!(salvage_clip_tags(&input), values(&["Win", "Boss"]));
    }

    #[test]
    fn changes_tags() {
        assert_eq!(
            change_clip_tag(&strings(&["Win"]), &string(" win "), &string("add")),
            Some(values(&["Win"]))
        );
        assert_eq!(
            change_clip_tag(
                &strings(&["Win", "Boss"]),
                &string(" WIN "),
                &string("remove")
            ),
            Some(values(&["Boss"]))
        );
        assert_eq!(
            change_clip_tag(&strings(&["Win"]), &string("New"), &string("add")),
            Some(values(&["Win", "New"]))
        );
    }

    #[test]
    fn rejects_invalid_tag_changes() {
        let eight: Vec<TagInput> = (0..8)
            .map(|index| TagInput::String(index.to_string()))
            .collect();

        assert_eq!(
            change_clip_tag(&array(eight), &string("Extra"), &string("add")),
            None
        );
        assert_eq!(
            change_clip_tag(&array(Vec::new()), &string("   "), &string("add")),
            None
        );
        assert_eq!(
            change_clip_tag(&array(Vec::new()), &string("Win"), &string("replace")),
            None
        );
    }
}
