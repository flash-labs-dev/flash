//! Thumbnail position from shared/thumbnailTime.ts.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ThumbnailTime {
    pub time_sec: f64,
    pub from_mark: bool,
}

/// Use the first finite mark within the duration; otherwise sample near the
/// start. This preserves JavaScript's `durationSec || 1` fallback for zero and
/// NaN, and its negative-duration result.
pub fn thumbnail_time(marks_sec: &[f64], duration_sec: f64) -> ThumbnailTime {
    if duration_sec.is_finite() && duration_sec >= 0.0 {
        if let Some(mark) = marks_sec.iter().copied().find(|mark| {
            mark.is_finite() && *mark >= 0.0 && *mark <= duration_sec
        }) {
            return ThumbnailTime { time_sec: mark, from_mark: true };
        }
    }
    let duration = if duration_sec == 0.0 || duration_sec.is_nan() { 1.0 } else { duration_sec };
    ThumbnailTime { time_sec: 0.5_f64.min(duration / 2.0), from_mark: false }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn original_cases() {
        assert_eq!(thumbnail_time(&[], 10.0), ThumbnailTime { time_sec: 0.5, from_mark: false });
        assert_eq!(thumbnail_time(&[], 0.6), ThumbnailTime { time_sec: 0.3, from_mark: false });
        assert_eq!(thumbnail_time(&[f64::NAN, -1.0, f64::INFINITY, 11.0, 4.0, 2.0], 10.0), ThumbnailTime { time_sec: 4.0, from_mark: true });
        assert_eq!(thumbnail_time(&[10.0, 2.0], 10.0), ThumbnailTime { time_sec: 10.0, from_mark: true });
        assert_eq!(thumbnail_time(&[0.0], 10.0), ThumbnailTime { time_sec: 0.0, from_mark: true });
        assert_eq!(thumbnail_time(&[11.0, -1.0], 10.0), ThumbnailTime { time_sec: 0.5, from_mark: false });
        assert_eq!(thumbnail_time(&[2.0], f64::NAN), ThumbnailTime { time_sec: 0.5, from_mark: false });
    }

    #[test]
    fn fallback_edge_cases() {
        assert_eq!(thumbnail_time(&[], 0.0).time_sec, 0.5);
        assert_eq!(thumbnail_time(&[], -0.0).time_sec, 0.5);
        assert_eq!(thumbnail_time(&[], -2.0).time_sec, -1.0);
        assert_eq!(thumbnail_time(&[], f64::INFINITY).time_sec, 0.5);
        assert_eq!(thumbnail_time(&[], f64::NEG_INFINITY).time_sec, f64::NEG_INFINITY);
        assert_eq!(thumbnail_time(&[-0.0], 0.0), ThumbnailTime { time_sec: -0.0, from_mark: true });
    }
}
