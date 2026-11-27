# Flash on Rust + Tauri

Goal: the same app with far less memory and disk. A small Rust process does
the clipping, and the window is a Tauri webview that can be closed without
stopping capture.

## Layout

| Path | What |
|------|------|
| `apps/flash-tauri/src-tauri` | Rust app: replaces Electron's `main.ts`. One `ipc` command dispatches by the Electron channel name. |
| `apps/flash-tauri/src/electron-shim.ts` | Just enough of `ipcRenderer`/`contextBridge` for the unchanged `apps/desktop/src/preload/preload.ts`. |
| `apps/flash-tauri/vite.config.ts` | Builds the unchanged `apps/desktop` renderer for the webview. |
| `Cargo.toml` | Workspace root. |

The UI is not forked: both builds use `apps/desktop/src/renderer`.

## Run

```bash
pnpm install
pnpm --filter @flash/tauri vite build
cargo build --release -p flash
./target/release/flash
```

`pnpm --filter @flash/tauri dev` runs it against the Vite dev server.

## Status

Done (milestone 1):
- Tauri shell running the real UI, with frameless window controls.
- Settings: same keys, defaults and validation as `shared/sanitise.ts`, read and
  written to the same `settings.json` as the Electron build (8 Rust tests).
- Uncaught renderer errors are logged by the Rust process (`renderer-log`).

Next:
1. Capture engine: expose the existing C++ core (`packages/flash-capture`)
   through a small C API and call it from Rust. Engine logic moves out of the
   N-API `binding.cpp` into a shared `Engine` class used by both builds.
2. Library (clip listing, thumbnails, rename/delete/move), hotkeys, tray,
   game detection, notifications. **Done** (Linux): `library.rs`, `detect.rs`,
   `hotkeys.rs` (xdg GlobalShortcuts portal), tray, toast window and clip
   sound in `main.rs`. Not ported yet: the editor (trim/export/audio lanes),
   screenshots, voice clipping, share links, feedback, updates.
3. Split the engine into its own background process so the UI process can
   exit while clipping continues.
4. Port capture pieces to Rust where it pays off.

## Measured (CachyOS, KDE Wayland, RTX 4070 SUPER, idle, no capture)

| | Electron 44 (beta.7 CI build) | Tauri (milestone 1) |
|---|---|---|
| Processes | 9 | 3 |
| Memory (PSS) | 544 MB | 335 MB |
| Memory (RSS sum) | 1219 MB | 770 MB |
| Download | 127 MB AppImage | 4.6 MB binary (uses system WebKitGTK) |

Most of the remaining memory is WebKitGTK's web process on the NVIDIA GL
driver. Closing the window while the engine keeps recording (step 3) is where
the background footprint drops to the engine alone.

## Linux runtime requirements

- `gst-plugins-good`: WebKitGTK needs it to demux MP4 and output audio. Without
  it the web process hangs as soon as a clip thumbnail or the player loads.
- A desktop entry named `com.flash.clipper.desktop` (template in `src-tauri/`):
  KDE only shows the global-shortcut dialog for an app id it can resolve.
- On Wayland the toast cannot place itself in a corner (KWin centres it);
  anchoring it needs gtk-layer-shell.
