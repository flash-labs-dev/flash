//! Share links and size-limited exports on Linux: the port of master's
//! share-clip-link / export-clip handlers (main.ts). Clips carry two audio
//! tracks (game + mic), which browsers and Discord would play only the first
//! of, so both are mixed into one before upload.
// shortcut: uses the system ffmpeg/ffprobe/curl instead of the engine's libav; move into the engine if a distro lacks them.
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};

const UPLOAD_ENDPOINT: &str = "https://share.flashclipping.fyi/flash-clips";
const PAGE_ORIGIN: &str = "https://flashclipping.fyi";
const MAX_BYTES: u64 = 100 * 1048576;
const SHARE_DAYS: u32 = 7;
const SHARE_TARGET_KBPS: f64 = 5000.0;
const SHARE_ORIGINAL_MAX_KBPS: f64 = 5500.0;
const AUDIO_KBPS: f64 = 160.0;

static SHARING: AtomicBool = AtomicBool::new(false);

struct Probe { duration: f64, audio_tracks: usize, height: u32 }

fn probe(file: &Path) -> Option<Probe> {
    let out = Command::new("ffprobe").args(["-v", "error", "-show_entries", "stream=codec_type,height:format=duration", "-of", "json"])
        .arg(file).output().ok().filter(|o| o.status.success())?;
    let info: Value = serde_json::from_slice(&out.stdout).ok()?;
    let streams = info["streams"].as_array()?;
    Some(Probe {
        duration: info["format"]["duration"].as_str()?.parse().ok()?,
        audio_tracks: streams.iter().filter(|s| s["codec_type"] == "audio").count(),
        height: streams.iter().find_map(|s| s["height"].as_u64()).unwrap_or(0) as u32,
    })
}

/// Re-encode `input` into `output`: audio tracks mixed into one, and video
/// capped at `video_kbps` (None copies the video as is). Max 60 fps.
fn transcode(input: &Path, output: &Path, audio_tracks: usize, video_kbps: Option<f64>) -> Result<(), String> {
    let mut cmd = Command::new("ffmpeg");
    cmd.args(["-hide_banner", "-loglevel", "error", "-y", "-i"]).arg(input).args(["-map", "0:v:0"]);
    match audio_tracks {
        0 => {}
        1 => { cmd.args(["-map", "0:a:0", "-c:a", "copy"]); }
        n => {
            let inputs: String = (0..n).map(|i| format!("[0:a:{i}]")).collect();
            cmd.args(["-filter_complex", &format!("{inputs}amix=inputs={n}:normalize=0[a]"), "-map", "[a]", "-c:a", "aac", "-b:a", "160k"]);
        }
    }
    match video_kbps {
        None => { cmd.args(["-c:v", "copy"]); }
        Some(kbps) => {
            let kbps = kbps.max(300.0).round() as u64;
            cmd.args(["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-vf", "fps=fps='min(source_fps,60)'"])
                .args(["-b:v", &format!("{kbps}k"), "-maxrate", &format!("{}k", kbps * 11 / 10), "-bufsize", &format!("{}k", kbps * 2)]);
        }
    }
    let out = cmd.args(["-movflags", "+faststart"]).arg(output).output()
        .map_err(|_| "Sharing needs ffmpeg installed (sudo pacman -S ffmpeg).".to_owned())?;
    if out.status.success() { Ok(()) } else {
        eprintln!("flash: ffmpeg failed: {}", String::from_utf8_lossy(&out.stderr));
        Err("Could not prepare the clip.".into())
    }
}

fn temp_file() -> PathBuf {
    let dir = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
    dir.join(format!("flash-share-{}-{nanos}.mp4", std::process::id()))
}

