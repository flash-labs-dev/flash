//! The clip library: port of scanClips, renameClip, moveClipToGame, the star
//! and thumbnail handlers in apps/desktop/src/main/main.ts and the sidecar rules
//! in apps/desktop/src/shared/clipFiles.ts. Same files on disk, so the Electron
//! and Tauri builds can read each other's libraries.
//!
//! shortcut: legacy `<stem>.json` sidecars (pre-beta) are not migrated here;
//! the Electron build migrates them the first time it scans a folder.
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

fn sidecar_path(file: &Path) -> PathBuf {
    let mut name = file.as_os_str().to_owned();
    name.push(".json");
    PathBuf::from(name)
}

/// None when there is no sidecar. An unreadable one protects the clip (starred),
/// so losing metadata can never make a clip a prune candidate.
pub fn read_sidecar(file: &Path) -> Option<Map<String, Value>> {
    let text = match fs::read_to_string(sidecar_path(file)) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return None,
        Err(_) => return Some(unreadable()),
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(map)) if valid(&map) => Some(map),
        _ => Some(unreadable()),
    }
}

fn unreadable() -> Map<String, Value> {
    let mut map = Map::new();
    map.insert("starred".into(), json!(true));
    map.insert("unreadable".into(), json!(true));
    map
}

fn valid(map: &Map<String, Value>) -> bool {
    map.get("starred").map_or(true, Value::is_boolean)
        && map.get("game").map_or(true, Value::is_string)
        && map.get("duration").map_or(true, |d| d.as_f64().is_some_and(|d| d.is_finite() && d >= 0.0))
}

pub fn write_sidecar(file: &Path, metadata: &Map<String, Value>) -> std::io::Result<()> {
    let path = sidecar_path(file);
    let temp = PathBuf::from(format!("{}.{}.tmp", path.display(), std::process::id()));
    fs::write(&temp, serde_json::to_vec(metadata)?)?;
    fs::rename(&temp, &path).inspect_err(|_| { fs::remove_file(&temp).ok(); })
}

fn is_media(file: &Path) -> bool {
    matches!(ext(file).as_str(), "mp4" | "png")
}

fn ext(file: &Path) -> String {
    file.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

fn millis(time: std::io::Result<std::time::SystemTime>) -> f64 {
    time.ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0.0, |d| d.as_secs_f64() * 1000.0)
}

/// True when `file` is inside `root` after resolving `..` and symlinks.
pub fn is_inside(root: &str, file: &Path) -> bool {
    let (Ok(root), Some(parent)) = (fs::canonicalize(root), file.parent()) else { return false };
    // The file may not exist yet (rename targets), so resolve its folder.
    fs::canonicalize(parent).is_ok_and(|p| p.starts_with(&root)) && file.file_name().is_some()
}

pub fn scan(root: &str) -> Vec<Value> {
    let mut clips = Vec::new();
    scan_dir(Path::new(root), "", &mut clips);
    clips.sort_by(|a, b| b["createdAt"].as_f64().partial_cmp(&a["createdAt"].as_f64()).unwrap_or(std::cmp::Ordering::Equal));
    clips
}

fn scan_dir(dir: &Path, game: &str, clips: &mut Vec<Value>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        if meta.is_dir() {
            scan_dir(&path, &name, clips);
            continue;
        }
        if name.contains(".partial.") || !(name.ends_with(".mp4") || name.ends_with(".png")) { continue }
        let shot = name.ends_with(".png");
        let sidecar = read_sidecar(&path);
        let field = |key: &str| sidecar.as_ref().and_then(|s| s.get(key).cloned());
        // Real duration comes from the sidecar; older clips get a ~2 MB/s estimate.
        let seconds = if shot { 0 } else {
            field("duration").and_then(|d| d.as_f64()).map(|d| d as u64)
                .unwrap_or_else(|| (meta.len() / (2 * 1024 * 1024)).max(1))
        };
        let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let created = match millis(meta.created()) { 0.0 => millis(meta.modified()), t => t };
        let sidecar_game = field("game").and_then(|g| g.as_str().map(str::to_owned)).filter(|g| !g.is_empty());
        let file = path.to_string_lossy();
        clips.push(json!({
            "id": file, "filePath": file,
            "title": stem.replace(['_', '-'], " "),
            "game": sidecar_game.unwrap_or_else(|| if game.is_empty() { "Unknown".into() } else { game.into() }),
            "kind": if shot { "shot" } else { "clip" },
            "duration": if shot { "—".to_string() } else { format!("{}:{:02}", seconds / 60, seconds % 60) },
            "durationSec": seconds,
            "size": meta.len(),
            "createdAt": created,
            "starred": field("starred") == Some(json!(true)),
        }));
    }
}

