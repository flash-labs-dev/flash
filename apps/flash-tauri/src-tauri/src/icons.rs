//! A game's real icon, found where Linux launchers keep them: Heroic's icon
//! cache (Epic, GOG, Amazon), Steam's icon theme entries and library cache,
//! then any .desktop entry with the game's name. Returned as a data URL so the
//! webview can show it without file access.
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static CACHE: Mutex<Option<HashMap<String, Option<String>>>> = Mutex::new(None);

/// "Rocket League®" and "rocket league" are the same game.
fn key(name: &str) -> String { name.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect() }

fn home() -> PathBuf { PathBuf::from(std::env::var_os("HOME").unwrap_or_default()) }

pub fn lookup(game: &str) -> Option<String> {
    let wanted = key(game);
    if wanted.is_empty() || wanted == "unknown" { return None }
    let mut cache = CACHE.lock().unwrap();
    let cache = cache.get_or_insert_with(HashMap::new);
    if let Some(hit) = cache.get(&wanted) { return hit.clone() }
    let found = find(game, &wanted).and_then(|path| data_url(&path));
    cache.insert(wanted, found.clone());
    found
}

fn find(game: &str, wanted: &str) -> Option<PathBuf> {
    // The detector names unknown Steam games "Steam <appid>".
    if let Some(id) = game.strip_prefix("Steam ").filter(|id| id.chars().all(|c| c.is_ascii_digit())) {
        if let Some(icon) = steam_icon(id) { return Some(icon) }
    }
    // Games played through a launcher show the launcher's icon.
    let launchers: &[&str] = match wanted { "roblox" => &["sober", "roblox"], "minecraft" => &["prismlauncher", "oneclient", "minecraftlauncher", "multimc"], _ => &[] };
    heroic(wanted).or_else(|| steam(wanted)).or_else(|| desktop_entry(wanted))
        .or_else(|| launchers.iter().find_map(|l| desktop_entry(l)))
}

fn heroic(wanted: &str) -> Option<PathBuf> {
    let roots = [home().join(".config/heroic"), home().join(".var/app/com.heroicgameslauncher.hgl/config/heroic")];
    for root in roots.iter().filter(|r| r.is_dir()) {
        for store in ["legendary_library.json", "gog_library.json", "nile_library.json"] {
            let Ok(text) = fs::read_to_string(root.join("store_cache").join(store)) else { continue };
            let Ok(json) = serde_json::from_str::<Value>(&text) else { continue };
            let games: Vec<&Value> = match &json["library"] {
                Value::Array(list) => list.iter().collect(),
                Value::Object(map) => map.values().collect(),
                _ => vec![],
            };
            for g in games {
                if g["title"].as_str().map(key).as_deref() != Some(wanted) { continue }
                let Some(id) = g["app_name"].as_str() else { continue };
                for ext in ["png", "jpg", "jpeg", "webp"] {
                    let icon = root.join("icons").join(format!("{id}.{ext}"));
                    if icon.is_file() { return Some(icon) }
                }
            }
        }
    }
    None
}

fn steam_roots() -> Vec<PathBuf> {
    [home().join(".local/share/Steam"), home().join(".steam/steam"), home().join(".var/app/com.valvesoftware.Steam/.local/share/Steam")]
        .into_iter().filter(|r| r.is_dir()).collect()
}

fn steam(wanted: &str) -> Option<PathBuf> {
    crate::detect::steam_apps().into_iter().find(|(_, name)| key(name) == wanted).and_then(|(id, _)| steam_icon(&id))
}

/// Steam writes steam_icon_<id>.png into the icon theme for desktop shortcuts,
/// and keeps the store icon in appcache/librarycache/<id>/<sha1>.jpg.
fn steam_icon(id: &str) -> Option<PathBuf> {
    theme_icon(&format!("steam_icon_{id}")).or_else(|| {
        steam_roots().into_iter().find_map(|root| {
            let dir = root.join("appcache/librarycache").join(id);
            fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).find(|p| {
                let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                stem.len() == 40 && stem.chars().all(|c| c.is_ascii_hexdigit())
            })
        })
    })
}

fn desktop_entry(wanted: &str) -> Option<PathBuf> {
    let dirs = [home().join(".local/share/applications"), PathBuf::from("/usr/share/applications"),
        home().join(".local/share/flatpak/exports/share/applications"), PathBuf::from("/var/lib/flatpak/exports/share/applications")];
    for dir in dirs {
        let Ok(entries) = fs::read_dir(dir) else { continue };
        for entry in entries.flatten() {
            let text = fs::read_to_string(entry.path()).unwrap_or_default();
            let field = |k: &str| text.lines().find_map(|l| l.strip_prefix(k)).map(str::trim);
            if field("Name=").map(key).as_deref() != Some(wanted) { continue }
            let Some(icon) = field("Icon=") else { continue };
            let path = Path::new(icon);
            if path.is_absolute() && path.is_file() { return Some(path.to_path_buf()) }
            if let Some(found) = theme_icon(icon) { return Some(found) }
        }
    }
    None
}

/// The largest PNG of `name` in the hicolor theme, then pixmaps.
fn theme_icon(name: &str) -> Option<PathBuf> {
    for base in [home().join(".local/share/icons/hicolor"), PathBuf::from("/usr/share/icons/hicolor"),
        home().join(".local/share/flatpak/exports/share/icons/hicolor"), PathBuf::from("/var/lib/flatpak/exports/share/icons/hicolor")] {
        for size in ["512x512", "256x256", "128x128", "96x96", "64x64", "48x48", "32x32"] {
            let path = base.join(size).join("apps").join(format!("{name}.png"));
            if path.is_file() { return Some(path) }
        }
    }
    for base in [home().join(".local/share/flatpak/exports/share/icons/hicolor"), PathBuf::from("/var/lib/flatpak/exports/share/icons/hicolor"), PathBuf::from("/usr/share/icons/hicolor")] {
        let path = base.join("scalable/apps").join(format!("{name}.svg"));
        if path.is_file() { return Some(path) }
    }
    Some(PathBuf::from(format!("/usr/share/pixmaps/{name}.png"))).filter(|p| p.is_file())
}

fn data_url(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok().filter(|b| b.len() < 4 * 1024 * 1024)?;
    let mime = match path.extension()?.to_str()?.to_lowercase().as_str() {
        "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", "webp" => "image/webp", "svg" => "image/svg+xml", _ => return None,
    };
    Some(format!("data:{mime};base64,{}", base64(&bytes)))
}

fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().enumerate().fold(0u32, |n, (i, b)| n | (*b as u32) << (16 - 8 * i));
        for i in 0..4 {
            out.push(if i <= chunk.len() { ALPHABET[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_and_base64() {
        assert_eq!(key("Rocket League®"), key("rocket league"));
        assert_eq!(base64(b"Man"), "TWFu");
        assert_eq!(base64(b"Ma"), "TWE=");
        assert_eq!(base64(b"M"), "TQ==");
        assert_eq!(lookup("Unknown"), None);
    }
}
#[cfg(test)]
mod local_check {
    #[test]
    #[ignore = "reads this machine's launcher caches"]
    fn finds_installed_games() { for game in ["Rocket League", "Among Us", "Roblox", "Minecraft", "Schedule I", "Who's Cheating?"] {
        eprintln!("{game} icon: {:?}", super::lookup(game).map(|u| u[..30].to_owned()));
    } }
}
