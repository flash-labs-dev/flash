//! Bookmarked moments in a clip (port of shared/clipMarks.ts).

/// Convert wall-clock marks to positions in the clip captured at `save_time_ms`.
///
/// Returns an empty vector if `save_time_ms` or `duration_sec` is not finite,
/// or if `duration_sec` is not positive.
///
/// The resulting offsets are clamped to `[0, duration_sec]` and expressed in
/// seconds.
///
/// # Parameters
/// - `mark_times_ms`: slice of mark timestamps (ms).
/// - `save_time_ms`: the wall-clock time at which the clip is saved (ms).
/// - `duration_sec`: duration of the clip (seconds).
pub fn clip_mark_offsets(mark_times_ms: &[f64], save_time_ms: f64, duration_sec: f64) -> Vec<f64> {
    if !save_time_ms.is_finite() || !duration_sec.is_finite() || duration_sec <= 0.0 {
        return Vec::new();
    }

    let start_ms = save_time_ms - duration_sec * 1000.0;

    mark_times_ms
        .iter()
        .filter(|&&mark| mark.is_finite() && mark >= start_ms && mark <= save_time_ms)
        .map(|&mark| {
            let offset = (mark - start_ms) / 1000.0;
            // clamp to [0, duration_sec]
            offset.max(0.0).min(duration_sec)
        })
        .collect()
}

/// Transfer clip marks that lie within a window `[start_sec, start_sec + duration_sec]`.
///
/// Returns an empty vector if either `start_sec` or `duration_sec` is not finite,
/// or if either is negative.
///
/// The resulting marks are relative to `start_sec`.
pub fn transfer_clip_marks(marks_sec: &[f64], start_sec: f64, duration_sec: f64) -> Vec<f64> {
    if !start_sec.is_finite()
        || !duration_sec.is_finite()
        || start_sec < 0.0
        || duration_sec < 0.0
    {
        return Vec::new();
    }

    marks_sec
        .iter()
        .filter(|&&mark| {
            mark.is_finite() && mark >= start_sec && (mark - start_sec) <= duration_sec
        })
        .map(|&mark| mark - start_sec)
        .collect()
}

/// Result of attempting to record a new clip mark.
#[derive(Debug, PartialEq)]
pub struct RecordResult {
    /// The (possibly filtered) list of marks after the operation.
    pub marks: Vec<f64>,
    /// Whether a new mark was recorded (`true`) or not (`false`).
    pub recorded: bool,
    /// The updated timestamp of the last press (always set to `now_ms`).
    pub last_press_ms: f64,
}

/// Record a new clip mark if the quiet interval has elapsed.
///
/// If `now_ms` or `buffer_length_sec` is not finite, or if `buffer_length_sec`
/// is not positive, the function returns the original marks unchanged,
/// `recorded` set to `false`, and the original `last_press_ms`.
///
/// Otherwise, marks outside the buffer window are discarded. If the time since
/// `last_press_ms` is <= 500 ms, the quiet interval is still considered active:
/// no new mark is added, but `last_press_ms` is updated to `now_ms`.
///
/// If the quiet interval has elapsed, `now_ms` is appended to the filtered
/// marks, `recorded` is `true`, and `last_press_ms` is updated to `now_ms`.
pub fn record_clip_mark(
    marks_ms: &[f64],
    now_ms: f64,
    buffer_length_sec: f64,
    last_press_ms: f64,
) -> RecordResult {
    if !now_ms.is_finite() || !buffer_length_sec.is_finite() || buffer_length_sec <= 0.0 {
        return RecordResult {
            marks: marks_ms.to_vec(),
            recorded: false,
            last_press_ms,
        };
    }

    let lower_bound = now_ms - buffer_length_sec * 1000.0;
    let mut filtered: Vec<f64> = marks_ms
        .iter()
        .filter(|&&mark| mark.is_finite() && mark >= lower_bound && mark <= now_ms)
        .cloned()
        .collect();

    // Every repeat renews the quiet interval, including a rejected one.
    if now_ms - last_press_ms <= 500.0 {
        return RecordResult {
            marks: filtered,
            recorded: false,
            last_press_ms: now_ms,
        };
    }

    filtered.push(now_ms);
    RecordResult {
        marks: filtered,
        recorded: true,
        last_press_ms: now_ms,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAVE: f64 = 100_000.0;

    #[test]
    fn offsets_inside_the_clip_window() {
        let marks = [69_999.0, 70_000.0, 85_250.0, 100_000.0, 100_001.0];
        assert_eq!(clip_mark_offsets(&marks, SAVE, 30.0), [0.0, 15.25, 30.0]);
        assert_eq!(clip_mark_offsets(&[85_250.0, 95_000.0], SAVE, 10.0), [5.0]);
        assert!(clip_mark_offsets(&[85_250.0], SAVE, 0.0).is_empty());
        assert!(clip_mark_offsets(&[f64::NAN, f64::INFINITY], SAVE, 30.0).is_empty());
    }

    #[test]
    fn transfers_marks_into_a_trim() {
        let marks = [4.99, 5.0, 9.0, 13.9, 14.2, 14.49, 15.0];
        assert_eq!(transfer_clip_marks(&marks, 5.0, 9.49), [0.0, 4.0, 8.9, 9.2, 9.49]);
        assert!(transfer_clip_marks(&marks, -1.0, 9.49).is_empty());
        assert!(transfer_clip_marks(&marks, 5.0, f64::NAN).is_empty());
    }

    #[test]
    fn repeats_renew_the_quiet_interval() {
        let mut result = record_clip_mark(&[], 10_000.0, 30.0, f64::NEG_INFINITY);
        assert!(result.recorded);
        for now in [10_100.0, 10_500.0, 10_900.0, 11_300.0] {
            result = record_clip_mark(&result.marks, now, 30.0, result.last_press_ms);
            assert!(!result.recorded);
            assert_eq!(result.marks, [10_000.0]);
            assert_eq!(result.last_press_ms, now);
        }
        result = record_clip_mark(&result.marks, 11_801.0, 30.0, result.last_press_ms);
        assert!(result.recorded);
        assert_eq!(result.marks, [10_000.0, 11_801.0]);
        let trimmed = record_clip_mark(&[10_000.0, 15_000.0], 20_000.0, 5.0, 15_000.0);
        assert_eq!(trimmed.marks, [15_000.0, 20_000.0]);
    }
}
