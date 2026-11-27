//! Reusing an earlier share link (port of the pure part of shared/clipFiles.ts).
//! The caller parses the expiry date: std has no date parser.

use crate::share_link::{SHARE_ORIGIN, SHARE_PAGE_ORIGIN};

#[derive(Debug, Clone, PartialEq)]
pub struct ShareSource {
    pub path: String,
    pub size: u64,
    pub mtime_ms: f64,
    pub preparation_key: String,
}

/// A candidate still needs a successful HEAD request before its link is reused.
pub fn reusable_share_url<'a>(
    url: &'a str,
    cached: &ShareSource,
    expires_at_ms: f64,
    source: &ShareSource,
    now_ms: f64,
) -> Option<&'a str> {
    if cached != source || !source.mtime_ms.is_finite() || !now_ms.is_finite() {
        return None;
    }
    if !expires_at_ms.is_finite() || expires_at_ms - now_ms <= 3_600_000.0 {
        return None;
    }
    let id = url.strip_prefix(SHARE_PAGE_ORIGIN)?.strip_prefix("/c/")?;
    let valid = id.len() == 12 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    valid.then_some(url)
}

/// `None` for a URL that is not on the share page origin.
pub fn cached_share_mp4_url(url: &str) -> Option<String> {
    Some(format!("{SHARE_ORIGIN}{}.mp4", url.strip_prefix(SHARE_PAGE_ORIGIN)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source() -> ShareSource {
        ShareSource { path: "a.mp4".into(), size: 5, mtime_ms: 9.5, preparation_key: "k".into() }
    }

    #[test]
    fn reuse_needs_same_source_time_left_and_a_real_url() {
        let url = "https://flashclipping.fyi/c/abcDEF-_1234";
        let check = |u, expires, other: &ShareSource| reusable_share_url(u, &source(), expires, other, 0.0).is_some();
        assert!(check(url, 3_600_001.0, &source()));
        assert!(!check(url, 3_600_000.0, &source()));
        assert!(!check(url, f64::NAN, &source()));
        assert!(!check(url, 1e9, &ShareSource { size: 6, ..source() }));
        assert!(!check("https://flashclipping.fyi/c/short", 1e9, &source()));
        assert!(!check("https://flashclipping.fyi.evil/c/abcDEF-_1234", 1e9, &source()));
    }

    #[test]
    fn mp4_url_moves_to_the_share_origin() {
        assert_eq!(
            cached_share_mp4_url("https://flashclipping.fyi/c/abc").as_deref(),
            Some("https://share.flashclipping.fyi/c/abc.mp4")
        );
        assert_eq!(cached_share_mp4_url("x"), None);
    }
}
