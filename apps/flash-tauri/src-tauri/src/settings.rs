//! Settings: the same keys, defaults and validation as the Electron app's
//! `main.ts` DEFAULTS and `shared/sanitise.ts`, stored in the same
//! `settings.json` so both builds can run side by side during the move.
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

pub const QUALITY_OPTIONS: &[&str] = &[
    "720p 30fps", "720p 60fps", "1080p 30fps", "1080p 60fps", "1080p 120fps", "1080p 144fps",
    "1440p 60fps", "1440p 120fps", "4K 30fps", "4K 60fps",
];
const THEMES: &[&str] = &["blood", "ultraviolet", "cobalt", "fuchsia", "indigo", "bone"];
const OVERLAY_POSITIONS: &[&str] = &["top-left", "top-right", "bottom-left", "bottom-right"];

pub fn defaults(videos_dir: &Path) -> Map<String, Value> {
    let wayland = cfg!(target_os = "linux") && std::env::var("XDG_SESSION_TYPE").as_deref() == Ok("wayland");
    let value = json!({
        "clipsFolder": videos_dir.join("Flash").to_string_lossy(),
        "theme": "blood",
        "hotkey": "F8",
        "hotkeyShort": "Shift+F8",
        "screenshotHotkey": "F9",
        "shortClipSeconds": 15,
        "voiceEnabled": false,
        "voicePhrase": "",
        "voiceRawFloor": 0.30,
        "voiceCooldownMs": 3000,
        "displayId": 0,
        "overlay": !wayland,
        "portalRestoreToken": "",
        "overlayPosition": "top-left",
        "quality": "1080p 60fps",
        "bufferLength": 30,
        "audioCapture": true,
        "audioLanes": { "discord": ["discord.exe"], "music": ["spotify.exe"] },
        "micDeviceId": "",
        "autoSave": true,
        "notifications": true,
        "autoDeleteDays": 0,
        "autostartMarkerConsumedAt": 0,
        "learnedGames": {},
        "ignoredGames": [],
        "perGame": {},
    });
    match value { Value::Object(map) => map, _ => unreachable!() }
}

fn same_kind(a: &Value, b: &Value) -> bool {
    matches!((a, b), (Value::Bool(_), Value::Bool(_)) | (Value::Number(_), Value::Number(_)) | (Value::String(_), Value::String(_)))
}

fn exe_name_ok(name: &str) -> bool {
    !name.is_empty() && name.chars().count() <= 128 && !name.chars().any(|c| "\\/:*?\"<>|".contains(c))
}

fn clean_list(value: &Value) -> Option<Vec<String>> {
    let mut seen = BTreeSet::new();
    let names: Vec<String> = value.as_array()?.iter()
        .filter_map(Value::as_str)
        .map(|s| s.trim().to_lowercase())
        .filter(|s| exe_name_ok(s) && seen.insert(s.clone()))
        .take(64)
        .collect();
    Some(names)
}

fn sanitise_audio_lanes(value: &Value) -> Option<Value> {
    let source = value.as_object()?;
    let discord = clean_list(source.get("discord")?)?;
    let music: Vec<String> = clean_list(source.get("music")?)?.into_iter().filter(|e| !discord.contains(e)).collect();
    Some(json!({ "discord": discord, "music": music }))
}

