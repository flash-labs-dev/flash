//! Readable titles for clips nobody has renamed (port of shared/clipTitle.ts).

use crate::clip_path::js_trim;

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// Field widths of the auto-generated "YYYY MM DD HH mm ss" name.
const WIDTHS: [usize; 6] = [4, 2, 2, 2, 2, 2];

fn auto_name_parts(title: &str) -> Option<[u32; 6]> {
    let mut parts = [0; 6];
    let mut fields = js_trim(title).split(' ');
    for (part, width) in parts.iter_mut().zip(WIDTHS) {
        let field = fields.next()?;
        if field.len() != width || !field.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        *part = field.parse().ok()?;
    }
    fields.next().is_none().then_some(parts)
}

/// `current_year` is the local calendar year; the caller owns the clock.
/// A title that is not an auto-generated name is returned untouched.
pub fn clip_display_title(title: &str, current_year: u32) -> String {
    let Some([year, month, day, hour24, minute, second]) = auto_name_parts(title) else {
        return title.to_string();
    };
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour24 > 23
        || minute > 59
        || second > 59
    {
        return title.to_string();
    }

    let hour = if hour24 % 12 == 0 { 12 } else { hour24 % 12 };
    let half = if hour24 < 12 { "AM" } else { "PM" };
    let name = MONTHS[(month - 1) as usize];
    let date = if year == current_year {
        format!("{day} {name}")
    } else {
        format!("{day} {name} {year}")
    };
    format!("{date} \u{b7} {hour}:{minute:02}:{second:02} {half}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_auto_names() {
        assert_eq!(
            clip_display_title("2026 09 13 02 45 12", 2026),
            "13 Sep \u{b7} 2:45:12 AM"
        );
        assert_eq!(
            clip_display_title("  2024 12 01 15 07 05 ", 2026),
            "1 Dec 2024 \u{b7} 3:07:05 PM"
        );
        assert_eq!(
            clip_display_title("2026 01 01 00 00 00", 2026),
            "1 Jan \u{b7} 12:00:00 AM"
        );
        assert_eq!(
            clip_display_title("2026 01 01 12 00 00", 2026),
            "1 Jan \u{b7} 12:00:00 PM"
        );
    }

    #[test]
    fn leaves_other_titles_alone() {
        for title in [
            "",
            "  my clip  ",
            "2026 09 13 02 45",
            "2026 09 13 02 45 12 13",
            "2026 9 13 02 045 12",
            "+026 09 13 02 45 12",
            "2026-09-13 02 45 12",
            "2026 13 01 00 00 00",
            "2026 01 32 00 00 00",
            "2026 01 01 24 00 00",
        ] {
            assert_eq!(clip_display_title(title, 2026), title);
        }
    }
}
