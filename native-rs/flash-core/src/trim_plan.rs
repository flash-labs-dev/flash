#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TrimRange {
    pub in_sec: f64,
    pub out_sec: f64,
}

pub fn valid_trim_range(value: Option<TrimRange>, duration_sec: f64) -> Option<TrimRange> {
    let value = value?;
    if !duration_sec.is_finite() || duration_sec <= 0.0 {
        return None;
    }
    let TrimRange { in_sec, out_sec } = value;
    if in_sec.is_finite()
        && out_sec.is_finite()
        && in_sec >= 0.0
        && in_sec < duration_sec
        && out_sec > in_sec
        && out_sec <= duration_sec + 0.25
    {
        Some(TrimRange {
            in_sec,
            out_sec: out_sec.min(duration_sec),
        })
    } else {
        None
    }
}

pub fn estimated_copy_bytes(source_bytes: f64, duration_sec: f64, trim: TrimRange) -> Option<f64> {
    let range = valid_trim_range(Some(trim), duration_sec)?;
    if !source_bytes.is_finite() || source_bytes <= 0.0 {
        return None;
    }
    Some((source_bytes * (range.out_sec - range.in_sec) / duration_sec).round())
}

pub fn clamp_range(in_sec: f64, out_sec: f64, duration_sec: f64, min_span_sec: f64) -> TrimRange {
    let duration = if duration_sec.is_finite() && duration_sec > 0.0 {
        duration_sec
    } else {
        0.0
    };
    let clamp = |value: f64, fallback: f64| {
        let value = if value.is_finite() { value } else { fallback };
        value.max(0.0).min(duration)
    };
    let mut start = clamp(in_sec, 0.0);
    let mut end = clamp(out_sec, duration);
    if end - start < min_span_sec {
        if start + min_span_sec <= duration {
            end = start + min_span_sec;
        } else {
            end = duration;
            start = (duration - min_span_sec).max(0.0);
        }
    }
    TrimRange {
        in_sec: start,
        out_sec: end,
    }
}

