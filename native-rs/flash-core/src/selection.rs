//! Clip multi-selection (port of shared/selection.ts).

use std::collections::HashSet;

/// Returns a new `HashSet` based on `selected` where `id` has been toggled:
/// * If `id` was present, it is removed.
/// * If `id` was absent, it is inserted.
///
/// The original set is not modified.
pub fn toggle_selection(selected: &HashSet<String>, id: &str) -> HashSet<String> {
    let mut next = selected.clone();
    if next.contains(id) {
        next.remove(id);
    } else {
        next.insert(id.to_string());
    }
    next
}

/// Returns a new `HashSet` based on `selected` that additionally contains the
/// range of IDs between `anchor_id` and `target_id` (inclusive) as they appear
/// in `displayed_ids`.
///
/// * If `target_id` is not present in `displayed_ids`, the original set is
///   returned unchanged.
/// * If `anchor_id` is `None` or not present in `displayed_ids`, only
///   `target_id` is added.
/// * Otherwise, all IDs from the smaller index to the larger index (inclusive)
///   are added.
///
/// The original set is not modified.
pub fn select_range(
    selected: &HashSet<String>,
    displayed_ids: &[&str],
    anchor_id: Option<&str>,
    target_id: &str,
) -> HashSet<String> {
    let mut next = selected.clone();

    // Find the index of the target ID; if not found, return unchanged.
    let target_index = displayed_ids.iter().position(|&id| id == target_id);
    let target_index = match target_index {
        Some(idx) => idx,
        None => return next,
    };

    // Determine the anchor index.
    let anchor_index = match anchor_id {
        None => None,
        Some(aid) => displayed_ids.iter().position(|&id| id == aid),
    };

    // If anchor is missing, just add the target.
    let start = match anchor_index {
        None => {
            next.insert(target_id.to_string());
            return next;
        }
        Some(idx) => idx,
    };

    // Compute range bounds.
    let (lo, hi) = if start <= target_index {
        (start, target_index)
    } else {
        (target_index, start)
    };

    // Add every displayed ID within the range (inclusive).
    for &id in &displayed_ids[lo..=hi] {
        next.insert(id.to_string());
    }

    next
}

/// Returns a new, empty `HashSet`.
pub fn clear_selection() -> HashSet<String> {
    HashSet::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_toggle_selection_adds_when_missing() {
        let selected = HashSet::new();
        let result = toggle_selection(&selected, "a");
        let mut expected = HashSet::new();
        expected.insert("a".to_string());
        assert_eq!(result, expected);
    }

    #[test]
    fn test_toggle_selection_removes_when_present() {
        let mut selected = HashSet::new();
        selected.insert("a".to_string());
        let result = toggle_selection(&selected, "a");
        let expected = HashSet::new();
        assert_eq!(result, expected);
    }

    #[test]
    fn test_select_range_target_not_present() {
        let selected = HashSet::new();
        let displayed = ["x", "y", "z"];
        let result = select_range(&selected, &displayed, Some("x"), "missing");
        assert_eq!(result, selected);
    }

    #[test]
    fn test_select_range_no_anchor_adds_only_target() {
        let selected = HashSet::new();
        let displayed = ["a", "b", "c"];
        let result = select_range(&selected, &displayed, None, "b");
        let mut expected = HashSet::new();
        expected.insert("b".to_string());
        assert_eq!(result, expected);
    }

    #[test]
    fn test_select_range_anchor_not_found_adds_only_target() {
        let selected = HashSet::new();
        let displayed = ["a", "b", "c"];
        let result = select_range(&selected, &displayed, Some("missing"), "b");
        let mut expected = HashSet::new();
        expected.insert("b".to_string());
        assert_eq!(result, expected);
    }

    #[test]
    fn test_select_range_forward_range() {
        let mut selected = HashSet::new();
        selected.insert("x".to_string());
        let displayed = ["a", "b", "c", "d"];
        let result = select_range(&selected, &displayed, Some("b"), "d");
        let mut expected = HashSet::new();
        expected.insert("x".to_string());
        expected.insert("b".to_string());
        expected.insert("c".to_string());
        expected.insert("d".to_string());
        assert_eq!(result, expected);
    }

    #[test]
    fn test_select_range_reverse_range() {
        let selected = HashSet::new();
        let displayed = ["a", "b", "c", "d"];
        let result = select_range(&selected, &displayed, Some("d"), "b");
        let mut expected = HashSet::new();
        expected.insert("b".to_string());
        expected.insert("c".to_string());
        expected.insert("d".to_string());
        assert_eq!(result, expected);
    }

    #[test]
    fn test_clear_selection() {
        let mut set = HashSet::new();
        set.insert("something".to_string());
        let cleared = clear_selection();
        assert!(cleared.is_empty());
    }
}