/// Keeps only keys the defaults know, each with the default's shape and a
/// valid value. Mirrors `sanitise()` in `shared/sanitise.ts` key for key.
pub fn sanitise(defaults: &Map<String, Value>, parsed: &Value) -> Map<String, Value> {
    let mut clean = Map::new();
    let Some(source) = parsed.as_object() else { return clean };
    for (key, fallback) in defaults {
        let Some(value) = source.get(key) else { continue };
        if value.is_null() && !fallback.is_null() { continue }
        match key.as_str() {
            "displayId" => {
                if value.as_u64().is_some_and(|v| v <= 0xffff_ffff) { clean.insert(key.clone(), value.clone()); }
                continue;
            }
            "learnedGames" => {
                if let Some(map) = value.as_object() {
                    let kept: Map<String, Value> = map.iter()
                        .filter_map(|(exe, name)| {
                            let name = name.as_str()?.trim();
                            (!exe.trim().is_empty() && !name.is_empty()).then(|| (exe.clone(), Value::from(name)))
                        })
                        .collect();
                    clean.insert(key.clone(), Value::Object(kept));
                }
                continue;
            }
            "audioLanes" => {
                if let Some(lanes) = sanitise_audio_lanes(value) { clean.insert(key.clone(), lanes); }
                continue;
            }
            "ignoredGames" => {
                if let Some(list) = value.as_array() {
                    let mut seen = BTreeSet::new();
                    let kept: Vec<Value> = list.iter().filter_map(Value::as_str)
                        .filter(|s| !s.trim().is_empty() && seen.insert(s.to_string()))
                        .map(Value::from).collect();
                    clean.insert(key.clone(), Value::Array(kept));
                }
                continue;
            }
            "perGame" => {
                if let Some(map) = value.as_object() {
                    let mut per_defaults = Map::new();
                    per_defaults.insert("quality".into(), defaults.get("quality").cloned().unwrap_or(json!("1080p 60fps")));
                    per_defaults.insert("bufferLength".into(), defaults.get("bufferLength").cloned().unwrap_or(json!(30)));
                    let kept: Map<String, Value> = map.iter()
                        .map(|(game, fields)| (game.clone(), Value::Object(sanitise(&per_defaults, fields))))
                        .collect();
                    clean.insert(key.clone(), Value::Object(kept));
                }
                continue;
            }
            _ => {}
        }
        if fallback.is_array() { if value.is_array() { clean.insert(key.clone(), value.clone()); } continue }
        if fallback.is_object() { if value.is_object() { clean.insert(key.clone(), value.clone()); } continue }
        if !same_kind(value, fallback) { continue }
        let text = value.as_str().unwrap_or_default();
        let number = value.as_f64().unwrap_or_default();
        let ok = match key.as_str() {
            "quality" => QUALITY_OPTIONS.contains(&text),
            "bufferLength" => (10.0..=300.0).contains(&number) && number % 5.0 == 0.0,
            "autoDeleteDays" => [0.0, 7.0, 30.0, 90.0].contains(&number),
            "theme" => THEMES.contains(&text),
            "overlayPosition" => OVERLAY_POSITIONS.contains(&text),
            "hotkey" | "hotkeyShort" | "screenshotHotkey" => !text.trim().is_empty(),
            _ => true,
        };
        if ok { clean.insert(key.clone(), value.clone()); }
    }
    let buffer = clean.get("bufferLength").or_else(|| defaults.get("bufferLength")).and_then(Value::as_f64).unwrap_or(30.0);
    if let Some(short) = clean.get("shortClipSeconds").and_then(Value::as_f64) {
        if short < 5.0 || short > buffer { clean.remove("shortClipSeconds"); }
    }
    clean
}

pub struct Store {
    pub path: PathBuf,
    pub defaults: Map<String, Value>,
    pub values: Map<String, Value>,
}

impl Store {
    /// The Electron build's file: `<config>/@flash/desktop/settings.json`.
    pub fn open(config_dir: &Path, videos_dir: &Path) -> Store {
        let path = config_dir.join("@flash").join("desktop").join("settings.json");
        let defaults = defaults(videos_dir);
        let parsed = std::fs::read_to_string(&path).ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .unwrap_or(Value::Null);
        let mut values = defaults.clone();
        values.extend(sanitise(&defaults, &parsed));
        Store { path, defaults, values }
    }

    /// Applies a partial update from the UI. `clipsFolder` only changes through
    /// the folder picker, as in the Electron build.
    pub fn update(&mut self, partial: &Value) -> std::io::Result<Map<String, Value>> {
        let mut current = self.defaults.clone();
        current.extend(self.values.clone());
        let mut changed = sanitise(&current, partial);
        changed.remove("clipsFolder");
        self.values.extend(changed.clone());
        // A short clip can never be longer than the buffer it is cut from.
        let buffer = self.values.get("bufferLength").and_then(Value::as_f64).unwrap_or(30.0);
        if let Some(short) = self.values.get("shortClipSeconds").and_then(Value::as_f64) {
            if short > buffer { self.values.insert("shortClipSeconds".into(), json!(buffer as u64)); }
        }
        self.save()?;
        Ok(changed)
    }

