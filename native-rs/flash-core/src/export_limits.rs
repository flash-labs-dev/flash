//! The share-copy size menu (port of shared/exportLimits.ts).

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportCodecChoice {
    Auto,
    H264,
}

#[derive(Debug, PartialEq, Eq)]
pub struct ExportLimit {
    pub value: &'static str,
    pub label: &'static str,
    pub hint: &'static str,
    pub bytes: u64,
    pub codec: ExportCodecChoice,
}

const MB: u64 = 1_048_576;

const fn limit(
    value: &'static str,
    label: &'static str,
    hint: &'static str,
    megabytes: u64,
    codec: ExportCodecChoice,
) -> ExportLimit {
    ExportLimit { value, label, hint, bytes: megabytes * MB, codec }
}

/// Discord's upload ceilings. "Compatible" is H.264, which plays anywhere.
pub static EXPORT_LIMITS: [ExportLimit; 4] = [
    limit("20", "20MB", "Discord free", 20, ExportCodecChoice::Auto),
    limit("20-h264", "20MB compatible", "H.264, plays anywhere", 20, ExportCodecChoice::H264),
    limit("50", "50MB", "Nitro Basic", 50, ExportCodecChoice::Auto),
    limit("1024", "1GB", "Nitro", 1024, ExportCodecChoice::Auto),
];

pub const DEFAULT_EXPORT_LIMIT: &str = "20";

/// An id from an older build, or junk, falls back to the first entry.
pub fn find_export_limit(id: &str) -> &'static ExportLimit {
    EXPORT_LIMITS.iter().find(|l| l.value == id).unwrap_or(&EXPORT_LIMITS[0])
}

pub fn export_suffix(bytes: u64, codec: ExportCodecChoice) -> String {
    let size = if bytes == 1024 * MB {
        "1GB".to_string()
    } else {
        // Rounds half up, as Math.round does.
        format!("{}MB", bytes.saturating_add(MB / 2) / MB)
    };
    let tag = if codec == ExportCodecChoice::H264 { " H264" } else { "" };
    format!(" - {size}{tag}.mp4")
}

/// Says so when "auto" could not use AV1. Empty when there is nothing to say.
pub fn codec_note(requested: ExportCodecChoice, actual: Option<&str>) -> String {
    match actual {
        Some(codec) if requested == ExportCodecChoice::Auto && !codec.is_empty() && codec != "av1" => {
            let name = if codec == "hevc" { "HEVC" } else { "H.264" };
            format!("Exported as {name} (no AV1 encoder on this GPU)")
        }
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::ExportCodecChoice::{Auto, H264};
    use super::*;

    #[test]
    fn every_id_is_unique_and_junk_falls_back() {
        for entry in &EXPORT_LIMITS {
            assert!(std::ptr::eq(find_export_limit(entry.value), entry), "{}", entry.value);
        }
        assert_eq!(find_export_limit("nope"), &EXPORT_LIMITS[0]);
        assert_eq!(find_export_limit("10485760"), &EXPORT_LIMITS[0]);
        let default = find_export_limit(DEFAULT_EXPORT_LIMIT);
        assert_eq!((default.bytes, default.codec), (20 * MB, Auto));
    }

    #[test]
    fn suffixes() {
        assert_eq!(export_suffix(20 * MB, Auto), " - 20MB.mp4");
        assert_eq!(export_suffix(20 * MB, H264), " - 20MB H264.mp4");
        assert_eq!(export_suffix(1024 * MB, Auto), " - 1GB.mp4");
        assert_eq!(export_suffix(MB + MB / 2, Auto), " - 2MB.mp4");
    }

    #[test]
    fn note_only_when_auto_missed_av1() {
        let said = |name| format!("Exported as {name} (no AV1 encoder on this GPU)");
        assert_eq!(codec_note(Auto, Some("hevc")), said("HEVC"));
        assert_eq!(codec_note(Auto, Some("h264")), said("H.264"));
        for (requested, actual) in [(Auto, Some("av1")), (H264, Some("h264")), (Auto, Some("")), (Auto, None)] {
            assert_eq!(codec_note(requested, actual), "");
        }
    }
}