pub fn storage(root: &str) -> Value {
    let clips = scan(root);
    let used: u64 = clips.iter().filter_map(|c| c["size"].as_u64()).sum();
    json!({ "used": used, "clips": clips.len() })
}

/// Port of validateClipName in apps/desktop/src/shared/rename.ts.
pub fn validate_name(name: &str) -> Option<&'static str> {
    let trimmed = name.trim();
    if trimmed.is_empty() { return Some("Enter a name") }
    if trimmed.chars().all(|c| c == '.') { return Some("A name cannot contain only dots") }
    if name.contains(['\\', '/', ':', '*', '?', '"', '<', '>', '|']) { return Some("Names cannot contain \\ / : * ? \" < > or |") }
    if name.ends_with(['.', ' ']) { return Some("Names cannot end with a dot or space") }
    None
}

/// First free `<stem><ext>`, `<stem>_2<ext>`, ... in `folder`, ignoring `skip`.
fn free_name(folder: &Path, stem: &str, extension: &str, skip: &[&Path]) -> PathBuf {
    for counter in 1.. {
        let name = if counter == 1 { format!("{stem}{extension}") } else { format!("{stem}_{counter}{extension}") };
        let candidate = folder.join(&name);
        let taken = |p: &Path| !skip.iter().any(|s| s.as_os_str().eq_ignore_ascii_case(p.as_os_str())) && p.exists();
        if !taken(&candidate) && !taken(&sidecar_path(&candidate)) { return candidate }
    }
    unreachable!()
}

/// Moves a clip and its sidecar together, restoring the clip if the sidecar fails.
fn move_pair(from: &Path, to: &Path) -> Result<(), String> {
    let (from_meta, to_meta) = (sidecar_path(from), sidecar_path(to));
    let has_sidecar = from_meta.exists();
    fs::rename(from, to).map_err(|e| e.to_string())?;
    if has_sidecar {
        if let Err(e) = fs::rename(&from_meta, &to_meta) {
            return Err(match fs::rename(to, from) {
                Ok(()) => e.to_string(),
                Err(_) => "The move failed and the original clip could not be restored".into(),
            });
        }
    }
    Ok(())
}

pub fn rename(root: &str, file: &str, requested: &str) -> Value {
    let file = Path::new(file);
    let name = requested.trim();
    if let Some(error) = validate_name(name) { return json!({ "error": error }) }
    if !is_inside(root, file) || !file.exists() || !is_media(file) { return json!({ "error": "Clip not found" }) }
    let extension = format!(".{}", ext(file));
    let folder = file.parent().unwrap();
    let target = free_name(folder, name, &extension, &[file, &sidecar_path(file)]);
    if target == file { return json!({ "filePath": file }) }
    match move_pair(file, &target) {
        Ok(()) => json!({ "filePath": target }),
        Err(error) => json!({ "error": error }),
    }
}

pub fn move_to_game(root: &str, file: &str, requested: &str) -> Result<PathBuf, String> {
    let file = Path::new(file);
    let game = requested.trim();
    if let Some(error) = validate_name(game) { return Err(error.into()) }
    if !is_inside(root, file) || !file.exists() || !is_media(file) { return Err("Clip not found".into()) }
    let folder = Path::new(root).join(game);
    if file.parent() == Some(folder.as_path()) { return Ok(file.to_path_buf()) }
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let mut metadata = read_sidecar(file).unwrap_or_default();
    if metadata.contains_key("unreadable") { return Err("Could not read clip metadata".into()) }
    let stem = file.file_stem().unwrap().to_string_lossy();
    let target = free_name(&folder, &stem, &format!(".{}", file.extension().unwrap().to_string_lossy()), &[]);
    move_pair(file, &target)?;
    metadata.insert("game".into(), json!(game));
    write_sidecar(&target, &metadata).map_err(|e| e.to_string())?;
    Ok(target)
}

