//! HTTP byte range parsing (port of shared/byteRange.ts).

use std::cmp::min;

/// Result of parsing a `Range` header. `end` is -1 for an empty resource.
#[derive(Debug, PartialEq, Eq)]
pub enum ByteRange {
    Status200 { start: i64, end: i64 },
    Status206 { start: i64, end: i64 },
    Status416,
}

/// Parse a single-range HTTP `Range` header.
pub fn byte_range(header: Option<&str>, size: u64) -> ByteRange {
    const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

    // No header - whole representation.
    if header.map_or(true, str::is_empty) {
        let end = if size == 0 {
            -1
        } else {
            (size - 1) as i64
        };
        return ByteRange::Status200 { start: 0, end };
    }

    // Trim whitespace.
    let raw = header.unwrap().trim();

    // Must start with "bytes=".
    const PREFIX: &str = "bytes=";
    if !raw.starts_with(PREFIX) {
        return ByteRange::Status416;
    }

    // Extract the part after the prefix.
    let range_part = &raw[PREFIX.len()..];

    // Exactly one '-' separating the two fields.
    let dash_pos = match range_part.find('-') {
        Some(p) => p,
        None => return ByteRange::Status416,
    };
    if range_part[dash_pos + 1..].contains('-') {
        // More than one dash - multipart ranges not supported.
        return ByteRange::Status416;
    }

    let first_str = &range_part[..dash_pos];
    let last_str = &range_part[dash_pos + 1..];

    // Both empty is invalid.
    if first_str.is_empty() && last_str.is_empty() {
        return ByteRange::Status416;
    }

    // Zero-length resources cannot be ranged.
    if size == 0 {
        return ByteRange::Status416;
    }

    // Helper to parse an optional numeric field.
    fn parse_opt(s: &str) -> Option<u64> {
        if s.is_empty() {
            return None;
        }
        // Reject any non-ASCII digit.
        if !s.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        // Leading '+' or '-' are already excluded by the digit check.
        match s.parse::<u64>() {
            Ok(v) => Some(v),
            Err(_) => None,
        }
    }

    let first_opt = parse_opt(first_str);
    let last_opt = parse_opt(last_str);

    // Any parse failure - unsatisfiable.
    if (first_str.len() > 0 && first_opt.is_none())
        || (last_str.len() > 0 && last_opt.is_none())
    {
        return ByteRange::Status416;
    }

    // Enforce JS safe-integer limit.
    if let Some(v) = first_opt {
        if v > MAX_SAFE_INTEGER {
            return ByteRange::Status416;
        }
    }
    if let Some(v) = last_opt {
        if v > MAX_SAFE_INTEGER {
            return ByteRange::Status416;
        }
    }

    // Special case: suffix range with last == 0 is unsatisfiable.
    if first_opt.is_none() && last_opt == Some(0) {
        return ByteRange::Status416;
    }

    // Compute start.
    let start: u64 = match first_opt {
        Some(v) => v,
        None => {
            // suffix-range: the last N bytes.
            // size.saturating_sub(N) yields 0 when N > size.
            size.saturating_sub(last_opt.unwrap())
        }
    };

    // Compute end.
    let end: u64 = match (first_opt, last_opt) {
        (None, _) | (_, None) => size - 1,
        (Some(_), Some(v)) => min(v, size - 1),
    };

    // Validate the computed range.
    if start <= end && start < size {
        ByteRange::Status206 {
            start: start as i64,
            end: end as i64,
        }
    } else {
        ByteRange::Status416
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_header_full_range() {
        // An empty header counts as absent, as in the TypeScript.
        assert_eq!(byte_range(Some(""), 10), ByteRange::Status200 { start: 0, end: 9 });
        assert_eq!(
            byte_range(None, 10),
            ByteRange::Status200 {
                start: 0,
                end: 9
            }
        );
        assert_eq!(
            byte_range(None, 0),
            ByteRange::Status200 { start: 0, end: -1 }
        );
    }

    #[test]
    fn simple_prefix_range() {
        assert_eq!(
            byte_range(Some("bytes=0-0"), 10),
            ByteRange::Status206 { start: 0, end: 0 }
        );
        assert_eq!(
            byte_range(Some("bytes=5-"), 10),
            ByteRange::Status206 { start: 5, end: 9 }
        );
    }

    #[test]
    fn simple_suffix_range() {
        assert_eq!(
            byte_range(Some("bytes=-5"), 10),
            ByteRange::Status206 { start: 5, end: 9 }
        );
        // last == 0 is unsatisfiable
        assert_eq!(byte_range(Some("bytes=-0"), 10), ByteRange::Status416);
    }

    #[test]
    fn range_exceeding_size() {
        // last > size, end is clamped to size-1
        assert_eq!(
            byte_range(Some("bytes=8-15"), 10),
            ByteRange::Status206 { start: 8, end: 9 }
        );
    }

    #[test]
    fn unsatisfiable_cases() {
        // empty range spec
        assert_eq!(byte_range(Some("bytes=-"), 10), ByteRange::Status416);
        // both sides empty
        assert_eq!(byte_range(Some("bytes="), 10), ByteRange::Status416);
        // malformed prefix
        assert_eq!(byte_range(Some("bytes=abc-10"), 10), ByteRange::Status416);
        // malformed suffix
        assert_eq!(byte_range(Some("bytes=10-abc"), 10), ByteRange::Status416);
        // start beyond size
        assert_eq!(byte_range(Some("bytes=20-30"), 10), ByteRange::Status416);
        // start > end after clamping
        assert_eq!(byte_range(Some("bytes=9-5"), 10), ByteRange::Status416);
        // size zero with any header
        assert_eq!(byte_range(Some("bytes=0-0"), 0), ByteRange::Status416);
    }

    #[test]
    fn unsafe_integer() {
        // number larger than JS safe integer limit
        let big = "9007199254740992"; // MAX_SAFE_INTEGER + 1
        let hdr = format!("bytes={big}-{big}");
        assert_eq!(byte_range(Some(&hdr), 1_000_000_000_000), ByteRange::Status416);
    }

    #[test]
    fn whitespace_and_case() {
        // leading/trailing whitespace is ignored
        assert_eq!(
            byte_range(Some("  bytes=0-4  "), 10),
            ByteRange::Status206 { start: 0, end: 4 }
        );
    }

    #[test]
    fn reject_multiple_ranges() {
        assert_eq!(
            byte_range(Some("bytes=0-4,6-9"), 10),
            ByteRange::Status416
        );
    }
}
