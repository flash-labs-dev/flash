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
        let exe = game_executable(&base, &cmdline);
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
        let db = raw["games"].as_array().into_iter().flatten().filter_map(|g| {
            Some((g["processName"].as_str()?.to_lowercase(), g["displayName"].as_str()?.to_owned()))
        }).collect();
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
        // Nothing known: a Steam game is still a game, named by its app id.
        processes.iter().filter(|p| !p.steam_app.is_empty() && !is_infrastructure(&p.exe))
            .max_by_key(|p| p.rss).map(|p| Game { name: format!("Steam {}", p.steam_app), pid: p.pid })
    }
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
        assert!(Detector::new().db.contains_key("cs2.exe"));
    }
}
