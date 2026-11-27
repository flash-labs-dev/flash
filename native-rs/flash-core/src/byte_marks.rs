const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ByteRange {
    Full { start: i64, end: i64 },
    Partial { start: i64, end: i64 },
    Unsatisfiable,
}

fn parse_digit_string(digits: &str) -> Option<i64> {
    let mut value: u64 = 0;
    for byte in digits.bytes() {
        value = value.checked_mul(10)?.checked_add(u64::from(byte - b'0'))?;
        if value > MAX_SAFE_INTEGER as u64 {
            return None;
        }
    }
    Some(value as i64)
}

pub fn byte_range(header: Option<&str>, size: i64) -> ByteRange {
    let header = match header {
        Some(value) if !value.is_empty() => value,
        _ => {
            return ByteRange::Full {
                start: 0,
                end: size.saturating_sub(1),
            }
        }
    };

    let spec = match header.trim().strip_prefix("bytes=") {
        Some(spec) => spec,
        None => return ByteRange::Unsatisfiable,
    };

    let hyphen = match spec.find('-') {
        Some(index) => index,
        None => return ByteRange::Unsatisfiable,
    };
    if spec[hyphen + 1..].contains('-') {
        return ByteRange::Unsatisfiable;
    }

    let first_digits = &spec[..hyphen];
    let last_digits = &spec[hyphen + 1..];

    if !first_digits.bytes().all(|byte| byte.is_ascii_digit())
        || !last_digits.bytes().all(|byte| byte.is_ascii_digit())
    {
        return ByteRange::Unsatisfiable;
    }
    if first_digits.is_empty() && last_digits.is_empty() {
        return ByteRange::Unsatisfiable;
    }
    if size == 0 {
        return ByteRange::Unsatisfiable;
    }

    let first = if first_digits.is_empty() {
        None
    } else {
        match parse_digit_string(first_digits) {
            Some(value) => Some(value),
            None => return ByteRange::Unsatisfiable,
        }
    };

    let last = if last_digits.is_empty() {
        None
    } else {
        match parse_digit_string(last_digits) {
            Some(value) => Some(value),
            None => return ByteRange::Unsatisfiable,
        }
    };

    if first.is_none() && last == Some(0) {
        return ByteRange::Unsatisfiable;
    }

    let start = match first {
        Some(value) => value,
        None => size.saturating_sub(last.unwrap_or(0)).max(0),
    };

    let end = match (first, last) {
        (Some(_), Some(value)) => value.min(size.saturating_sub(1)),
        _ => size.saturating_sub(1),
    };

    if start <= end && start < size {
        ByteRange::Partial { start, end }
    } else {
        ByteRange::Unsatisfiable
    }
}

pub fn clip_mark_offsets(mark_times_ms: &[f64], save_time_ms: f64, duration_sec: f64) -> Vec<f64> {
    if !save_time_ms.is_finite() || !duration_sec.is_finite() || duration_sec <= 0.0 {
        return Vec::new();
    }

    let start_ms = save_time_ms - duration_sec * 1000.0;

    mark_times_ms
        .iter()
        .copied()
        .filter(|mark| mark.is_finite() && *mark >= start_ms && *mark <= save_time_ms)
        .map(|mark| duration_sec.min(((mark - start_ms) / 1000.0).max(0.0)))
        .collect()
}

