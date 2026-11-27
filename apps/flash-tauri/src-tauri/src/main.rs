// Flash on Tauri: the Electron main process, rewritten in Rust.
//
// The React UI is unchanged. Its preload (`apps/desktop/src/preload/preload.ts`)
// is bundled against a small `electron` shim, so every `ipcRenderer.invoke`
// arrives here as one `ipc` command with the Electron channel name, and every
// main-to-renderer message goes out as a Tauri event of the same name.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod detect;
#[cfg(target_os = "linux")]
mod engine;
mod hotkeys;
mod library;
mod settings;

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::sync::watch;

const CLIP_SOUND: &[u8] = include_bytes!("../../../../assets/sounds/clip-saved.wav");

struct App {
    settings: Mutex<settings::Store>,
    // One save at a time, like saveClipNow in the Electron build.
    saving: Arc<Mutex<()>>,
    game: Mutex<Option<detect::Game>>,
    hotkey_status: Arc<Mutex<[bool; 3]>>,
    hotkey_keys: watch::Sender<[String; 3]>,
    cache: PathBuf,
    toasts: AtomicU64,
    // One engine start at a time (launch, tray, UI and settings can all ask).
    starting: Mutex<()>,
    // Like Electron's isRecording: on once start succeeds. The engine's own flag
    // stays false until the capture thread connects, which reads as "not recording".
    recording: std::sync::atomic::AtomicBool,
}

impl App {
    fn get(&self, key: &str) -> Value { self.settings.lock().unwrap().values.get(key).cloned().unwrap_or(Value::Null) }
    fn root(&self) -> String { self.get("clipsFolder").as_str().unwrap_or_default().to_owned() }
    fn keys(&self) -> [String; 3] {
        let text = |key| self.get(key).as_str().unwrap_or_default().to_owned();
        // shortcut: the C API has no screenshot call yet, so the screenshot key is not bound.
        [text("hotkey"), text("hotkeyShort"), String::new()]
    }
}

/// Starts the replay buffer from the current settings and tells the UI.
fn start_capture(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<App>();
    let _starting = state.starting.lock().unwrap();
    let (dir, display, buffer, quality, window) = {
        let state = app.state::<App>();
        let store = state.settings.lock().unwrap();
        let v = &store.values;
        let pid = if v.get("captureMode") == Some(&json!("game")) { state.game.lock().unwrap().as_ref().map_or(0, |g| g.pid) } else { 0 };
        (v["clipsFolder"].as_str().unwrap_or_default().to_string(), v["displayId"].as_u64().unwrap_or(0) as u32,
         v["bufferLength"].as_u64().unwrap_or(30) as u32, engine::quality(v["quality"].as_str().unwrap_or("1080p 60fps")), pid)
    };
    std::fs::create_dir_all(&dir).ok();
    engine::set_capture_window(window);
    let result = engine::start(&dir, display, buffer, &quality);
    eprintln!("flash: replay buffer {}", match &result { Ok(()) => "started".to_string(), Err(e) => format!("failed: {e}") });
    state.recording.store(result.is_ok(), Ordering::SeqCst);
    app.emit("recording-state", [result.is_ok()]).ok();
    result
}

fn recording(app: &AppHandle) -> bool { app.state::<App>().recording.load(Ordering::SeqCst) }

fn stop_capture(app: &AppHandle) {
    engine::stop();
    app.state::<App>().recording.store(false, Ordering::SeqCst);
    app.emit("recording-state", [false]).ok();
}

/// Settings that the engine reads at start apply by restarting it, if it was running.
fn restart_capture(app: &AppHandle) {
    if !recording(app) { return }
    engine::stop();
    if let Err(e) = start_capture(app) { eprintln!("flash: capture failed to restart: {e}") }
}

async fn save_clip(handle: &AppHandle, seconds: f64) -> Value {
    let app = handle.state::<App>();
    let game = app.game.lock().unwrap().as_ref().map_or("Unknown".to_owned(), |g| g.name.clone());
    let saving = app.saving.clone();
    handle.emit("clip-save-state", [json!({ "saving": true })]).ok();
    let name = game.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _one_at_a_time = saving.lock().unwrap();
        engine::save_clip(seconds, &name)
    }).await.unwrap_or_else(|e| Err(e.to_string()));
    match result {
        Ok((path, duration)) => {
            let mut sidecar = serde_json::Map::new();
            sidecar.insert("duration".into(), json!(duration.round()));
            sidecar.insert("game".into(), json!(game));
            // The clip is on disk; metadata is an optimisation.
            library::write_sidecar(Path::new(&path), &sidecar).ok();
            handle.emit("clip-save-state", [json!({ "saving": false })]).ok();
            handle.emit("clip-saved-refresh", Vec::<Value>::new()).ok();
            if app.get("notifications") != json!(false) {
                show_toast(handle, duration, &game);
                play_sound(&app.cache);
            }
            json!({ "path": path, "duration": duration })
        }
        Err(error) => {
            handle.emit("clip-save-state", [json!({ "saving": false, "error": error })]).ok();
            json!({ "error": error })
        }
    }
}

