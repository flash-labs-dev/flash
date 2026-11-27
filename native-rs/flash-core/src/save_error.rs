//! Plain-language save failures (port of shared/saveError.ts).
//! Only filesystem failures with a known cause are translated.

/// First number following `prefix`, saturating so a huge value never matches.
fn number_after(message: &str, prefix: &str) -> Option<u64> {
    message.match_indices(prefix).find_map(|(at, _)| {
        let rest = &message[at + prefix.len()..];
        let end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
        (end > 0).then(|| rest[..end].parse().unwrap_or(u64::MAX))
    })
}

/// `code` is empty when the failure carries none. The caller supplies the
/// fallback text as `message` when there is no message.
pub fn save_error(code: &str, message: &str) -> String {
    // Media Foundation reports HRESULT 0x80070000 plus the Win32 code; the
    // file writer reports Win32 directly.
    let windows_code = number_after(message, "Win32 ").or_else(|| {
        number_after(message, "HRESULT ").and_then(|n| n.checked_sub(0x8007_0000))
    });
    let lower = message.to_lowercase();
    let matches = |windows: &[u64], codes: &[&str], phrases: &[&str]| {
        windows_code.is_some_and(|n| windows.contains(&n))
            || codes.iter().any(|&candidate| {
                candidate == code
                    || lower
                        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
                        .any(|word| word.eq_ignore_ascii_case(candidate))
            })
            || phrases.iter().any(|&phrase| lower.contains(phrase))
    };

    let known = if matches(&[39, 112], &["ENOSPC", "EDQUOT"], &["no space left on device", "disk quota exceeded"]) {
        "The clips drive is full. Free up space and try again."
    } else if matches(
        &[2, 3, 21, 53, 64, 67, 1231],
        &["ENOENT", "ENODEV"],
        &["no such file or directory", "no such device"],
    ) {
        "The clips folder or drive is unavailable. Check that the drive is connected and choose a valid clips folder."
    } else if matches(
        &[5, 19],
        &["EACCES", "EPERM", "EROFS"],
        &["permission denied", "operation not permitted", "read-only file system"],
    ) {
        "Flash cannot write to the clips folder. Check the folder permissions or choose another folder."
    } else if matches(&[32, 33], &["EBUSY"], &["device or resource busy"]) {
        "The save file is in use by another program. Close it there and try again."
    } else if matches(&[206], &["ENAMETOOLONG"], &["file name too long"]) {
        "The clips folder path is too long. Choose a shorter clips folder."
    } else if matches(&[1117], &["EIO"], &["input/output error"]) {
        "The clips drive reported an I/O error. Check the drive and try again."
    } else {
        message
    };
    known.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn says(code: &str, message: &str, part: &str) {
        let out = save_error(code, message);
        assert!(out.contains(part), "{code:?} {message:?} gave {out:?}");
    }

    #[test]
    fn codes_and_phrases() {
        for (code, part) in [
            ("ENOSPC", "drive is full"),
            ("EDQUOT", "drive is full"),
            ("ENOENT", "unavailable"),
            ("ENODEV", "unavailable"),
            ("EACCES", "cannot write"),
            ("EPERM", "cannot write"),
            ("EROFS", "cannot write"),
            ("EBUSY", "in use"),
            ("ENAMETOOLONG", "path is too long"),
            ("EIO", "I/O error"),
        ] {
            says(code, "native write failed", part);
            says("", &format!("native write failed ({code})"), part);
        }
        says("", "Could not flush output: No space left on device", "drive is full");
        says("", "Could not publish output: Device or resource busy", "in use");
    }

    #[test]
    fn windows_numbers() {
        let cases: [(&[u64], &str); 6] = [
            (&[39, 112], "drive is full"),
            (&[2, 3, 21, 53, 64, 67, 1231], "unavailable"),
            (&[5, 19], "cannot write"),
            (&[32, 33], "in use"),
            (&[206], "path is too long"),
            (&[1117], "I/O error"),
        ];
        for (numbers, part) in cases {
            for n in numbers {
                says("", &format!("could not flush output (Win32 {n})"), part);
                says("", &format!("Finalize failed (HRESULT {})", 0x8007_0000u64 + n), part);
            }
        }
    }

    #[test]
    fn unknown_failures_pass_through() {
        for message in [
            "could not flush output",
            "native write failed (EUNKNOWN)",
            "native write failed (MY_EIO)",
            "could not flush output (Win32 9999)",
            "Finalize failed (HRESULT 2147500037)",
            "Win32 99999999999999999999999 (HRESULT 2147942405)",
        ] {
            assert_eq!(save_error("", message), message);
        }
    }
}
