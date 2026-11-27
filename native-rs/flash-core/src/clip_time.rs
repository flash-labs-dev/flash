//! Library time filter cutoffs (port of shared/clipTime.ts).

const DAY_MS: i64 = 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClipTimeRange {
    Any,
    Today,
    Days7,
    Days30,
}

/// std has no local timezone, so the caller supplies local midnight of `now`.
pub fn range_cutoff(range: ClipTimeRange, now: i64, today_start_ms: i64) -> Option<i64> {
    match range {
        ClipTimeRange::Any => None,
        ClipTimeRange::Today => Some(today_start_ms),
        ClipTimeRange::Days7 => Some(now - 7 * DAY_MS),
        ClipTimeRange::Days30 => Some(now - 30 * DAY_MS),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cutoffs() {
        let now = 1_700_123_456_789;
        let today = 1_700_092_800_000;
        assert_eq!(range_cutoff(ClipTimeRange::Any, now, today), None);
        assert_eq!(range_cutoff(ClipTimeRange::Today, now, today), Some(today));
        assert_eq!(range_cutoff(ClipTimeRange::Days7, now, today), Some(now - 604_800_000));
        assert_eq!(range_cutoff(ClipTimeRange::Days30, now, today), Some(now - 2_592_000_000));
    }
}