pub fn move_many(root: &str, files: &[Value], game: &str) -> Value {
    let (mut moved, mut errors) = (0, Vec::new());
    for file in files.iter().filter_map(Value::as_str) {
        match move_to_game(root, file, game) { Ok(_) => moved += 1, Err(e) => errors.push(e) }
    }
    if errors.is_empty() { return json!({ "moved": moved }) }
    let n = errors.len();
    json!({ "moved": moved, "error": format!("{n} item{} could not be moved: {}", if n == 1 { "" } else { "s" }, errors[0]) })
}

pub fn set_starred(root: &str, file: &str, starred: bool) -> Value {
    let file = Path::new(file);
    if !is_inside(root, file) || !file.exists() { return json!({ "error": "Clip not found" }) }
    let mut metadata = read_sidecar(file).unwrap_or_default();
    if metadata.contains_key("unreadable") { return json!({ "error": "Could not read clip metadata" }) }
    metadata.insert("starred".into(), json!(starred));
    match write_sidecar(file, &metadata) {
        Ok(()) => json!({ "starred": starred }),
        Err(e) => json!({ "error": e.to_string() }),
    }
}

pub fn delete(root: &str, file: &str) -> Value {
    let file = Path::new(file);
    if !is_inside(root, file) || !is_media(file) { return json!({ "deleted": false, "error": "Clip not found" }) }
    match fs::remove_file(file) {
        Ok(()) => { fs::remove_file(sidecar_path(file)).ok(); json!({ "deleted": true }) }
        Err(e) => json!({ "deleted": false, "error": e.to_string() }),
    }
}

/// One JPEG per clip version, keyed by path, size and mtime like the Electron build.
pub fn thumbnail_file(cache: &Path, root: &str, file: &str) -> Option<PathBuf> {
    use std::hash::{Hash, Hasher};
    let path = Path::new(file);
    if !is_inside(root, path) { return None }
    let meta = fs::metadata(path).ok()?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    (file.to_lowercase(), meta.len(), millis(meta.modified()) as u64).hash(&mut hasher);
    Some(cache.join("thumbnails").join(format!("{:016x}.jpg", hasher.finish())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn library_round_trip() {
        let root = std::env::temp_dir().join(format!("flash-lib-{}", std::process::id()));
        let game = root.join("Rocket League");
        fs::create_dir_all(&game).unwrap();
        let clip = game.join("2026-11-26_10-00-00.mp4");
        fs::write(&clip, b"x").unwrap();
        let r = root.to_str().unwrap();

        let clips = scan(r);
        assert_eq!(clips.len(), 1);
        assert_eq!(clips[0]["game"], "Rocket League");
        assert_eq!(clips[0]["starred"], false);

        assert_eq!(set_starred(r, clip.to_str().unwrap(), true)["starred"], true);
        assert_eq!(scan(r)[0]["starred"], true);

        let renamed = rename(r, clip.to_str().unwrap(), "Big save");
        let renamed = renamed["filePath"].as_str().unwrap().to_string();
        assert!(renamed.ends_with("Big save.mp4"));
        assert!(Path::new(&format!("{renamed}.json")).exists(), "sidecar follows the rename");
        assert!(rename(r, &renamed, "a/b")["error"].is_string());

        assert_eq!(move_many(r, &[json!(renamed)], "Valorant")["moved"], 1);
        let clips = scan(r);
        assert_eq!(clips[0]["game"], "Valorant");
        assert_eq!(clips[0]["starred"], true, "star survives the move");

        assert!(delete(r, "/etc/passwd")["error"].is_string(), "nothing outside the library");
        assert_eq!(delete(r, clips[0]["filePath"].as_str().unwrap())["deleted"], true);
        assert!(scan(r).is_empty());
        fs::remove_dir_all(root).ok();
    }
}
