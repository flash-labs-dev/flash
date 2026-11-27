#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeyLike<'a> {
    pub code: &'a str,
    pub ctrl_key: bool,
    pub alt_key: bool,
    pub shift_key: bool,
    pub meta_key: bool,
}

fn single_uppercase(value: &str) -> Option<char> {
    let mut chars = value.chars();
    match (chars.next(), chars.next()) {
        (Some(ch), None) if ch.is_ascii_uppercase() => Some(ch),
        _ => None,
    }
}

fn single_digit(value: &str) -> Option<char> {
    let mut chars = value.chars();
    match (chars.next(), chars.next()) {
        (Some(ch), None) if ch.is_ascii_digit() => Some(ch),
        _ => None,
    }
}

fn function_key(rest: &str) -> Option<u8> {
    let bytes = rest.as_bytes();
    if bytes.is_empty() || bytes.len() > 2 || !bytes.iter().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    if bytes.len() == 2 && bytes[0] == b'0' {
        return None;
    }
    let number = rest.parse::<u8>().ok()?;
    (1..=24).contains(&number).then_some(number)
}

fn literal_key(code: &str) -> Option<&'static str> {
    match code {
        "Space" => Some("Space"),
        "Insert" => Some("Insert"),
        "Home" => Some("Home"),
        "End" => Some("End"),
        "PageUp" => Some("PageUp"),
        "PageDown" => Some("PageDown"),
        "Delete" => Some("Delete"),
        "Backspace" => Some("Backspace"),
        "Tab" => Some("Tab"),
        "Enter" => Some("Enter"),
        "PrintScreen" => Some("PrintScreen"),
        "ScrollLock" => Some("ScrollLock"),
        "Pause" => Some("Pause"),
        "ArrowUp" => Some("Up"),
        "ArrowDown" => Some("Down"),
        "ArrowLeft" => Some("Left"),
        "ArrowRight" => Some("Right"),
        "Backquote" => Some("`"),
        "Minus" => Some("-"),
        "Equal" => Some("="),
        "BracketLeft" => Some("["),
        "BracketRight" => Some("]"),
        "Backslash" => Some("\\"),
        "Semicolon" => Some(";"),
        "Quote" => Some("'"),
        "Comma" => Some(","),
        "Period" => Some("."),
        "Slash" => Some("/"),
        "NumpadAdd" => Some("numadd"),
        "NumpadSubtract" => Some("numsub"),
        "NumpadMultiply" => Some("nummult"),
        "NumpadDivide" => Some("numdiv"),
        "NumpadDecimal" => Some("numdec"),
        _ => None,
    }
}

fn key_for_code(code: &str) -> Option<String> {
    if let Some(rest) = code.strip_prefix("Key") {
        if let Some(ch) = single_uppercase(rest) {
            return Some(ch.to_string());
        }
    }

    if let Some(rest) = code.strip_prefix("Digit") {
        if let Some(ch) = single_digit(rest) {
            return Some(ch.to_string());
        }
    }

    if let Some(rest) = code.strip_prefix('F') {
        if let Some(number) = function_key(rest) {
            return Some(format!("F{number}"));
        }
    }

    if let Some(rest) = code.strip_prefix("Numpad") {
        if let Some(ch) = single_digit(rest) {
            return Some(format!("num{ch}"));
        }
    }

    literal_key(code).map(|key| key.to_owned())
}

pub fn to_accelerator(event: &KeyLike<'_>) -> Option<String> {
    let key = key_for_code(event.code)?;
    let mut parts: Vec<&str> = Vec::with_capacity(5);

    if event.ctrl_key {
        parts.push("Control");
    }
    if event.alt_key {
        parts.push("Alt");
    }
    if event.shift_key {
        parts.push("Shift");
    }
    if event.meta_key {
        parts.push("Super");
    }

    parts.push(&key);
    Some(parts.join("+"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default, Clone, Copy)]
    struct Modifiers {
        ctrl_key: bool,
        alt_key: bool,
        shift_key: bool,
        meta_key: bool,
    }

    fn press(code: &str, modifiers: Modifiers) -> Option<String> {
        to_accelerator(&KeyLike {
            code,
            ctrl_key: modifiers.ctrl_key,
            alt_key: modifiers.alt_key,
            shift_key: modifiers.shift_key,
            meta_key: modifiers.meta_key,
        })
    }

    #[test]
    fn plain_keys() {
        assert_eq!(press("F8", Modifiers::default()).as_deref(), Some("F8"));
        assert_eq!(press("KeyG", Modifiers::default()).as_deref(), Some("G"));
        assert_eq!(press("Digit4", Modifiers::default()).as_deref(), Some("4"));
        assert_eq!(press("Numpad7", Modifiers::default()).as_deref(), Some("num7"));
        assert_eq!(press("Backquote", Modifiers::default()).as_deref(), Some("`"));
        assert_eq!(press("ArrowUp", Modifiers::default()).as_deref(), Some("Up"));
    }

    #[test]
    fn numpad_operators() {
        for (code, key) in [
            ("NumpadAdd", "numadd"),
            ("NumpadSubtract", "numsub"),
            ("NumpadMultiply", "nummult"),
            ("NumpadDivide", "numdiv"),
            ("NumpadDecimal", "numdec"),
        ] {
            assert_eq!(press(code, Modifiers::default()).as_deref(), Some(key));
        }
        assert_eq!(press("NumpadEnter", Modifiers::default()), None);
    }

    #[test]
    fn modifier_order_is_fixed() {
        assert_eq!(
            press(
                "KeyC",
                Modifiers {
                    ctrl_key: true,
                    shift_key: true,
                    ..Default::default()
                }
            )
            .as_deref(),
            Some("Control+Shift+C")
        );

        assert_eq!(
            press(
                "F9",
                Modifiers {
                    alt_key: true,
                    ..Default::default()
                }
            )
            .as_deref(),
            Some("Alt+F9")
        );

        assert_eq!(
            press(
                "KeyX",
                Modifiers {
                    ctrl_key: true,
                    alt_key: true,
                    shift_key: true,
                    meta_key: true,
                }
            )
            .as_deref(),
            Some("Control+Alt+Shift+Super+X")
        );
    }

    #[test]
    fn bare_modifiers_are_not_hotkeys() {
        assert_eq!(
            press(
                "ShiftLeft",
                Modifiers {
                    shift_key: true,
                    ..Default::default()
                }
            ),
            None
        );
        assert_eq!(
            press(
                "ControlLeft",
                Modifiers {
                    ctrl_key: true,
                    ..Default::default()
                }
            ),
            None
        );
        assert_eq!(
            press(
                "AltRight",
                Modifiers {
                    alt_key: true,
                    ..Default::default()
                }
            ),
            None
        );
        assert_eq!(
            press(
                "MetaLeft",
                Modifiers {
                    meta_key: true,
                    ..Default::default()
                }
            ),
            None
        );
    }

    #[test]
    fn rejected_keys_return_none() {
        assert_eq!(press("F25", Modifiers::default()), None);
        assert_eq!(press("CapsLock", Modifiers::default()), None);
        assert_eq!(press("Unidentified", Modifiers::default()), None);
    }
}
