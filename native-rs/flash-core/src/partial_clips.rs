//! Which leftover export files are safe to clean up (port of shared/partialClips.ts).

pub fn is_stale_partial_clip(name: &str, modified_at: f64, now: f64) -> bool {
    let b = name.as_bytes();
    let shape = (0..b.len()).any(|p| pid_tail_at(b, p) && stem_ok(&b[..p]))
        || uuid_tail(b)
        || temp_tail(b);
    shape && modified_at.is_finite() && modified_at > 0.0 && now - modified_at > 3_600_000.0
}
fn pid_tail_at(b: &[u8], p: usize) -> bool {
    if b.get(p) != Some(&b'.') { return false; }
    let mut i = digits(b, p + 1);
    if i == p + 1 || b.get(i) != Some(&b'.') { return false; }
    i += 1;
    let end = digits(b, i);
    if end == i || !b[end..].starts_with(b".partial.") { return false; }
    i = end + 9;
    [&b"mp4.try.mp4"[..], &b"mp4"[..], &b"png"[..]]
        .iter().any(|e| b[i..].starts_with(*e) && i + e.len() == b.len())
}
fn uuid_tail(b: &[u8]) -> bool {
    if b.len() < 49 { return false; }
    let p = b.len() - 49;
    b[p..].starts_with(b".mp4.partial.") && uuid_ok(&b[p + 13..]) && stem_ok(&b[..p])
}
fn temp_tail(b: &[u8]) -> bool {
    if b.len() < 11 { return false; }
    let p = b.len() - 11;
    let t = &b[p + 5..];
    b[p..].starts_with(b".mp4.") && t.iter().all(u8::is_ascii_alphanumeric)
        && t.iter().any(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) && stem_ok(&b[..p])
}
fn uuid_ok(u: &[u8]) -> bool {
    u.len() == 36 && u.iter().enumerate().all(|(i, &c)| {
        if matches!(i, 8 | 13 | 18 | 23) { c == b'-' } else { c.is_ascii_digit() || (b'a'..=b'f').contains(&c) }
    })
}
fn stem_ok(s: &[u8]) -> bool {
    let s = strip_collision(s);
    timestamp_ok(s) || named_ok(s)
}
fn strip_collision(s: &[u8]) -> &[u8] {
    if s.last() != Some(&b')') { return s; }
    let mut k = s.len() - 1;
    while k > 0 && s[k - 1].is_ascii_digit() { k -= 1; }
    if k == s.len() - 1 || k < 2 || s[k - 1] != b'(' || s[k - 2] != b' ' { s } else { &s[..k - 2] }
}
fn timestamp_ok(s: &[u8]) -> bool {
    let mut i = 0;
    for (n, sep) in [(4, Some(b'-')), (2, Some(b'-')), (2, Some(b'_')), (2, Some(b'-')), (2, Some(b'-')), (2, None)] {
        if !take_digits(s, &mut i, n) || !sep.map_or(true, |c| take_byte(s, &mut i, c)) { return false; }
    }
    if i == s.len() { return true; }
    take_byte(s, &mut i, b'_') && { let end = digits(s, i); end > i && end == s.len() }
}
fn take_digits(s: &[u8], i: &mut usize, n: usize) -> bool {
    if *i + n > s.len() || !s[*i..*i + n].iter().all(|c| c.is_ascii_digit()) { false } else { *i += n; true }
}
fn take_byte(s: &[u8], i: &mut usize, c: u8) -> bool {
    if s.get(*i) == Some(&c) { *i += 1; true } else { false }
}
fn digits(b: &[u8], mut i: usize) -> usize {
    while i < b.len() && b[i].is_ascii_digit() { i += 1; }
    i
}
fn named_ok(s: &[u8]) -> bool {
    (1..=s.len().saturating_sub(3)).any(|i| s.get(i..i + 3) == Some(&b" - "[..]) && clean_prefix(&s[..i]) && tag_ok(&s[i + 3..]))
}
fn clean_prefix(s: &[u8]) -> bool {
    let mut i = 0;
    while i < s.len() {
        if matches!(s[i], b'\n' | b'\r') || (s[i] == 0xe2 && i + 2 < s.len() && s[i + 1] == 0x80 && matches!(s[i + 2], 0xa8 | 0xa9)) { return false; }
        i += 1;
    }
    true
}
fn tag_ok(t: &[u8]) -> bool {
    if t == b"trim" || t == b"edit" || time_ok(t) { return true; }
    let rest = if t.starts_with(b"1GB") {
        &t[3..]
    } else {
        let i = digits(t, 0);
        if i == 0 || !t[i..].starts_with(b"MB") { return false; }
        &t[i + 2..]
    };
    rest.is_empty() || rest == b" H264"
}
fn time_ok(t: &[u8]) -> bool {
    t.len() == 12 && pair(t, 0) && t[2] == b'-' && pair(t, 3) && t[5] == b'-' && pair(t, 6) && t[8] == b'.' && pair(t, 9) && t[11].is_ascii_digit()
}
fn pair(t: &[u8], i: usize) -> bool {
    matches!(t.get(i), Some(c) if c.is_ascii_digit()) && matches!(t.get(i + 1), Some(c) if c.is_ascii_digit())
}
#[cfg(test)]
mod tests {
    use super::is_stale_partial_clip as stale;
    const OLD: f64 = 1_000_000.0; const NOW: f64 = 5_000_000.0;
    #[test]
    fn matches_shapes() {
        for n in [
            "2026-11-26_12-34-56.123.456.partial.mp4",
            "2026-11-26_12-34-56_7 (2).123.456.partial.png",
            "clip - trim.42.7.partial.mp4",
            "clip - 12MB H264 (3).9.1.partial.mp4",
            "clip - 1GB.9.1.partial.mp4.try.mp4",
            "clip - 12-34-56.789 (2).mp4.partial.01234567-89ab-cdef-0123-456789abcdef",
            "clip - edit.mp4.AbC123",
        ] { assert!(stale(n, OLD, NOW), "{}", n); }
    }
    #[test]
    fn rejects_other_names_and_times() {
        for n in [
            "clip - edit.mp4.abcdef",
            "2026-11-26_12-34-56.mp4.backup",
            "clip - 2GB.1.2.partial.mp4",
            "clip - trim (x).1.2.partial.mp4",
            "clip\n - trim.1.2.partial.mp4",
            "x - 12-34-56.78X.1.2.partial.mp4",
        ] { assert!(!stale(n, OLD, NOW), "{}", n); }
        assert!(!stale("clip - trim.1.2.partial.mp4", OLD, 4_600_000.0)); assert!(!stale("clip - trim.1.2.partial.mp4", f64::NAN, NOW));
        assert!(!stale("clip - trim.1.2.partial.mp4", 0.0, NOW));
    }
}