pub fn nearest_keyframe(keyframes_sec: &[f64], seconds: f64, tolerance_sec: f64) -> Option<f64> {
    let mut best = None;
    let mut best_distance = f64::INFINITY;
    for &key in keyframes_sec {
        let distance = (key - seconds).abs();
        if distance <= tolerance_sec && distance < best_distance {
            best = Some(key);
            best_distance = distance;
        }
    }
    best
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaveReason {
    None,
    Trim,
    Audio,
    Video,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SaveMode {
    pub lossless: bool,
    pub reason: SaveReason,
}

pub fn derive_save_mode(in_on_keyframe: bool, gains: &[f64], saturation: f64) -> SaveMode {
    if saturation != 100.0 {
        return SaveMode {
            lossless: false,
            reason: SaveReason::Video,
        };
    }
    if gains.iter().any(|&gain| gain != 1.0) {
        return SaveMode {
            lossless: false,
            reason: SaveReason::Audio,
        };
    }
    if !in_on_keyframe {
        return SaveMode {
            lossless: false,
            reason: SaveReason::Trim,
        };
    }
    SaveMode {
        lossless: true,
        reason: SaveReason::None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9, "{} != {}", a, b);
    }

    #[test]
    fn valid_range_rejects_missing_value() {
        assert_eq!(valid_trim_range(None, 10.0), None);
    }

    #[test]
    fn valid_range_rejects_bad_duration() {
        let r = TrimRange { in_sec: 0.0, out_sec: 1.0 };
        assert_eq!(valid_trim_range(Some(r), f64::NAN), None);
        assert_eq!(valid_trim_range(Some(r), f64::INFINITY), None);
        assert_eq!(valid_trim_range(Some(r), 0.0), None);
        assert_eq!(valid_trim_range(Some(r), -1.0), None);
    }

    #[test]
    fn valid_range_rejects_non_finite_fields() {
        let r = TrimRange { in_sec: f64::NAN, out_sec: 1.0 };
        assert_eq!(valid_trim_range(Some(r), 10.0), None);
        let r = TrimRange { in_sec: 0.0, out_sec: f64::INFINITY };
        assert_eq!(valid_trim_range(Some(r), 10.0), None);
    }

    #[test]
    fn valid_range_rejects_out_of_bounds() {
        let r = TrimRange { in_sec: -0.1, out_sec: 1.0 };
        assert_eq!(valid_trim_range(Some(r), 10.0), None);
        let r = TrimRange { in_sec: 10.0, out_sec: 11.0 };
        assert_eq!(valid_trim_range(Some(r), 10.0), None);
        let r = TrimRange { in_sec: 2.0, out_sec: 2.0 };
        assert_eq!(valid_trim_range(Some(r), 10.0), None);
    }

    #[test]
    fn valid_range_rejects_beyond_tolerance() {
        let r = TrimRange { in_sec: 0.0, out_sec: 10.26 };
        assert_eq!(valid_trim_range(Some(r), 10.0), None);
    }

    #[test]
    fn valid_range_allows_twenty_five_ms_over_duration() {
        let r = TrimRange { in_sec: 0.0, out_sec: 10.25 };
        let got = valid_trim_range(Some(r), 10.0).unwrap();
        close(got.out_sec, 10.0);
    }

    #[test]
    fn valid_range_accepts_and_clamps_final_frame() {
        let r = TrimRange { in_sec: 1.0, out_sec: 10.2 };
        let got = valid_trim_range(Some(r), 10.0).unwrap();
        close(got.in_sec, 1.0);
        close(got.out_sec, 10.0);
    }

    #[test]
    fn estimated_rejects_bad_source() {
        let trim = TrimRange { in_sec: 0.0, out_sec: 5.0 };
        assert_eq!(estimated_copy_bytes(f64::NAN, 10.0, trim), None);
        assert_eq!(estimated_copy_bytes(f64::INFINITY, 10.0, trim), None);
        assert_eq!(estimated_copy_bytes(0.0, 10.0, trim), None);
        assert_eq!(estimated_copy_bytes(-1.0, 10.0, trim), None);
    }

    #[test]
    fn estimated_rejects_invalid_trim() {
        let trim = TrimRange { in_sec: 5.0, out_sec: 5.0 };
        assert_eq!(estimated_copy_bytes(1000.0, 10.0, trim), None);
    }

    #[test]
    fn estimated_rounds_proportional_bytes() {
        let trim = TrimRange { in_sec: 2.5, out_sec: 7.5 };
        assert_eq!(estimated_copy_bytes(1000.0, 10.0, trim), Some(500.0));
        let trim = TrimRange { in_sec: 0.0, out_sec: 1.0 };
        assert_eq!(estimated_copy_bytes(3.0, 2.0, trim), Some(2.0));
    }

    #[test]
    fn clamp_orders_and_limits_range() {
        let r = clamp_range(-5.0, 25.0, 10.0, 0.1);
        close(r.in_sec, 0.0);
        close(r.out_sec, 10.0);
    }

    #[test]
    fn clamp_uses_zero_for_bad_duration() {
        let r = clamp_range(2.0, 5.0, f64::NAN, 0.1);
        close(r.in_sec, 0.0);
        close(r.out_sec, 0.0);
    }

    #[test]
    fn clamp_falls_back_for_non_finite_values() {
        let r = clamp_range(f64::INFINITY, f64::NEG_INFINITY, 10.0, 0.1);
        close(r.in_sec, 0.0);
        close(r.out_sec, 10.0);
    }

    #[test]
    fn clamp_enforces_min_span_when_equal() {
        let r = clamp_range(4.0, 4.0, 10.0, 0.1);
        close(r.in_sec, 4.0);
        close(r.out_sec, 4.1);
    }

    #[test]
    fn clamp_enforces_min_span_at_end() {
        let r = clamp_range(9.98, 10.0, 10.0, 0.1);
        close(r.in_sec, 9.9);
        close(r.out_sec, 10.0);
    }

    #[test]
    fn nearest_returns_closest_within_tolerance() {
        assert_eq!(nearest_keyframe(&[0.0, 1.0, 2.0], 1.04, 0.05), Some(1.0));
    }

    #[test]
    fn nearest_rejects_outside_tolerance() {
        assert_eq!(nearest_keyframe(&[0.0, 1.0], 1.06, 0.05), None);
    }

    #[test]
    fn nearest_handles_empty() {
        assert_eq!(nearest_keyframe(&[], 1.0, 1.0), None);
    }

    #[test]
    fn nearest_ignores_non_finite_seconds() {
        assert_eq!(nearest_keyframe(&[1.0], f64::NAN, 1.0), None);
    }

    #[test]
    fn nearest_keeps_first_on_tie() {
        assert_eq!(nearest_keyframe(&[1.0, 3.0], 2.0, 1.5), Some(1.0));
    }

    #[test]
    fn save_mode_flags_saturation() {
        assert_eq!(
            derive_save_mode(true, &[1.0], 101.0),
            SaveMode { lossless: false, reason: SaveReason::Video }
        );
        assert_eq!(
            derive_save_mode(true, &[1.0], 99.0).reason,
            SaveReason::Video
        );
    }

    #[test]
    fn save_mode_flags_non_finite_saturation() {
        assert_eq!(
            derive_save_mode(true, &[1.0], f64::NAN).reason,
            SaveReason::Video
        );
    }

    #[test]
    fn save_mode_flags_gain() {
        assert_eq!(
            derive_save_mode(true, &[1.0, 1.2], 100.0).reason,
            SaveReason::Audio
        );
        assert_eq!(
            derive_save_mode(true, &[f64::NAN], 100.0).reason,
            SaveReason::Audio
        );
    }

    #[test]
    fn save_mode_flags_off_keyframe() {
        assert_eq!(
            derive_save_mode(false, &[1.0], 100.0),
            SaveMode { lossless: false, reason: SaveReason::Trim }
        );
    }

    #[test]
    fn save_mode_is_lossless_when_everything_matches() {
        assert_eq!(
            derive_save_mode(true, &[1.0, 1.0], 100.0),
            SaveMode { lossless: true, reason: SaveReason::None }
        );
        assert_eq!(
            derive_save_mode(true, &[], 100.0),
            SaveMode { lossless: true, reason: SaveReason::None }
        );
    }
}
