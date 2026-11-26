//! Safe wrapper over packages/flash-capture/include/flash_engine.h.
use serde_json::Value;
use std::ffi::{c_char, CStr, CString};

#[repr(C)]
struct Config {
    clips_dir: *const c_char,
    display: u32,
    buffer_seconds: u32,
    height: u32,
    fps: u32,
    bitrate_kbps: u32,
}

extern "C" {
    fn flash_engine_start(config: *const Config, error: *mut c_char, error_len: usize) -> i32;
    fn flash_engine_stop();
    fn flash_engine_save_clip(seconds: f64, game: *const c_char, path: *mut c_char, path_len: usize, error: *mut c_char, error_len: usize) -> i32;
    fn flash_engine_status(json: *mut c_char, len: usize) -> usize;
    fn flash_engine_displays(json: *mut c_char, len: usize) -> usize;
}

fn text(buffer: &[u8]) -> String {
    CStr::from_bytes_until_nul(buffer).map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Calls a C function that fills `buf` with JSON and returns the size it needs.
fn json(fill: unsafe extern "C" fn(*mut c_char, usize) -> usize) -> Value {
    let mut buffer = vec![0u8; 4096];
    let needed = unsafe { fill(buffer.as_mut_ptr().cast(), buffer.len()) };
    if needed > buffer.len() {
        buffer.resize(needed, 0);
        unsafe { fill(buffer.as_mut_ptr().cast(), buffer.len()) };
    }
    serde_json::from_str(&text(&buffer)).unwrap_or(Value::Null)
}

pub struct Quality { pub height: u32, pub fps: u32, pub bitrate_kbps: u32 }

/// Port of `parseQuality` in apps/desktop/src/main/main.ts ("1080p 60fps" style names).
pub fn quality(name: &str) -> Quality {
    let (mut height, mut fps) = (1080u32, 60u32);
    let parts: Vec<&str> = name.trim().split_whitespace().collect();
    if let [res, rate] = parts[..] {
        let res_num = res.trim_end_matches(['p', 'K', 'k']);
        if let (Ok(h), Some(f)) = (res_num.parse::<u32>(), rate.strip_suffix("fps").and_then(|f| f.parse::<u32>().ok())) {
            if res.ends_with('p') || res.ends_with(['K', 'k']) { height = if h == 4 { 2160 } else { h }; fps = f; }
        }
    }
    let effective_fps = if fps > 60 { 60.0 * (fps as f64 / 60.0).powf(0.45) } else { fps as f64 };
    let pixels = height as f64 * (height as f64 * 16.0 / 9.0);
    let bits_per_pixel = 0.08 * (pixels / (1080.0 * 1920.0)).powf(-0.1);
    Quality { height, fps, bitrate_kbps: (pixels * effective_fps * bits_per_pixel / 1000.0).round() as u32 }
}

pub fn start(clips_dir: &str, display: u32, buffer_seconds: u32, quality: &Quality) -> Result<(), String> {
    let dir = CString::new(clips_dir).map_err(|_| "clips folder contains a NUL byte".to_string())?;
    let config = Config { clips_dir: dir.as_ptr(), display, buffer_seconds, height: quality.height, fps: quality.fps, bitrate_kbps: quality.bitrate_kbps };
    let mut error = [0u8; 512];
    match unsafe { flash_engine_start(&config, error.as_mut_ptr().cast(), error.len()) } {
        0 => Ok(()),
        _ => Err(text(&error)),
    }
}

pub fn stop() { unsafe { flash_engine_stop() } }

/// Blocks until the clip is written; call off the UI thread.
pub fn save_clip(seconds: f64, game: &str) -> Result<String, String> {
    let game = CString::new(game).unwrap_or_default();
    let (mut path, mut error) = ([0u8; 4096], [0u8; 512]);
    match unsafe { flash_engine_save_clip(seconds, game.as_ptr(), path.as_mut_ptr().cast(), path.len(), error.as_mut_ptr().cast(), error.len()) } {
        0 => Ok(text(&path)),
        _ => Err(text(&error)),
    }
}

pub fn status() -> Value { json(flash_engine_status) }
pub fn displays() -> Value { json(flash_engine_displays) }

#[cfg(test)]
mod tests {
    use super::quality;
    #[test]
    fn parses_quality_names() {
        let q = quality("1440p 120fps"); assert_eq!((q.height, q.fps), (1440, 120));
        let q = quality("4K 30fps"); assert_eq!((q.height, q.fps), (2160, 30));
        let q = quality("nonsense"); assert_eq!((q.height, q.fps), (1080, 60));
        // Same numbers as main.ts's parseQuality: 1080p60 = 1920x1080 x 60 x 0.08 bpp.
        assert_eq!(quality("1080p 60fps").bitrate_kbps, 9953);
    }
}
