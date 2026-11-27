use std::cmp::Ordering;

const KEEP_NEWEST: usize = 3;

#[derive(Debug, Clone)]
pub struct StorageClip {
    pub file_path: String,
    pub size: f64,
    pub created_at: f64,
    pub eligible: bool,
}

pub fn prune_storage_clips(
    clips: &[StorageClip],
    max_bytes: f64,
    mut remove: impl FnMut(&str) -> bool,
    on_limit_cannot_be_met: Option<&mut dyn FnMut()>,
) -> usize {
    if !max_bytes.is_finite() || max_bytes <= 0.0 {
        return 0;
    }

    let mut used = 0.0f64;
    for clip in clips {
        if clip.size.is_finite() && clip.size >= 0.0 {
            used += clip.size;
        }
    }

    let mut candidates: Vec<&StorageClip> = clips
        .iter()
        .filter(|clip| {
            clip.eligible
                && clip.created_at > 0.0
                && clip.created_at.is_finite()
                && clip.size.is_finite()
                && clip.size >= 0.0
        })
        .collect();

    candidates.sort_by(|a, b| {
        a.created_at
            .partial_cmp(&b.created_at)
            .unwrap_or(Ordering::Equal)
            // Byte order, not localeCompare: only matters for equal timestamps.
            .then_with(|| a.file_path.as_str().cmp(b.file_path.as_str()))
    });

    let keep = candidates.len().saturating_sub(KEEP_NEWEST);
    let (removable, _) = candidates.split_at(keep);
    let removable_sum: f64 = removable.iter().map(|clip| clip.size).sum();

    if used > max_bytes && used - removable_sum > max_bytes {
        if let Some(callback) = on_limit_cannot_be_met {
            callback();
        }
        return 0;
    }

    let mut removed = 0usize;
    for clip in removable {
        if used <= max_bytes {
            break;
        }
        if remove(clip.file_path.as_str()) {
            used -= clip.size;
            removed += 1;
        }
    }

    removed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clip(file_path: &str, size: f64, created_at: f64, eligible: bool) -> StorageClip {
        StorageClip {
            file_path: file_path.to_string(),
            size,
            created_at,
            eligible,
        }
    }

    #[test]
    fn empty_library_is_noop() {
        let clips: Vec<StorageClip> = Vec::new();
        let removed = prune_storage_clips(&clips, 10.0, |_| true, None);
        assert_eq!(removed, 0);
    }

    #[test]
    fn non_positive_or_non_finite_limit_is_noop() {
        for limit in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 0.0, -1.0] {
            let clips = vec![clip("a", 10.0, 1.0, true)];
            let mut calls = 0;
            let mut limit_hits = 0;
            let removed = prune_storage_clips(
                &clips,
                limit,
                |_| {
                    calls += 1;
                    true
                },
                Some(&mut || limit_hits += 1),
            );
            assert_eq!(removed, 0);
            assert_eq!(calls, 0);
            assert_eq!(limit_hits, 0);
        }
    }

    #[test]
    fn used_at_or_below_limit_is_noop() {
        let clips = vec![
            clip("a", 10.0, 1.0, true),
            clip("b", 5.0, 2.0, true),
            clip("c", 5.0, 3.0, true),
            clip("d", 5.0, 4.0, true),
        ];
        let mut calls = 0;
        let removed = prune_storage_clips(
            &clips,
            25.0,
            |_| {
                calls += 1;
                true
            },
            None,
        );
        assert_eq!(removed, 0);
        assert_eq!(calls, 0);
    }

    #[test]
    fn non_finite_or_negative_sizes_are_ignored_for_usage() {
        let clips = vec![
            clip("nan", f64::NAN, 1.0, true),
            clip("neg", -5.0, 2.0, true),
            clip("inf", f64::INFINITY, 3.0, true),
            clip("ok", 10.0, 4.0, true),
        ];
        let mut calls = 0;
        let mut limit_hits = 0;
        let removed = prune_storage_clips(
            &clips,
            5.0,
            |_| {
                calls += 1;
                true
            },
            Some(&mut || limit_hits += 1),
        );
        assert_eq!(removed, 0);
        assert_eq!(calls, 0);
        assert_eq!(limit_hits, 1);
    }

    #[test]
    fn ineligible_or_invalid_created_at_clips_are_never_removed() {
        let clips = vec![
            clip("v1", 10.0, 1.0, true),
            clip("v2", 10.0, 2.0, true),
            clip("v3", 10.0, 3.0, true),
            clip("v4", 10.0, 4.0, true),
            clip("v5", 10.0, 5.0, true),
            clip("ineligible", 0.0, 1.0, false),
            clip("zero", 0.0, 0.0, true),
            clip("negative", 0.0, -1.0, true),
            clip("nan", 0.0, f64::NAN, true),
            clip("inf", 0.0, f64::INFINITY, true),
        ];
        let mut removed_paths = Vec::new();
        let removed = prune_storage_clips(
            &clips,
            35.0,
            |path| {
                removed_paths.push(path.to_string());
                true
            },
            None,
        );
        assert_eq!(removed, 2);
        assert_eq!(removed_paths, vec!["v1".to_string(), "v2".to_string()]);
    }

    #[test]
    fn keeps_newest_three() {
        let clips = vec![
            clip("c1", 10.0, 1.0, true),
            clip("c2", 10.0, 2.0, true),
            clip("c3", 10.0, 3.0, true),
            clip("c4", 10.0, 4.0, true),
            clip("c5", 10.0, 5.0, true),
        ];
        let mut removed_paths = Vec::new();
        let removed = prune_storage_clips(
            &clips,
            35.0,
            |path| {
                removed_paths.push(path.to_string());
                true
            },
            None,
        );
        assert_eq!(removed, 2);
        assert_eq!(removed_paths, vec!["c1".to_string(), "c2".to_string()]);
    }

    #[test]
    fn sorts_by_created_at_then_path() {
        let clips = vec![
            clip("b", 10.0, 1.0, true),
            clip("a", 10.0, 1.0, true),
            clip("e", 10.0, 2.0, true),
            clip("d", 10.0, 2.0, true),
            clip("c", 10.0, 2.0, true),
        ];
        let mut removed_paths = Vec::new();
        let removed = prune_storage_clips(
            &clips,
            35.0,
            |path| {
                removed_paths.push(path.to_string());
                true
            },
            None,
        );
        assert_eq!(removed, 2);
        assert_eq!(removed_paths, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn reports_unmet_limit_without_removing() {
        let clips = vec![
            clip("a", 10.0, 1.0, true),
            clip("b", 10.0, 2.0, true),
            clip("c", 10.0, 3.0, true),
            clip("d", 10.0, 4.0, true),
        ];
        let mut calls = 0;
        let mut limit_hits = 0;
        let removed = prune_storage_clips(
            &clips,
            20.0,
            |_| {
                calls += 1;
                true
            },
            Some(&mut || limit_hits += 1),
        );
        assert_eq!(removed, 0);
        assert_eq!(calls, 0);
        assert_eq!(limit_hits, 1);
    }

    #[test]
    fn reaching_the_limit_exactly_prunes() {
        let clips = vec![
            clip("a", 10.0, 1.0, true),
            clip("b", 10.0, 2.0, true),
            clip("c", 10.0, 3.0, true),
            clip("d", 10.0, 4.0, true),
        ];
        let mut limit_hits = 0;
        let removed = prune_storage_clips(
            &clips,
            30.0,
            |_| true,
            Some(&mut || limit_hits += 1),
        );
        assert_eq!(removed, 1);
        assert_eq!(limit_hits, 0);
    }

    #[test]
    fn unmet_limit_without_callback_is_safe() {
        let clips = vec![
            clip("a", 10.0, 1.0, true),
            clip("b", 10.0, 2.0, true),
            clip("c", 10.0, 3.0, true),
            clip("d", 10.0, 4.0, true),
        ];
        let removed = prune_storage_clips(&clips, 10.0, |_| true, None);
        assert_eq!(removed, 0);
    }

    #[test]
    fn refused_candidate_does_not_block_next() {
        let clips = vec![
            clip("a", 10.0, 1.0, true),
            clip("b", 10.0, 2.0, true),
            clip("c", 10.0, 3.0, true),
            clip("d", 10.0, 4.0, true),
            clip("e", 10.0, 5.0, true),
        ];
        let mut calls = Vec::new();
        let removed = prune_storage_clips(
            &clips,
            35.0,
            |path| {
                calls.push(path.to_string());
                path != "a"
            },
            None,
        );
        assert_eq!(removed, 1);
        assert_eq!(calls, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn stops_once_under_limit() {
        let clips = vec![
            clip("a", 40.0, 1.0, true),
            clip("b", 10.0, 2.0, true),
            clip("c", 10.0, 3.0, true),
            clip("d", 10.0, 4.0, true),
            clip("e", 10.0, 5.0, true),
        ];
        let mut calls = Vec::new();
        let removed = prune_storage_clips(
            &clips,
            50.0,
            |path| {
                calls.push(path.to_string());
                true
            },
            None,
        );
        assert_eq!(removed, 1);
        assert_eq!(calls, vec!["a".to_string()]);
    }

    #[test]
    fn infinite_size_counts_as_zero_and_cannot_be_removed() {
        let clips = vec![
            clip("inf", f64::INFINITY, 1.0, true),
            clip("a", 10.0, 2.0, true),
            clip("b", 10.0, 3.0, true),
            clip("c", 10.0, 4.0, true),
            clip("d", 10.0, 5.0, true),
            clip("e", 10.0, 6.0, true),
        ];
        let mut calls = Vec::new();
        let removed = prune_storage_clips(
            &clips,
            35.0,
            |path| {
                calls.push(path.to_string());
                true
            },
            None,
        );
        assert_eq!(removed, 2);
        assert_eq!(calls, vec!["a".to_string(), "b".to_string()]);
    }
}