fn encode(text: &str) -> String {
    text.bytes().map(|b| match b {
        b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => (b as char).to_string(),
        _ => format!("%{b:02X}"),
    }).collect()
}

fn decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok());
            if let Some(b) = hex { out.push(b); i += 3; continue }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Straight to PipeWire (or Pulse), not the webview: WebKitGTK plays audio only
/// when gst-plugins-good is installed, and many systems lack it.
fn play_sound(cache: &Path) {
    let file = cache.join("clip-saved.wav");
    if !file.exists() { std::fs::create_dir_all(cache).ok(); std::fs::write(&file, CLIP_SOUND).ok(); }
    let played = Command::new("pw-play").args(["--volume", "0.6"]).arg(&file).spawn().is_ok();
    if !played { Command::new("paplay").arg(&file).spawn().ok(); }
}

/// The clip toast: its own small window in the chosen corner, which slides out after three seconds.
fn show_toast(handle: &AppHandle, duration: f64, game: &str) {
    let app = handle.state::<App>();
    for (label, window) in handle.webview_windows() { if label.starts_with("toast-") { window.close().ok(); } }
    let label = format!("toast-{}", app.toasts.fetch_add(1, Ordering::Relaxed));
    let corner = app.get("overlayPosition").as_str().unwrap_or("top-left").to_owned();
    let url = format!("toast.html?duration={}&game={}&position={}", duration.round(), encode(game), encode(&corner));
    let (width, height, pad) = (280.0, 64.0, 16.0);
    let mut builder = WebviewWindowBuilder::new(handle, &label, WebviewUrl::App(url.into()))
        .title("Flash").inner_size(width, height).decorations(false).transparent(true).shadow(false)
        .always_on_top(true).skip_taskbar(true).focused(false).resizable(false);
    if let Ok(Some(monitor)) = handle.primary_monitor() {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let (ax, ay) = (area.position.x as f64 / scale, area.position.y as f64 / scale);
        let (aw, ah) = (area.size.width as f64 / scale, area.size.height as f64 / scale);
        let x = if corner.ends_with("right") { ax + aw - width - pad } else { ax + pad };
        let y = if corner.starts_with("bottom") { ay + ah - height - pad } else { ay + pad };
        // shortcut: Wayland ignores client positions, so KWin centres the toast; anchoring it needs gtk-layer-shell.
        builder = builder.position(x, y);
    }
    let Ok(window) = builder.build() else { return };
    window.set_ignore_cursor_events(true).ok();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(3000));
        window.eval("window.leave && window.leave()").ok();
        // Covers .toast.out (280 ms) in windowTemplates.
        std::thread::sleep(Duration::from_millis(300));
        window.close().ok();
    });
}

