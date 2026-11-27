//! Settings validation (port of shared/settings sanitise). Input is already parsed
//! JSON; the audio rules are injected.

use crate::clip_path::js_trim;

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<Value>),
    Object(Vec<(String, Value)>),
}
pub type AudioSanitiser = fn(&Value, &Value) -> Option<Value>;
pub const QUALITY_OPTIONS: [&str; 10] = [
    "720p 30fps",
    "720p 60fps",
    "1080p 30fps",
    "1080p 60fps",
    "1080p 120fps",
    "1080p 144fps",
    "1440p 60fps",
    "1440p 120fps",
    "4K 30fps",
    "4K 60fps",
];
const OVERLAY_POSITIONS: [&str; 4] = ["top-left", "top-right", "bottom-left", "bottom-right"];
const HOTKEYS: [&str; 3] = ["hotkey", "hotkeyShort", "screenshotHotkey"];
fn js_type(v: &Value) -> u8 {
    match v {
        Value::Undefined => 0,
        Value::Null | Value::Object(_) | Value::Array(_) => 1,
        Value::Bool(_) => 2,
        Value::Number(_) => 3,
        Value::String(_) => 4,
    }
}
fn insert(obj: &mut Vec<(String, Value)>, key: &str, value: Value) {
    if let Some((_, slot)) = obj.iter_mut().find(|(k, _)| k.as_str() == key) {
        *slot = value;
    } else {
        obj.push((key.to_string(), value));
    }
}
fn remove(obj: &mut Vec<(String, Value)>, key: &str) {
    obj.retain(|(k, _)| k.as_str() != key);
}
fn obj_get<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
    match v {
        Value::Object(items) => items
            .iter()
            .rev()
            .find(|(k, _)| k.as_str() == key)
            .map(|(_, v)| v),
        _ => None,
    }
}
fn normalise(v: &Value) -> Vec<(String, Value)> {
    let mut out = Vec::new();
    if let Value::Object(items) = v {
        for (k, val) in items {
            insert(&mut out, k.as_str(), val.clone());
        }
    }
    out
}
fn chosen(obj: &Value, key: &str, or: Value) -> Value {
    match obj_get(obj, key) {
        Some(v) if matches!(v, Value::Null | Value::Undefined) => or,
        Some(v) => v.clone(),
        None => or,
    }
}
fn list_has_str(list: &[&str], v: &Value) -> bool {
    matches!(v, Value::String(s) if list.contains(&s.as_str()))
}
fn list_has_num(list: &[f64], v: &Value) -> bool {
    matches!(v, Value::Number(n) if list.iter().any(|x| x == n))
}
fn as_num(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => Some(*n),
        Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        Value::Null => Some(0.0),
        Value::String(s) => {
            let t = js_trim(s);
            if t.is_empty() {
                Some(0.0)
            } else {
                t.parse::<f64>().ok()
            }
        }
        _ => None,
    }
}
pub fn sanitise(
    defaults: &Value,
    parsed: &Value,
    themes: &[&str],
    audio_lanes: AudioSanitiser,
    audio_tracks: AudioSanitiser,
) -> Value {
    let source = match parsed {
        Value::Object(_) => parsed,
        _ => return Value::Object(Vec::new()),
    };
    let mut clean = Vec::new();
    for (key, fallback) in normalise(defaults) {
        let k = key.as_str();
        let value = match obj_get(source, k) {
            Some(v) if !matches!(v, Value::Undefined) => v,
            _ => continue,
        };
        if k == "displayId" {
            if matches!(value, Value::Number(n) if n.is_finite() && n.fract() == 0.0 && *n >= 0.0 && *n <= 4_294_967_295.0)
            {
                insert(&mut clean, k, value.clone());
            }
            continue;
        }
        if k == "learnedGames" {
            if matches!(value, Value::Object(_)) {
                let mut map = Vec::new();
                for (exe, name) in normalise(value) {
                    if js_trim(&exe).is_empty() {
                        continue;
                    }
                    if let Value::String(name) = name {
                        let name = js_trim(&name);
                        if !name.is_empty() {
                            insert(&mut map, &exe, Value::String(name.to_string()));
                        }
                    }
                }
                insert(&mut clean, k, Value::Object(map));
            }
            continue;
        }
        if k == "audioLanes" {
            if let Some(v) = audio_lanes(value, &fallback) {
                insert(&mut clean, k, v);
            }
            continue;
        }
        if k == "audioTracks" {
            if let Some(v) = audio_tracks(value, &fallback) {
                insert(&mut clean, k, v);
            }
            continue;
        }
        if k == "ignoredGames" {
            if let Value::Array(items) = value {
                let mut list = Vec::new();
                for item in items {
                    if let Value::String(exe) = item {
                        if !js_trim(&exe).is_empty()
                            && !list.iter().any(
                                |v| matches!(v, Value::String(x) if x.as_str() == exe.as_str()),
                            )
                        {
                            list.push(Value::String(exe.clone()));
                        }
                    }
                }
                insert(&mut clean, k, Value::Array(list));
            }
            continue;
        }
        if k == "perGame" {
            if matches!(value, Value::Object(_)) {
                let mut map = Vec::new();
                for (game, fields) in normalise(value) {
                    let per_defaults = Value::Object(vec![
                        (
                            "quality".to_string(),
                            chosen(
                                defaults,
                                "quality",
                                Value::String("1080p 60fps".to_string()),
                            ),
                        ),
                        (
                            "bufferLength".to_string(),
                            chosen(defaults, "bufferLength", Value::Number(30.0)),
                        ),
                    ]);
                    let fields =
                        sanitise(&per_defaults, &fields, themes, audio_lanes, audio_tracks);
                    insert(&mut map, &game, fields);
                }
                insert(&mut clean, k, Value::Object(map));
            }
            continue;
        }
        if matches!(fallback, Value::Array(_)) {
            if matches!(value, Value::Array(_)) {
                insert(&mut clean, k, value.clone());
            }
            continue;
        }
        if matches!(fallback, Value::Object(_)) {
            if matches!(value, Value::Object(_)) {
                insert(&mut clean, k, value.clone());
            }
            continue;
        }
        if js_type(value) != js_type(&fallback) {
            continue;
        }
        if matches!(value, Value::Number(n) if !n.is_finite()) {
            continue;
        }
        if k == "quality" && !list_has_str(&QUALITY_OPTIONS, value) {
            continue;
        }
        if k == "bufferLength"
            && !matches!(value, Value::Number(n) if *n >= 10.0 && *n <= 300.0 && *n % 5.0 == 0.0)
        {
            continue;
        }
        if k == "autoDeleteDays" && !list_has_num(&[0.0, 7.0, 30.0, 90.0], value) {
            continue;
        }
        if k == "maxStorageGB" && !list_has_num(&[0.0, 1.0, 5.0, 10.0, 25.0, 50.0, 100.0], value) {
            continue;
        }
        if k == "theme" && !list_has_str(themes, value) {
            continue;
        }
        if k == "overlayPosition" && !list_has_str(&OVERLAY_POSITIONS, value) {
            continue;
        }
        if HOTKEYS.contains(&k) {
            match value {
                Value::String(hotkey) if !js_trim(hotkey).is_empty() => {}
                _ => continue,
            }
        }
        insert(&mut clean, k, value.clone());
    }
    let mut clean = Value::Object(clean);
    let buffer = match obj_get(&clean, "bufferLength") {
        Some(v) if !matches!(v, Value::Null | Value::Undefined) => Some(v),
        _ => obj_get(defaults, "bufferLength"),
    };
    let out_of_range = obj_get(&clean, "shortClipSeconds")
        .and_then(as_num)
        .is_some_and(|s| s < 5.0 || buffer.and_then(as_num).is_some_and(|b| s > b));
    if out_of_range {
        if let Value::Object(items) = &mut clean {
            remove(items, "shortClipSeconds");
        }
    }
    clean
}
#[cfg(test)]
mod tests {
    use super::*;
    fn s(x: &str) -> Value {
        Value::String(x.to_string())
    }
    fn n(x: f64) -> Value {
        Value::Number(x)
    }
    fn obj(xs: &[(&str, Value)]) -> Value {
        Value::Object(
            xs.iter()
                .map(|(k, v)| ((*k).to_string(), v.clone()))
                .collect(),
        )
    }
    fn audio_none(_: &Value, _: &Value) -> Option<Value> {
        None
    }
    fn audio_keep(value: &Value, _: &Value) -> Option<Value> {
        Some(value.clone())
    }
    #[test]
    fn scalar_rules() {
        let defaults = obj(&[
            ("quality", s("720p 30fps")),
            ("overlayPosition", s("top-left")),
            ("hotkey", s("F9")),
            ("bufferLength", n(30.0)),
            ("displayId", n(0.0)),
            ("autoDeleteDays", n(7.0)),
            ("maxStorageGB", n(10.0)),
            ("theme", s("dark")),
        ]);
        let parsed = obj(&[
            ("quality", s("4K 60fps")),
            ("overlayPosition", Value::Null),
            ("hotkey", s("   ")),
            ("bufferLength", n(f64::NAN)),
            ("displayId", n(4_294_967_295.0 + 1.0)),
            ("autoDeleteDays", n(8.0)),
            ("maxStorageGB", n(5.0)),
            ("theme", s("dark")),
            ("extra", n(1.0)),
        ]);
        assert_eq!(
            sanitise(&defaults, &parsed, &[], audio_none, audio_none),
            obj(&[("quality", s("4K 60fps")), ("maxStorageGB", n(5.0))])
        );
        let parsed = obj(&[
            ("quality", s("1080p 144fps")),
            ("overlayPosition", s("bottom-right")),
            ("hotkey", s(" F10 ")),
            ("bufferLength", n(300.0)),
            ("displayId", n(4_294_967_295.0)),
            ("autoDeleteDays", n(90.0)),
            ("maxStorageGB", n(100.0)),
            ("theme", s("dark")),
        ]);
        assert_eq!(
            sanitise(&defaults, &parsed, &["dark"], audio_none, audio_none),
            obj(&[
                ("quality", s("1080p 144fps")),
                ("overlayPosition", s("bottom-right")),
                ("hotkey", s(" F10 ")),
                ("bufferLength", n(300.0)),
                ("displayId", n(4_294_967_295.0)),
                ("autoDeleteDays", n(90.0)),
                ("maxStorageGB", n(100.0)),
                ("theme", s("dark"))
            ])
        );
    }
    #[test]
    fn containers_and_audio() {
        let defaults = obj(&[
            ("learnedGames", obj(&[])),
            ("ignoredGames", Value::Array(vec![])),
            ("audioLanes", obj(&[])),
            ("audioTracks", Value::Array(vec![])),
            ("perGame", obj(&[])),
            ("quality", s("1080p 60fps")),
            ("bufferLength", n(30.0)),
        ]);
        let parsed = obj(&[
            (
                "learnedGames",
                obj(&[
                    (" game1 ", s(" A ")),
                    ("bad", n(1.0)),
                    ("ok", s("   ")),
                    ("dup", s("B")),
                    ("dup", s("C")),
                ]),
            ),
            (
                "ignoredGames",
                Value::Array(vec![s("a"), s(" a "), s("b"), s("b"), n(1.0), s("   ")]),
            ),
            ("audioLanes", obj(&[("x", n(1.0))])),
            ("audioTracks", Value::Array(vec![n(1.0)])),
            (
                "perGame",
                obj(&[(
                    "Game",
                    obj(&[
                        ("quality", s("720p 30fps")),
                        ("bufferLength", n(20.0)),
                        ("extra", n(1.0)),
                    ]),
                )]),
            ),
        ]);
        let expected = obj(&[
            ("learnedGames", obj(&[(" game1 ", s("A")), ("dup", s("C"))])),
            ("ignoredGames", Value::Array(vec![s("a"), s(" a "), s("b")])),
            ("audioLanes", obj(&[("x", n(1.0))])),
            (
                "perGame",
                obj(&[(
                    "Game",
                    obj(&[("quality", s("720p 30fps")), ("bufferLength", n(20.0))]),
                )]),
            ),
        ]);
        assert_eq!(
            sanitise(&defaults, &parsed, &[], audio_keep, audio_none),
            expected
        );
    }
    #[test]
    fn short_clip_clamp() {
        let defaults = obj(&[("bufferLength", n(30.0)), ("shortClipSeconds", n(10.0))]);
        assert_eq!(
            sanitise(
                &defaults,
                &obj(&[("shortClipSeconds", n(31.0))]),
                &[],
                audio_none,
                audio_none
            ),
            obj(&[])
        );
        assert_eq!(
            sanitise(
                &defaults,
                &obj(&[("shortClipSeconds", n(4.0))]),
                &[],
                audio_none,
                audio_none
            ),
            obj(&[])
        );
        assert_eq!(
            sanitise(
                &defaults,
                &obj(&[("shortClipSeconds", n(5.0))]),
                &[],
                audio_none,
                audio_none
            ),
            obj(&[("shortClipSeconds", n(5.0))])
        );
        assert_eq!(
            sanitise(
                &defaults,
                &obj(&[("bufferLength", n(20.0)), ("shortClipSeconds", n(25.0))]),
                &[],
                audio_none,
                audio_none
            ),
            obj(&[("bufferLength", n(20.0))])
        );
        assert_eq!(
            sanitise(
                &defaults,
                &obj(&[("bufferLength", n(20.0)), ("shortClipSeconds", n(15.0))]),
                &[],
                audio_none,
                audio_none
            ),
            obj(&[("bufferLength", n(20.0)), ("shortClipSeconds", n(15.0))])
        );
    }
}
