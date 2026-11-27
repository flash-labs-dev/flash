//! Port of `shared/trimMarkSnap.ts` and `shared/loopPreview.ts`.

const SNAP_PIXELS: f64 = 6.0;

/// The saved mark within 6 screen pixels of the pointer; the first of two equally close marks wins.
pub fn nearest_trim_mark(
    pointer_x: f64,
    track_left: f64,
    track_width: f64,
    duration_sec: f64,
    marks_sec: &[f64],
    min_sec: f64,
    max_sec: f64,
) -> Option<f64> {
    let finite = [pointer_x, track_left, track_width, duration_sec, min_sec, max_sec]
        .iter()
        .all(|value| value.is_finite());
    if !finite || track_width <= 0.0 || duration_sec <= 0.0 || min_sec > max_sec {
        return None;
    }
    let mut nearest = None;
    let mut distance = f64::INFINITY;
    for &mark in marks_sec {
        if !mark.is_finite() || mark < 0.0 || mark > duration_sec || mark < min_sec || mark > max_sec {
            continue;
        }
        let pixels = (pointer_x - (track_left + mark / duration_sec * track_width)).abs();
        if pixels <= SNAP_PIXELS && pixels < distance {
            nearest = Some(mark);
            distance = pixels;
        }
    }
    nearest
}

/// Where loop preview should seek back to, if playback has reached the out point.
pub fn loop_preview_target(
    current_time: f64,
    in_sec: f64,
    out_sec: f64,
    enabled: bool,
    playing: bool,
) -> Option<f64> {
    (enabled && playing && out_sec > in_sec && current_time >= out_sec).then_some(in_sec)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap(pointer_x: f64, marks: &[f64], min: f64, max: f64) -> Option<f64> {
        nearest_trim_mark(pointer_x, 0.0, 100.0, 10.0, marks, min, max)
    }

    #[test]
    fn snaps_within_six_pixels_only() {
        assert_eq!(snap(44.0, &[5.0], 0.0, 10.0), Some(5.0));
        assert_eq!(snap(43.99, &[5.0], 0.0, 10.0), None);
    }

    #[test]
    fn first_of_a_tie_wins() {
        // Power-of-two scale keeps both distances exactly equal in floating point.
        let tie = |marks: &[f64]| nearest_trim_mark(5.0, 0.0, 16.0, 16.0, marks, 0.0, 16.0);
        assert_eq!(tie(&[4.0, 6.0]), Some(4.0));
        assert_eq!(tie(&[6.0, 4.0]), Some(6.0));
    }

    #[test]
    fn rejects_bad_input_and_marks_outside_the_limits() {
        assert_eq!(snap(f64::NAN, &[5.0], 0.0, 10.0), None);
        assert_eq!(snap(50.0, &[5.0], 0.0, f64::INFINITY), None);
        assert_eq!(nearest_trim_mark(0.0, 0.0, 0.0, 10.0, &[0.0], 0.0, 10.0), None);
        assert_eq!(snap(50.0, &[5.0], 6.0, 10.0), None);
        assert_eq!(snap(50.0, &[5.0], 8.0, 2.0), None);
        assert_eq!(snap(50.0, &[f64::NAN], 0.0, 10.0), None);
    }

    #[test]
    fn loops_only_at_the_end_of_a_real_range() {
        assert_eq!(loop_preview_target(8.0, 2.0, 8.0, true, true), Some(2.0));
        assert_eq!(loop_preview_target(7.9, 2.0, 8.0, true, true), None);
        assert_eq!(loop_preview_target(f64::NAN, 2.0, 8.0, true, true), None);
        assert_eq!(loop_preview_target(8.0, 8.0, 8.0, true, true), None);
        assert_eq!(loop_preview_target(8.0, 2.0, 8.0, false, true), None);
        assert_eq!(loop_preview_target(8.0, 2.0, 8.0, true, false), None);
    }
}