/// flash-clip://local/<path>: clips for <video> and <img>, with byte ranges so
/// seeking works. Nothing outside the clips folder.
fn serve(handle: &AppHandle, request: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::{header, Response, StatusCode};
    let respond = |status: StatusCode| Response::builder().status(status).body(Vec::new()).unwrap();
    let path = decode(request.uri().path());
    let file = Path::new(&path);
    let kind = match file.extension().and_then(|e| e.to_str()).map(str::to_lowercase).as_deref() {
        Some("mp4") => "video/mp4", Some("png") => "image/png", _ => return respond(StatusCode::NOT_FOUND),
    };
    if !library::is_inside(&handle.state::<App>().root(), file) { return respond(StatusCode::FORBIDDEN) }
    let Ok(mut f) = std::fs::File::open(file) else { return respond(StatusCode::NOT_FOUND) };
    let size = f.metadata().map(|m| m.len()).unwrap_or(0);
    use std::io::{Read, Seek, SeekFrom};
    let range = request.headers().get(header::RANGE).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("bytes="))
        .and_then(|v| v.split(',').next()).and_then(|v| v.split_once('-'));
    let builder = Response::builder().header(header::CONTENT_TYPE, kind).header(header::ACCEPT_RANGES, "bytes")
        .header("Access-Control-Allow-Origin", "*");
    let Some((start, end)) = range else {
        let mut body = Vec::new();
        return match f.read_to_end(&mut body) { Ok(_) => builder.body(body).unwrap(), Err(_) => respond(StatusCode::INTERNAL_SERVER_ERROR) };
    };
    // Open-ended ranges are capped so a 1 GB clip is not read into memory at once.
    let (start, end) = match (start.parse::<u64>().ok(), end.parse::<u64>().ok()) {
        (Some(s), Some(e)) => (s, e.min(size.saturating_sub(1))),
        (Some(s), None) => (s, (s + 8 * 1024 * 1024).min(size).saturating_sub(1)),
        (None, Some(n)) => (size.saturating_sub(n), size.saturating_sub(1)),
        (None, None) => return respond(StatusCode::RANGE_NOT_SATISFIABLE),
    };
    if size == 0 || start > end || start >= size {
        return Response::builder().status(StatusCode::RANGE_NOT_SATISFIABLE).header(header::CONTENT_RANGE, format!("bytes */{size}")).body(Vec::new()).unwrap();
    }
    let mut body = vec![0u8; (end - start + 1) as usize];
    if f.seek(SeekFrom::Start(start)).and_then(|_| f.read_exact(&mut body)).is_err() { return respond(StatusCode::INTERNAL_SERVER_ERROR) }
    builder.status(StatusCode::PARTIAL_CONTENT).header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}")).body(body).unwrap()
}

fn autostart_path() -> PathBuf {
    std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).filter(|p| p.is_absolute())
        .unwrap_or_else(|| PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config"))
        .join("autostart/flash.desktop")
}

fn autostart_state() -> Value {
    let enabled = std::fs::read_to_string(autostart_path())
        .is_ok_and(|t| !t.lines().any(|l| l == "Hidden=true" || l == "X-GNOME-Autostart-enabled=false"));
    json!({ "enabled": enabled, "managedByWindows": false, "supported": true })
}

fn set_autostart(enabled: bool) -> Value {
    let path = autostart_path();
    let result = if enabled {
        std::env::current_exe().map_err(|e| e.to_string()).and_then(|exe| {
            let exe = exe.to_string_lossy().replace('%', "%%").replace(['"', '`', '$', '\\'], "");
            let entry = format!("[Desktop Entry]\nType=Application\nName=Flash\nExec=\"{exe}\" --autostart\nIcon=flash\nTerminal=false\nStartupWMClass=flash\nX-GNOME-Autostart-enabled=true\n");
            std::fs::create_dir_all(path.parent().unwrap()).and_then(|_| std::fs::write(&path, entry)).map_err(|e| e.to_string())
        })
    } else {
        std::fs::remove_file(&path).or_else(|e| if e.kind() == std::io::ErrorKind::NotFound { Ok(()) } else { Err(e) }).map_err(|e| e.to_string())
    };
    let mut state = autostart_state();
    if let Err(error) = result { state["error"] = json!(error) }
    state
}

fn open(target: &Path) { Command::new("xdg-open").arg(target).spawn().ok(); }

fn show_in_folder(file: &Path) {
    let uri = format!("file://{}", encode(&file.to_string_lossy()));
    let shown = Command::new("gdbus").args(["call", "--session", "--dest", "org.freedesktop.FileManager1",
        "--object-path", "/org/freedesktop/FileManager1", "--method", "org.freedesktop.FileManager1.ShowItems",
        &format!("['{}']", uri.replace('\'', "%27")), ""]).status().is_ok_and(|s| s.success());
    if !shown { if let Some(parent) = file.parent() { open(parent) } }
}

fn copy_file(file: &Path) -> bool {
    use std::io::Write;
    let Ok(mut child) = Command::new("wl-copy").args(["--type", "text/uri-list"]).stdin(std::process::Stdio::piped()).spawn() else { return false };
    let wrote = child.stdin.take().is_some_and(|mut stdin| write!(stdin, "file://{}\r\n", encode(&file.to_string_lossy())).is_ok());
    wrote && child.wait().is_ok_and(|s| s.success())
}

fn bytes(value: &Value) -> Option<Vec<u8>> {
    value.as_array()?.iter().map(|b| b.as_u64().filter(|b| *b < 256).map(|b| b as u8)).collect()
}