/// The server's answer is data: only a path of the exact shape it generates
/// becomes a link, always joined to our own origin.
fn share_url(path: &str) -> Option<String> {
    let id = path.strip_prefix("/c/")?.strip_suffix(".mp4")?;
    (id.len() == 12 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')).then(|| format!("{PAGE_ORIGIN}/c/{id}"))
}

fn upload(file: &Path) -> Result<String, String> {
    let out = Command::new("curl").args(["-sS", "--max-time", "300", "-X", "POST", "-H", "Content-Type: video/mp4", "-w", "\n%{http_code}", "--data-binary"])
        .arg(format!("@{}", file.display())).arg(UPLOAD_ENDPOINT).output()
        .map_err(|_| "Sharing needs curl installed.".to_owned())?;
    let body = String::from_utf8_lossy(&out.stdout);
    let (answer, status) = body.trim_end().rsplit_once('\n').unwrap_or(("", body.trim()));
    match status {
        "201" => {}
        "429" => return Err("Too many links this hour. Try again later.".into()),
        "507" => return Err("The share server is full right now.".into()),
        "413" => return Err("The server refused this clip as too big.".into()),
        _ => return Err("Could not reach the share server.".into()),
    }
    let answer: Value = serde_json::from_str(answer).unwrap_or_default();
    answer["path"].as_str().and_then(share_url).ok_or_else(|| "The share server sent an unexpected answer.".into())
}

pub fn share(file: &Path) -> Value {
    if SHARING.swap(true, Ordering::SeqCst) { return json!({ "ok": false, "error": "A link is already being made" }) }
    let temp = temp_file();
    let result = (|| {
        let info = probe(file).ok_or("Could not read the clip for sharing.")?;
        let bytes = std::fs::metadata(file).map_err(|_| "Clip not found")?.len();
        let kbps = bytes as f64 * 8.0 / info.duration.max(0.1) / 1000.0;
        let reencode = (kbps > SHARE_ORIGINAL_MAX_KBPS).then_some(SHARE_TARGET_KBPS - AUDIO_KBPS);
        let upload_path = if info.audio_tracks > 1 || reencode.is_some() {
            transcode(file, &temp, info.audio_tracks, reencode)?;
            temp.as_path()
        } else { file };
        if std::fs::metadata(upload_path).map(|m| m.len()).unwrap_or(0) > MAX_BYTES {
            return Err("This clip is over 100MB. Export a smaller copy and share that.".to_owned());
        }
        upload(upload_path)
    })();
    std::fs::remove_file(&temp).ok();
    SHARING.store(false, Ordering::SeqCst);
    match result {
        Ok(url) => { crate::copy_text(&url); json!({ "ok": true, "url": url, "days": SHARE_DAYS }) }
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

/// A smaller sibling `<name>-<N>MB.mp4` that fits `max_bytes`.
pub fn export(file: &Path, max_bytes: f64) -> Value {
    let Some(info) = probe(file) else { return json!({ "error": "Could not read the clip" }) };
    // 5% headroom for container overhead and rate-control overshoot.
    let video_kbps = max_bytes * 8.0 * 0.95 / info.duration.max(0.1) / 1000.0 - AUDIO_KBPS;
    if video_kbps < 300.0 { return json!({ "error": "That limit is too small for a clip this long" }) }
    let stem = file.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let output = file.with_file_name(format!("{stem}-{}MB.mp4", (max_bytes / 1048576.0).round()));
    if let Err(error) = transcode(file, &output, info.audio_tracks, Some(video_kbps)) { return json!({ "error": error }) }
    let mut meta = crate::library::read_sidecar(file).unwrap_or_default();
    meta.insert("duration".into(), json!(info.duration));
    crate::library::write_sidecar(&output, &meta).ok();
    json!({ "path": output, "bytes": std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0), "height": info.height, "codec": "h264", "duration": info.duration })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_server_shaped_paths_become_links() {
        assert_eq!(share_url("/c/AbC_-12345xY.mp4").as_deref(), Some("https://flashclipping.fyi/c/AbC_-12345xY"));
        assert_eq!(share_url("/c/short.mp4"), None);
        assert_eq!(share_url("https://evil/c/AbC_-12345xY.mp4"), None);
        assert_eq!(share_url("/c/AbC_-12345x/.mp4"), None);
    }

    #[test]
    #[ignore = "uploads a synthetic test clip to the real share server"]
    fn shares_a_two_track_clip() {
        let dir = std::env::temp_dir().join("flash-share-test");
        std::fs::create_dir_all(&dir).unwrap();
        let clip = dir.join("test.mp4");
        assert!(Command::new("ffmpeg").args(["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=60:d=3",
            "-f", "lavfi", "-i", "sine=f=440:d=3", "-f", "lavfi", "-i", "sine=f=660:d=3", "-map", "0", "-map", "1", "-map", "2",
            "-c:v", "libx264", "-b:v", "12M", "-c:a", "aac"]).arg(&clip).status().unwrap().success());
        let exported = export(&clip, 1048576.0);
        eprintln!("export: {exported}");
        assert!(exported["bytes"].as_u64().unwrap() <= 1048576);
        let shared = share(&clip);
        eprintln!("share: {shared}");
        assert_eq!(shared["ok"], true);
    }
}
