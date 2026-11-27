//! Game detection on Linux: port of linuxProcessSnapshot (main/linux.ts),
//! detectKnownGame and the Steam fallback in detectCurrentGame (main/main.ts),
//! with the same bundled games.json and the user's learned games.
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fs;

#[derive(Debug, Clone, PartialEq)]
pub struct Game { pub name: String, pub pid: u32 }

struct Process { pid: u32, exe: String, steam_app: String, rss: u64, start: u64 }

fn is_infrastructure(exe: &str) -> bool {
    let exe = exe.to_lowercase();
    let exe = exe.strip_suffix(".exe").unwrap_or(&exe);
    matches!(exe, "wine" | "wine64" | "wine-preloader" | "wine64-preloader" | "wineserver" | "proton" | "steam"
        | "steamwebhelper" | "reaper" | "srt-bwrap") || exe.starts_with("pressure-vessel")
}

/// Under Wine the process is wine-preloader; the game is the .exe in its arguments.
fn game_executable(exe: &str, cmdline: &str) -> String {
    let lower = exe.to_lowercase();
    if !matches!(lower.as_str(), "wine" | "wine64" | "wine-preloader" | "wine64-preloader") { return exe.into() }
    cmdline.split('\0')
        .map(|arg| arg.rsplit(['/', '\\']).next().unwrap_or_default())
        .find(|c| c.to_lowercase().ends_with(".exe") && !is_infrastructure(c))
        .map_or_else(|| exe.into(), str::to_owned)
}

fn steam_app_id(environ: &str, cmdline: &str) -> String {
    for var in environ.split('\0') {
        for key in ["SteamAppId=", "STEAM_COMPAT_APP_ID="] {
            if let Some(id) = var.strip_prefix(key).filter(|id| id.parse::<u64>().is_ok_and(|n| n > 0)) { return id.into() }
        }
    }
    cmdline.split(['/', '\\']).skip_while(|p| *p != "compatdata").nth(1)
        .map(|id| id.split(['\0', ' ']).next().unwrap_or_default())
        .filter(|id| id.parse::<u64>().is_ok_and(|n| n > 0)).unwrap_or_default().into()
}

fn snapshot() -> Vec<Process> {
    let read = |path: String| fs::read_to_string(path).unwrap_or_default();
    let Ok(entries) = fs::read_dir("/proc") else { return vec![] };
    entries.flatten().filter_map(|entry| {
        let pid: u32 = entry.file_name().to_str()?.parse().ok()?;
        let dir = format!("/proc/{pid}");
        let cmdline = read(format!("{dir}/cmdline"));
        let path = fs::read_link(format!("{dir}/exe")).ok();
        let base = path.as_ref().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| read(format!("{dir}/comm")).trim().to_owned());
        let mut exe = game_executable(&base, &cmdline);
        // Minecraft Java runs as plain `java`; its arguments name it.
        if matches!(exe.as_str(), "java" | "javaw") && cmdline.to_lowercase().contains("minecraft") { exe = "minecraft-java".into() }
        if exe.is_empty() { return None }
        let stat = read(format!("{dir}/stat"));
        let fields: Vec<&str> = stat.rsplit_once(')').map_or("", |(_, rest)| rest).split_whitespace().collect();
        let rss = read(format!("{dir}/status")).lines().find_map(|l| l.strip_prefix("VmRSS:"))
            .and_then(|v| v.split_whitespace().next()?.parse::<u64>().ok()).unwrap_or(0) * 1024;
        Some(Process { pid, exe, rss, start: fields.get(19).and_then(|f| f.parse().ok()).unwrap_or(0),
            steam_app: steam_app_id(&read(format!("{dir}/environ")), &cmdline.replace('\0', " ")) })
    }).collect()
}

pub struct Detector { db: HashMap<String, String>, pub current: Option<Game> }

impl Detector {
    pub fn new() -> Detector {
        let raw: Value = serde_json::from_str(include_str!("../../../../packages/flash-detector/src/games.json")).unwrap_or_default();
        let mut db: HashMap<String, String> = raw["games"].as_array().into_iter().flatten().filter_map(|g| {
            Some((g["processName"].as_str()?.to_lowercase(), g["displayName"].as_str()?.to_owned()))
        }).collect();
        // Linux names for games the shared (Windows) list knows by another process name.
        for (process, name) in [("sober", "Roblox"), ("minecraft-java", "Minecraft"), ("among us.exe", "Among Us")] {
            db.insert(process.into(), name.into());
        }
        Detector { db, current: None }
    }

