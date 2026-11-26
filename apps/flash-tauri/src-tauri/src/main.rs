// Flash on Tauri: the Electron main process, rewritten in Rust.
//
// The React UI is unchanged. Its preload (`apps/desktop/src/preload/preload.ts`)
// is bundled against a small `electron` shim, so every `ipcRenderer.invoke`
// arrives here as one `ipc` command with the Electron channel name, and every
// main-to-renderer message goes out as a Tauri event of the same name.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "linux")]
mod engine;
mod settings;

use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State, WebviewWindow};

struct App {
    settings: Mutex<settings::Store>,
    // One save at a time, like saveClipNow in the Electron build.
    saving: std::sync::Arc<Mutex<()>>,
}

/// Starts the replay buffer from the current settings and tells the UI.
fn start_capture(app: &tauri::AppHandle) -> Result<(), String> {
    let (dir, display, buffer, quality) = {
        let state = app.state::<App>();
        let store = state.settings.lock().unwrap();
        let v = &store.values;
        (v["clipsFolder"].as_str().unwrap_or_default().to_string(), v["displayId"].as_u64().unwrap_or(0) as u32,
         v["bufferLength"].as_u64().unwrap_or(30) as u32, engine::quality(v["quality"].as_str().unwrap_or("1080p 60fps")))
    };
    let result = engine::start(&dir, display, buffer, &quality);
    app.emit("recording-state", [result.is_ok()]).ok();
    result
}

#[tauri::command]
async fn ipc(channel: String, args: Vec<Value>, app: State<'_, App>, window: WebviewWindow, handle: tauri::AppHandle) -> Result<Value, String> {
    let arg = |i: usize| args.get(i).cloned().unwrap_or(Value::Null);
    Ok(match channel.as_str() {
        // Window chrome (the window is frameless, like the Electron build).
        "window-minimize" => { window.minimize().map_err(|e| e.to_string())?; Value::Null }
        "window-maximize" => {
            if window.is_maximized().unwrap_or(false) { window.unmaximize() } else { window.maximize() }.map_err(|e| e.to_string())?;
            Value::Null
        }
        // Close hides to the tray in the Electron build; until the tray exists, close.
        "window-close" => { window.close().map_err(|e| e.to_string())?; Value::Null }

        "get-settings" => Value::Object(app.settings.lock().unwrap().values.clone()),
        "set-settings" => {
            let mut store = app.settings.lock().unwrap();
            store.update(&arg(0)).map_err(|e| format!("Could not save settings: {e}"))?;
            Value::Object(store.values.clone())
        }

        "renderer-log" => { eprintln!("flash renderer: {}", arg(0).as_str().unwrap_or_default()); Value::Null }

        "playback-visibility" => json!(true),
        "get-update-state" => json!({ "status": "idle" }),
        "hotkey-status" => {
            let store = app.settings.lock().unwrap();
            json!({ "hotkey": store.values["hotkey"], "registered": false, "error": "Hotkeys are not wired up in the Tauri build yet" })
        }
        "autostart-status" => json!({ "enabled": false, "managedByWindows": false, "supported": false }),
        "get-learned-games" => app.settings.lock().unwrap().values["learnedGames"].clone(),

        // Capture engine (packages/flash-capture through include/flash_engine.h).
        "has-capture-addon" => json!(true),
        "capture-status" => engine::status(),
        "list-displays" => engine::displays(),
        "get-recording-state" => engine::status()["recording"].clone(),
        "capture-start-replay" => json!(start_capture(&handle).inspect_err(|e| eprintln!("flash: capture failed to start: {e}")).is_ok()),
        "capture-stop-replay" => { engine::stop(); handle.emit("recording-state", [false]).ok(); Value::Null }
        "toggle-recording" => {
            if engine::status()["recording"] == json!(true) { engine::stop(); handle.emit("recording-state", [false]).ok(); }
            else if let Err(e) = start_capture(&handle) { eprintln!("flash: capture failed to start: {e}"); }
            Value::Null
        }
        "capture-save-clip" => {
            let seconds = arg(0).as_f64().filter(|s| *s > 0.0).unwrap_or(0.0);
            let saving = app.saving.clone();
            handle.emit("clip-save-state", [json!({ "saving": true })]).ok();
            // shortcut: no game detection yet, so clips go under "Unknown"; pass the detected game once it is ported.
            let result = tauri::async_runtime::spawn_blocking(move || {
                let _one_at_a_time = saving.lock().unwrap();
                engine::save_clip(seconds, "Unknown")
            }).await.map_err(|e| e.to_string())?;
            match result {
                Ok(path) => {
                    handle.emit("clip-save-state", [json!({ "saving": false })]).ok();
                    handle.emit("clip-saved-refresh", Vec::<Value>::new()).ok();
                    json!({ "path": path })
                }
                Err(error) => {
                    handle.emit("clip-save-state", [json!({ "saving": false, "error": error })]).ok();
                    json!({ "error": error })
                }
            }
        }
        "get-current-game" => Value::Null,
        "list-audio-apps" | "list-mic-devices" => json!([]),
        "voice-status" => json!({ "available": false, "model": "", "reason": "Not available in the Tauri build yet." }),

        // Library: next milestone.
        "get-clips" => json!([]),
        "get-storage" => json!({ "used": 0, "clips": 0 }),

        other => {
            eprintln!("flash: ipc channel not implemented yet: {other}");
            return Err(format!("{other} is not available in the Tauri build yet"));
        }
    })
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let home = app.path().home_dir()?;
            let config = app.path().config_dir().unwrap_or_else(|_| home.join(".config"));
            let videos = app.path().video_dir().unwrap_or_else(|_| home.join("Videos"));
            app.manage(App { settings: Mutex::new(settings::Store::open(&config, &videos)), saving: Default::default() });
            // Start the replay buffer on launch, as the Electron build does, off the UI thread.
            let handle = app.handle().clone();
            std::thread::spawn(move || if let Err(e) = start_capture(&handle) { eprintln!("flash: capture failed to start: {e}") });
            // Tell the UI where it is, as the Electron build does on load.
            app.emit("navigate", ["feed"]).ok();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ipc])
        .build(tauri::generate_context!())
        .expect("error while building Flash")
        .run(|_, event| if let tauri::RunEvent::Exit = event { engine::stop() });
}
