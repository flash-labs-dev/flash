// Flash on Tauri: the Electron main process, rewritten in Rust.
//
// The React UI is unchanged. Its preload (`apps/desktop/src/preload/preload.ts`)
// is bundled against a small `electron` shim, so every `ipcRenderer.invoke`
// arrives here as one `ipc` command with the Electron channel name, and every
// main-to-renderer message goes out as a Tauri event of the same name.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod settings;

use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State, WebviewWindow};

struct App {
    settings: Mutex<settings::Store>,
}

#[tauri::command]
fn ipc(channel: String, args: Vec<Value>, app: State<'_, App>, window: WebviewWindow) -> Result<Value, String> {
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

        // Capture engine: not connected yet (next milestone), so report "off".
        "has-capture-addon" | "get-recording-state" => json!(false),
        "get-current-game" => Value::Null,
        "capture-status" => json!({ "recording": false, "captureHealthy": false, "captureBackend": "none",
            "captureError": "Capture engine not connected in the Tauri build yet" }),
        "list-displays" | "list-audio-apps" | "list-mic-devices" => json!([]),
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
            app.manage(App { settings: Mutex::new(settings::Store::open(&config, &videos)) });
            // Tell the UI where it is, as the Electron build does on load.
            app.emit("navigate", ["feed"]).ok();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ipc])
        .run(tauri::generate_context!())
        .expect("error while running Flash");
}