    /// The game running now, preferring the one already tracked, then the newest.
    pub fn detect(&self, learned: &Map<String, Value>) -> Option<Game> {
        let processes = snapshot();
        let mut matches: Vec<(&Process, String)> = processes.iter().filter(|p| !is_infrastructure(&p.exe)).filter_map(|p| {
            let key = p.exe.to_lowercase();
            let name = self.db.get(&key).cloned().or_else(|| learned.get(&key)?.as_str().map(str::to_owned))?;
            Some((p, name))
        }).collect();
        if !matches.is_empty() {
            let keep = self.current.as_ref().map(|g| g.pid);
            matches.sort_by_key(|(p, _)| (Some(p.pid) != keep, std::cmp::Reverse(p.start)));
            let (p, name) = &matches[0];
            return Some(Game { name: name.clone(), pid: p.pid });
        }
        // Nothing known: a Steam game is still a game, named from its install manifest.
        let apps = steam_apps();
        processes.iter().filter(|p| !p.steam_app.is_empty() && !is_infrastructure(&p.exe))
            .filter_map(|p| match apps.get(&p.steam_app) {
                Some(name) if is_steam_tool(name) => None,
                Some(name) => Some((p, name.clone())),
                None => Some((p, format!("Steam {}", p.steam_app))),
            })
            .max_by_key(|(p, _)| p.rss).map(|(p, name)| Game { name, pid: p.pid })
    }
}

/// Steam apps that run with an app id but are not games.
fn is_steam_tool(name: &str) -> bool {
    ["Wallpaper Engine", "OBS Studio", "Proton", "Steam Linux Runtime", "Steamworks"].iter().any(|t| name.starts_with(t))
}

fn home() -> std::path::PathBuf { std::path::PathBuf::from(std::env::var_os("HOME").unwrap_or_default()) }

/// Every Steam library folder, from each Steam install's libraryfolders.vdf.
pub fn steam_libraries() -> Vec<std::path::PathBuf> {
    let mut libs: Vec<std::path::PathBuf> = vec![];
    for root in [home().join(".local/share/Steam"), home().join(".steam/steam"), home().join(".var/app/com.valvesoftware.Steam/.local/share/Steam")] {
        let vdf = fs::read_to_string(root.join("steamapps/libraryfolders.vdf")).unwrap_or_default();
        let paths = vdf.lines().filter_map(|l| l.trim().strip_prefix("\"path\"")).map(|v| v.trim().trim_matches('"').replace("\\\\", "\\"));
        for lib in std::iter::once(root.clone()).chain(paths.map(Into::into)) {
            let lib = fs::canonicalize(&lib).unwrap_or(lib);
            if lib.join("steamapps").is_dir() && !libs.contains(&lib) { libs.push(lib) }
        }
    }
    libs
}

/// Installed Steam apps: app id -> name.
pub fn steam_apps() -> HashMap<String, String> {
    steam_libraries().iter().flat_map(|lib| fs::read_dir(lib.join("steamapps")).into_iter().flatten().flatten()).filter_map(|entry| {
        let file = entry.file_name().to_string_lossy().into_owned();
        let id = file.strip_prefix("appmanifest_")?.strip_suffix(".acf")?.to_owned();
        let text = fs::read_to_string(entry.path()).ok()?;
        Some((id, text.lines().find_map(|l| l.trim().strip_prefix("\"name\""))?.trim().trim_matches('"').to_owned()))
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wine_and_steam_parsing() {
        assert_eq!(game_executable("wine64-preloader", "C:\\Games\\RocketLeague.exe\0-nomovie"), "RocketLeague.exe");
        assert_eq!(game_executable("cs2", ""), "cs2");
        assert!(is_infrastructure("steamwebhelper") && is_infrastructure("pressure-vessel-wrap") && !is_infrastructure("cs2"));
        assert_eq!(steam_app_id("A=1\0SteamAppId=252950\0", ""), "252950");
        assert_eq!(steam_app_id("", "/home/u/.steam/steamapps/compatdata/730/pfx"), "730");
        assert_eq!(steam_app_id("SteamAppId=0", ""), "");
        let db = Detector::new().db;
        assert!(db.contains_key("cs2.exe") && db["sober"] == "Roblox" && db["minecraft-java"] == "Minecraft");
        assert!(is_steam_tool("Wallpaper Engine") && !is_steam_tool("Schedule I"));
    }
}