fn show_main(handle: &AppHandle) {
    if let Some(window) = handle.get_webview_window("main") { window.show().ok(); window.unminimize().ok(); window.set_focus().ok(); }
}

#[tauri::command]
async fn ipc(channel: String, args: Vec<Value>, app: State<'_, App>, window: WebviewWindow, handle: AppHandle) -> Result<Value, String> {
    let arg = |i: usize| args.get(i).cloned().unwrap_or(Value::Null);
    let text = |i: usize| args.get(i).and_then(Value::as_str).unwrap_or_default().to_owned();
    let root = app.root();
    if std::env::var_os("FLASH_DEBUG_IPC").is_some() { eprintln!("flash ipc: {channel} {args:?}") }
    Ok(match channel.as_str() {
        // Window chrome (the window is frameless, like the Electron build).
        "window-minimize" => { window.minimize().map_err(|e| e.to_string())?; Value::Null }
        "window-maximize" => {
            if window.is_maximized().unwrap_or(false) { window.unmaximize() } else { window.maximize() }.map_err(|e| e.to_string())?;
            Value::Null
        }
        // Close hides to the tray; the replay buffer keeps running.
        "window-close" => { window.hide().map_err(|e| e.to_string())?; Value::Null }

        "get-settings" => Value::Object(app.settings.lock().unwrap().values.clone()),
        "set-settings" => {
            let (changed, values) = {
                let mut store = app.settings.lock().unwrap();
                let changed = store.update(&arg(0)).map_err(|e| format!("Could not save settings: {e}"))?;
                (changed, store.values.clone())
            };
            if ["bufferLength", "quality", "displayId", "captureMode"].iter().any(|k| changed.contains_key(*k)) { restart_capture(&handle) }
            if ["hotkey", "hotkeyShort"].iter().any(|k| changed.contains_key(*k)) { app.hotkey_keys.send(app.keys()).ok(); }
            Value::Object(values)
        }
        "capture-set-buffer-length" => {
            let changed = app.settings.lock().unwrap().update(&json!({ "bufferLength": arg(0) })).map_err(|e| e.to_string())?;
            if !changed.is_empty() { restart_capture(&handle) }
            Value::Null
        }

        "renderer-log" => { eprintln!("flash renderer: {}", text(0)); Value::Null }

        "playback-visibility" => json!(true),
        "get-update-state" => json!({ "status": "idle" }),
        "hotkey-status" => {
            let bound = *app.hotkey_status.lock().unwrap();
            json!({ "hotkey": app.get("hotkey"), "clip": bound[0], "short": bound[1], "screenshot": bound[2] })
        }
        "autostart-status" => autostart_state(),
        "set-autostart" => set_autostart(arg(0) == json!(true)),
        "get-learned-games" => app.get("learnedGames"),
        "forget-game" => {
            let mut learned = app.get("learnedGames").as_object().cloned().unwrap_or_default();
            learned.remove(&text(0).to_lowercase());
            app.settings.lock().unwrap().update(&json!({ "learnedGames": learned })).map_err(|e| e.to_string())?;
            app.get("learnedGames")
        }

        // Capture engine (packages/flash-capture through include/flash_engine.h).
        "has-capture-addon" => json!(true),
        "capture-status" => engine::status(),
        "list-displays" => engine::displays(),
        // The start-up "recording-state" event carries the answer once the engine is up.
        "get-recording-state" => json!(recording(&handle)),
        "capture-start-replay" => json!(start_capture(&handle).inspect_err(|e| eprintln!("flash: capture failed to start: {e}")).is_ok()),
        "capture-stop-replay" => { stop_capture(&handle); Value::Null }
        "toggle-recording" => {
            if recording(&handle) { stop_capture(&handle) }
            else if let Err(e) = start_capture(&handle) { eprintln!("flash: capture failed to start: {e}"); }
            Value::Null
        }
        "capture-save-clip" => save_clip(&handle, arg(0).as_f64().filter(|s| *s > 0.0).unwrap_or(0.0)).await,
        "get-current-game" => app.game.lock().unwrap().as_ref().map_or(Value::Null, |g| json!(g.name)),
        "list-audio-apps" => json!({ "supported": false, "apps": [] }),
        "list-mic-devices" => json!({ "devices": [] }),
        "voice-status" => json!({ "available": false, "model": "", "reason": "Voice clipping is not in the Linux build yet." }),

        // Library (library.rs).
        "get-clips" => json!(library::scan(&root)),
        "get-storage" => library::storage(&root),
        "delete-clip" => library::delete(&root, &text(0)),
        "rename-clip" => library::rename(&root, &text(0), &text(1)),
        "move-clips" => library::move_many(&root, arg(0).as_array().map_or(&[][..], |v| v), &text(1)),
        "set-clip-starred" => library::set_starred(&root, &text(0), arg(1) == json!(true)),
        "thumbnail-read" => library::thumbnail_file(&app.cache, &root, &text(0))
            .and_then(|f| std::fs::read(f).ok()).map_or(Value::Null, |b| json!(b)),
        "thumbnail-write" => {
            let written = (|| {
                let file = library::thumbnail_file(&app.cache, &root, &text(0))?;
                let data = bytes(&arg(1)).filter(|b| !b.is_empty() && b.len() <= 1024 * 1024)?;
                std::fs::create_dir_all(file.parent()?).ok()?;
                std::fs::write(file, data).ok()
            })();
            json!(written.is_some())
        }
        "save-clip-frame" => {
            let file = PathBuf::from(text(0));
            let at = arg(1).as_f64().filter(|s| s.is_finite() && *s >= 0.0);
            match (library::is_inside(&root, &file) && file.extension().is_some_and(|e| e == "mp4"), at, bytes(&arg(2)).filter(|b| !b.is_empty())) {
                (true, Some(at), Some(data)) => {
                    let ms = (at * 1000.0).round() as u64;
                    let stem = format!("{} - {:02}-{:02}-{:02}.{:03}", file.file_stem().unwrap().to_string_lossy(), ms / 3_600_000, ms / 60_000 % 60, ms / 1000 % 60, ms % 1000);
                    let out = file.with_file_name(format!("{stem}.png"));
                    if out.exists() { json!({ "error": "That frame is already saved" }) } else {
                        match std::fs::write(&out, data) {
                            Ok(()) => {
                                let game = library::read_sidecar(&file).and_then(|s| s.get("game").cloned())
                                    .unwrap_or_else(|| json!(file.parent().and_then(|p| p.file_name()).map(|n| n.to_string_lossy()).unwrap_or_default()));
                                let mut meta = serde_json::Map::new();
                                meta.insert("duration".into(), json!(0)); meta.insert("game".into(), game);
                                library::write_sidecar(&out, &meta).ok();
                                handle.emit("clip-saved-refresh", Vec::<Value>::new()).ok();
                                json!({ "path": out })
                            }
                            Err(e) => json!({ "error": e.to_string() }),
                        }
                    }
                }
                _ => json!({ "error": "Could not save that frame" }),
            }
        }
        "open-clip" => {
            let file = PathBuf::from(text(0));
            if library::is_inside(&root, &file) && file.extension().is_some_and(|e| e == "mp4" || e == "png") { open(&file) }
            Value::Null
        }
        "open-clips-folder" => { std::fs::create_dir_all(&root).ok(); open(Path::new(&root)); Value::Null }
        "show-clip-in-folder" => {
            let file = PathBuf::from(text(0));
            if library::is_inside(&root, &file) { show_in_folder(&file) }
            Value::Null
        }
        "copy-clip-file" => {
            let file = PathBuf::from(text(0));
            json!(library::is_inside(&root, &file) && file.exists() && copy_file(&file))
        }
        "pick-clips-folder" => {
            use ashpd::desktop::file_chooser::SelectedFiles;
            let picked = async {
                let request = SelectedFiles::open_file().title("Choose where Flash saves clips").directory(true).modal(true)
                    .current_folder(&root).ok()?.send().await.ok()?;
                let uri = request.response().ok()?.uris().first()?.as_str().to_owned();
                Some(decode(uri.strip_prefix("file://")?))
            }.await;
            match picked {
                Some(folder) => {
                    std::fs::create_dir_all(&folder).ok();
                    { let mut store = app.settings.lock().unwrap(); store.values.insert("clipsFolder".into(), json!(folder)); store.save().ok(); }
                    restart_capture(&handle);
                    json!(folder)
                }
                None => Value::Null,
            }
        }

        // Not ported yet: the editor's lossless trim/export and the cloud features.
        "trim-clip" | "save-clip-edit" | "export-clip" | "decode-clip-audio" | "get-clip-keyframes"
        | "share-clip-link" | "save-shared-clip" | "send-feedback" =>
            json!({ "error": "This is not in the Linux build yet." }),
        "install-update" | "start-clip-drag" => Value::Null,

        other => {
            eprintln!("flash: ipc channel not implemented yet: {other}");
            return Err(format!("{other} is not available in the Tauri build yet"));
        }
    })
}