    pub fn save(&self) -> std::io::Result<()> {
        if let Some(dir) = self.path.parent() { std::fs::create_dir_all(dir)?; }
        // Write then rename, so a crash mid-write never leaves half a file.
        let temp = self.path.with_extension("json.tmp");
        std::fs::write(&temp, serde_json::to_vec_pretty(&Value::Object(self.values.clone()))?)?;
        std::fs::rename(temp, &self.path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn d() -> Map<String, Value> { defaults(Path::new("/videos")) }

    #[test]
    fn rejects_non_objects_and_unknown_keys() {
        assert!(sanitise(&d(), &json!(null)).is_empty());
        assert!(sanitise(&d(), &json!([1, 2])).is_empty());
        assert!(sanitise(&d(), &json!({ "evil": true })).is_empty());
    }

    #[test]
    fn drops_wrong_types() {
        let clean = sanitise(&d(), &json!({ "overlayPosition": null, "hotkey": 5, "overlay": "yes", "theme": "cobalt" }));
        assert_eq!(clean.len(), 1);
        assert_eq!(clean["theme"], "cobalt");
    }

    #[test]
    fn validates_enumerated_values() {
        assert!(sanitise(&d(), &json!({ "quality": "8K 240fps" })).is_empty());
        assert_eq!(sanitise(&d(), &json!({ "quality": "1440p 120fps" }))["quality"], "1440p 120fps");
        for bad in [json!(7), json!(5), json!(305), json!(12.5)] { assert!(sanitise(&d(), &json!({ "bufferLength": bad })).is_empty()); }
        assert_eq!(sanitise(&d(), &json!({ "bufferLength": 60 }))["bufferLength"], 60);
        assert!(sanitise(&d(), &json!({ "autoDeleteDays": 3 })).is_empty());
        assert!(sanitise(&d(), &json!({ "hotkey": "   " })).is_empty());
        assert!(sanitise(&d(), &json!({ "theme": "neon" })).is_empty());
    }

    #[test]
    fn display_id_must_be_a_u32() {
        for bad in [json!(-1), json!(0.5), json!(4294967296u64), json!("1"), json!(null)] {
            assert!(sanitise(&d(), &json!({ "displayId": bad })).is_empty(), "accepted {bad}");
        }
        assert_eq!(sanitise(&d(), &json!({ "displayId": 2 }))["displayId"], 2);
    }

    #[test]
    fn short_clip_must_fit_the_buffer() {
        assert!(sanitise(&d(), &json!({ "shortClipSeconds": 45 })).get("shortClipSeconds").is_none());
        assert_eq!(sanitise(&d(), &json!({ "shortClipSeconds": 45, "bufferLength": 60 }))["shortClipSeconds"], 45);
        assert!(sanitise(&d(), &json!({ "shortClipSeconds": 2 })).get("shortClipSeconds").is_none());
    }

    #[test]
    fn audio_lanes_are_cleaned() {
        let clean = sanitise(&d(), &json!({ "audioLanes": { "discord": [" Discord.EXE ", "bad/name", 3], "music": ["discord.exe", "spotify.exe"] } }));
        assert_eq!(clean["audioLanes"], json!({ "discord": ["discord.exe"], "music": ["spotify.exe"] }));
        assert!(sanitise(&d(), &json!({ "audioLanes": { "discord": [] } })).is_empty());
    }

    #[test]
    fn game_collections_are_cleaned() {
        let clean = sanitise(&d(), &json!({
            "learnedGames": { "rl.exe": " Rocket League ", " ": "x", "bad.exe": 3 },
            "ignoredGames": ["a.exe", "a.exe", "", 4],
            "perGame": { "RL": { "quality": "4K 60fps", "bufferLength": 7, "junk": 1 } },
        }));
        assert_eq!(clean["learnedGames"], json!({ "rl.exe": "Rocket League" }));
        assert_eq!(clean["ignoredGames"], json!(["a.exe"]));
        assert_eq!(clean["perGame"], json!({ "RL": { "quality": "4K 60fps" } }));
    }

    #[test]
    fn store_round_trips_and_keeps_clips_folder() {
        let dir = std::env::temp_dir().join(format!("flash-settings-test-{}", std::process::id()));
        let mut store = Store::open(&dir, Path::new("/videos"));
        let changed = store.update(&json!({ "theme": "bone", "clipsFolder": "/", "bufferLength": 10 })).unwrap();
        assert_eq!(changed.get("theme"), Some(&json!("bone")));
        assert!(changed.get("clipsFolder").is_none());
        assert_eq!(store.values["shortClipSeconds"], json!(10));
        let reopened = Store::open(&dir, Path::new("/videos"));
        assert_eq!(reopened.values["theme"], "bone");
        assert_eq!(reopened.values["clipsFolder"], "/videos/Flash");
        std::fs::remove_dir_all(dir).ok();
    }
}