pub fn transfer_clip_marks(marks_sec: &[f64], start_sec: f64, duration_sec: f64) -> Vec<f64> {
    if !start_sec.is_finite() || !duration_sec.is_finite() || start_sec < 0.0 || duration_sec < 0.0 {
        return Vec::new();
    }

    marks_sec
        .iter()
        .copied()
        .filter(|mark| mark.is_finite() && *mark >= start_sec && *mark - start_sec <= duration_sec)
        .map(|mark| mark - start_sec)
        .collect()
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClipMarkResult {
    pub marks: Vec<f64>,
    pub recorded: bool,
    pub last_press_ms: f64,
}

pub fn record_clip_mark(
    marks_ms: &[f64],
    now_ms: f64,
    buffer_length_sec: f64,
    last_press_ms: f64,
) -> ClipMarkResult {
    if !now_ms.is_finite() || !buffer_length_sec.is_finite() || buffer_length_sec <= 0.0 {
        return ClipMarkResult {
            marks: marks_ms.to_vec(),
            recorded: false,
            last_press_ms,
        };
    }

    let mut marks: Vec<f64> = marks_ms
        .iter()
        .copied()
        .filter(|mark| {
            mark.is_finite()
                && *mark >= now_ms - buffer_length_sec * 1000.0
                && *mark <= now_ms
        })
        .collect();

    if now_ms - last_press_ms <= 500.0 {
        return ClipMarkResult {
            marks,
            recorded: false,
            last_press_ms: now_ms,
        };
    }

    marks.push(now_ms);
    ClipMarkResult {
        marks,
        recorded: true,
        last_press_ms: now_ms,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn byte_ranges_match_typescript_cases() {
        let cases: &[(Option<&str>, ByteRange)] = &[
            (None, ByteRange::Full { start: 0, end: 999 }),
            (Some("bytes=0-99"), ByteRange::Partial { start: 0, end: 99 }),
            (Some("bytes=900-"), ByteRange::Partial { start: 900, end: 999 }),
            (Some("bytes=-100"), ByteRange::Partial { start: 900, end: 999 }),
            (Some("bytes=-2000"), ByteRange::Partial { start: 0, end: 999 }),
            (Some("bytes=990-2000"), ByteRange::Partial { start: 990, end: 999 }),
        ];

        for (header, expected) in cases {
            assert_eq!(byte_range(*header, 1000), *expected, "header {:?}", header);
        }

        assert_eq!(byte_range(None, 0), ByteRange::Full { start: 0, end: -1 });
        assert_eq!(byte_range(Some("bytes=0-"), 0), ByteRange::Unsatisfiable);
    }

    #[test]
    fn byte_ranges_reject_invalid_headers() {
        let invalid = [
            "bytes=-",
            "bytes=-0",
            "bytes=1000-",
            "bytes=9-2",
            "bytes=1-2,4-5",
            "bytes=a-2",
            "no bytes=0-1",
            "bytes=9007199254740992-",
            "items=0-2",
            "bytes=99999999999999999999999999999999999999-",
        ];

        for header in invalid {
            assert_eq!(
                byte_range(Some(header), 1000),
                ByteRange::Unsatisfiable,
                "header {:?}",
                header
            );
        }
    }

    #[test]
    fn clip_mark_offsets_match_typescript_cases() {
        assert_eq!(
            clip_mark_offsets(
                &[69_999.0, 70_000.0, 85_250.0, 100_000.0, 100_001.0],
                100_000.0,
                30.0
            ),
            vec![0.0, 15.25, 30.0]
        );
        assert_eq!(
            clip_mark_offsets(&[85_250.0, 95_000.0], 100_000.0, 10.0),
            vec![5.0]
        );
        assert_eq!(
            clip_mark_offsets(&[85_250.0], 100_000.0, 0.0),
            Vec::<f64>::new()
        );
        assert_eq!(
            clip_mark_offsets(&[f64::NAN, f64::INFINITY], 100_000.0, 30.0),
            Vec::<f64>::new()
        );
    }

    #[test]
    fn transfer_clip_marks_match_typescript_cases() {
        let duration = 9.49;
        assert_eq!(
            transfer_clip_marks(
                &[4.99, 5.0, 9.0, 13.9, 14.2, 14.49, 15.0],
                5.0,
                duration
            ),
            vec![0.0, 4.0, 8.9, 9.2, 9.49]
        );
        assert_eq!(
            transfer_clip_marks(&[0.0, 1.0, 8.9, 9.1], 0.0, duration),
            vec![0.0, 1.0, 8.9, 9.1]
        );
    }

    #[test]
    fn record_clip_mark_matches_typescript_cases() {
        let mut recorded = record_clip_mark(&[], 10_000.0, 30.0, f64::NEG_INFINITY);
        assert_eq!(
            recorded,
            ClipMarkResult {
                marks: vec![10_000.0],
                recorded: true,
                last_press_ms: 10_000.0,
            }
        );

        for now in [10_100.0, 10_500.0, 10_900.0, 11_300.0] {
            let result =
                record_clip_mark(&recorded.marks, now, 30.0, recorded.last_press_ms);
            recorded = result;
            assert_eq!(
                recorded,
                ClipMarkResult {
                    marks: vec![10_000.0],
                    recorded: false,
                    last_press_ms: now,
                }
            );
        }

        let result = record_clip_mark(&recorded.marks, 11_801.0, 30.0, recorded.last_press_ms);
        recorded = result;
        assert_eq!(
            recorded,
            ClipMarkResult {
                marks: vec![10_000.0, 11_801.0],
                recorded: true,
                last_press_ms: 11_801.0,
            }
        );

        assert_eq!(
            record_clip_mark(&[10_000.0, 15_000.0], 20_000.0, 5.0, 15_000.0),
            ClipMarkResult {
                marks: vec![15_000.0, 20_000.0],
                recorded: true,
                last_press_ms: 20_000.0,
            }
        );
    }
}