fn main() {
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("flash-clip", |ctx, request, responder| {
            let handle = ctx.app_handle().clone();
            std::thread::spawn(move || responder.respond(serve(&handle, &request)));
        })
        .setup(|app| {
            let home = app.path().home_dir()?;
            let config = app.path().config_dir().unwrap_or_else(|_| home.join(".config"));
            let videos = app.path().video_dir().unwrap_or_else(|_| home.join("Videos"));
            let cache = app.path().app_cache_dir().unwrap_or_else(|_| home.join(".cache/flash"));
            let store = settings::Store::open(&config, &videos);
            let (keys_tx, keys_rx) = watch::channel(Default::default());
            let state = App { settings: Mutex::new(store), saving: Default::default(), game: Mutex::new(None),
                hotkey_status: Default::default(), hotkey_keys: keys_tx, cache, toasts: AtomicU64::new(0), starting: Mutex::new(()), recording: Default::default() };
            state.hotkey_keys.send_replace(state.keys());
            let status = state.hotkey_status.clone();
            app.manage(state);

            // Hotkeys through the desktop portal.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(hotkeys::run(keys_rx, status, move |id| {
                let handle = handle.clone();
                let id = id.to_owned();
                tauri::async_runtime::spawn(async move {
                    handle.emit("hotkey-clip", Vec::<Value>::new()).ok();
                    let seconds = if id == "short" { handle.state::<App>().get("shortClipSeconds").as_f64().unwrap_or(0.0) } else { 0.0 };
                    save_clip(&handle, seconds).await;
                });
            }));

            // Game detection every three seconds, like the Electron build.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut detector = detect::Detector::new();
                loop {
                    let app = handle.state::<App>();
                    let learned = app.get("learnedGames").as_object().cloned().unwrap_or_default();
                    let found = detector.detect(&learned);
                    if found != detector.current {
                        *app.game.lock().unwrap() = found.clone();
                        handle.emit("game-detected", [found.as_ref().map(|g| g.name.clone())]).ok();
                        if app.get("captureMode") == "game" { engine::set_capture_window(found.as_ref().map_or(0, |g| g.pid)) }
                        detector.current = found;
                    }
                    std::thread::sleep(Duration::from_secs(3));
                }
            });

            // Tray: Flash keeps clipping with the window closed.
            let open_item = MenuItem::with_id(app, "open", "Open Flash", true, None::<&str>)?;
            let save_item = MenuItem::with_id(app, "save", "Save clip", true, None::<&str>)?;
            let record_item = MenuItem::with_id(app, "record", "Start or stop recording", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Flash", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &save_item, &record_item, &quit_item])?;
            let mut tray = TrayIconBuilder::with_id("flash").tooltip("Flash").menu(&menu)
                .on_menu_event(|handle, event| match event.id().as_ref() {
                    "open" => show_main(handle),
                    "save" => { let handle = handle.clone(); tauri::async_runtime::spawn(async move { save_clip(&handle, 0.0).await; }); }
                    "record" => {
                        if recording(handle) { stop_capture(handle) }
                        else if let Err(e) = start_capture(handle) { eprintln!("flash: capture failed to start: {e}") }
                    }
                    "quit" => { engine::stop(); handle.exit(0) }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event { show_main(tray.app_handle()) }
                });
            if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()) }
            tray.build(app)?;

            // Start the replay buffer on launch, as the Electron build does, off the UI thread.
            let handle = app.handle().clone();
            std::thread::spawn(move || if let Err(e) = start_capture(&handle) { eprintln!("flash: capture failed to start: {e}") });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ipc])
        .build(tauri::generate_context!())
        .expect("error while building Flash")
        .run(|_, event| match event {
            tauri::RunEvent::Exit => engine::stop(),
            // Closing the last window must not quit: the tray keeps Flash running.
            tauri::RunEvent::ExitRequested { code: None, api, .. } => api.prevent_exit(),
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    #[test]
    fn url_coding_round_trips() {
        let path = "/home/u/Videos/Flash/Rocket League/Big save #1 (100%).mp4";
        assert_eq!(super::decode(&super::encode(path)), path);
        assert_eq!(super::decode("/a%20b/%E2%9A%A1"), "/a b/⚡");
    }
}
