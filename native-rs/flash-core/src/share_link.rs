//! Share link limits and strict link parsing (port of shared/shareLink.ts).

pub const SHARE_ORIGIN: &str = "https://share.flashclipping.fyi";
pub const SHARE_PAGE_ORIGIN: &str = "https://flashclipping.fyi";
pub const SHARE_UPLOAD_ENDPOINT: &str = "https://share.flashclipping.fyi/flash-clips";
/// The server enforces the same cap.
pub const SHARE_MAX_BYTES: u64 = 100 * 1_048_576;
pub const SHARE_DAYS: u32 = 7;
pub const SHARE_TARGET_KBPS: u32 = 5000;

const SHARE_ORIGINAL_MAX_KBPS: f64 = 5500.0;
const SHARE_COPY_MIN_BYTES: u64 = 1_048_576;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FlashLink {
    pub id: String,
    pub mp4_url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SharePreparation {
    Original,
    Export,
    Error,
}

pub fn share_copy_max_bytes(duration_seconds: f64, file_bytes: u64) -> Option<u64> {
    if !duration_seconds.is_finite() || duration_seconds <= 0.0 || file_bytes == 0 {
        return None;
    }
    if file_bytes as f64 * 8.0 / duration_seconds / 1000.0 <= SHARE_ORIGINAL_MAX_KBPS {
        return None;
    }
    let target = (duration_seconds * f64::from(SHARE_TARGET_KBPS) * 1000.0 / 8.0).ceil() as u64;
    Some(target.max(SHARE_COPY_MIN_BYTES))
}

pub fn share_export_max_bytes(duration_seconds: f64, file_bytes: u64, audio_tracks: u32) -> Option<u64> {
    share_copy_max_bytes(duration_seconds, file_bytes)
        .or((audio_tracks > 1).then_some(SHARE_MAX_BYTES))
}

pub fn decide_share_preparation(audio_tracks: u32, max_bytes: Option<u64>, can_export: bool) -> SharePreparation {
    if audio_tracks > 1 && (!can_export || max_bytes.is_none()) {
        SharePreparation::Error
    } else if max_bytes.is_some() && can_export {
        SharePreparation::Export
    } else {
        SharePreparation::Original
    }
}

/// `None` means the size is acceptable.
pub fn check_share_size(bytes: u64) -> Option<String> {
    if bytes == 0 {
        return Some("The clip is empty.".into());
    }
    (bytes > SHARE_MAX_BYTES).then(|| {
        format!(
            "This clip is over {}MB. Export a smaller copy and share that.",
            SHARE_MAX_BYTES / 1_048_576
        )
    })
}

fn is_clip_id(id: &str) -> bool {
    id.len() == 12 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// The server's answer is data: only the exact shape it generates becomes a
/// link, always joined to our own origin.
pub fn share_url_from_path(path: &str) -> Option<String> {
    let id = path.strip_prefix("/c/")?.strip_suffix(".mp4")?;
    is_clip_id(id).then(|| format!("{SHARE_PAGE_ORIGIN}/c/{id}"))
}

/// Input comes from the operating system and is untrusted, so no query,
/// fragment, credentials, other host or extra segment is accepted.
pub fn parse_flash_link(raw: &str) -> Option<FlashLink> {
    let rest = raw.strip_prefix("flash://c/")?;
    let id = rest.strip_suffix('/').unwrap_or(rest);
    is_clip_id(id).then(|| FlashLink {
        id: id.into(),
        mp4_url: format!("{SHARE_ORIGIN}/c/{id}.mp4"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_and_preparation() {
        assert_eq!(share_copy_max_bytes(10.0, 5 * 1_048_576), None);
        assert_eq!(share_copy_max_bytes(10.0, 10 * 1_048_576), Some(6_250_000));
        assert_eq!(share_copy_max_bytes(1.0, 800_000), Some(1_048_576));
        assert_eq!(share_copy_max_bytes(f64::NAN, 10), None);
        assert_eq!(share_export_max_bytes(10.0, 1_048_576, 2), Some(SHARE_MAX_BYTES));
        assert_eq!(share_export_max_bytes(10.0, 1_048_576, 1), None);
        assert_eq!(decide_share_preparation(2, None, true), SharePreparation::Error);
        assert_eq!(decide_share_preparation(2, Some(1), true), SharePreparation::Export);
        assert_eq!(decide_share_preparation(1, Some(1), false), SharePreparation::Original);
        assert_eq!(check_share_size(SHARE_MAX_BYTES), None);
        assert!(check_share_size(SHARE_MAX_BYTES + 1).unwrap().contains("over 100MB"));
        assert_eq!(SHARE_UPLOAD_ENDPOINT, format!("{SHARE_ORIGIN}/flash-clips"));
    }

    #[test]
    fn only_exact_shapes_become_links() {
        assert_eq!(
            share_url_from_path("/c/AbcDef123_-9.mp4").as_deref(),
            Some("https://flashclipping.fyi/c/AbcDef123_-9")
        );
        for bad in ["c/AbcDef123_-9.mp4", "/c/short.mp4", "/c/AbcDef123_-9.mov", "/c/AbcDef123_/9.mp4", "/c/.mp4"] {
            assert_eq!(share_url_from_path(bad), None, "{bad}");
        }
        let link = parse_flash_link("flash://c/AbcDef123_-9/").unwrap();
        assert_eq!(link.mp4_url, "https://share.flashclipping.fyi/c/AbcDef123_-9.mp4");
        for bad in ["flash://c/AbcDef123_-9//", "flash://c/AbcDef123_-9?x", "flash://x/AbcDef123_-9", "http://c/AbcDef123_-9"] {
            assert_eq!(parse_flash_link(bad), None, "{bad}");
        }
    }
}
