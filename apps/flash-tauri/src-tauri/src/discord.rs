//! Discord Rich Presence over Discord's local IPC socket: "Clipping <game>"
//! with an elapsed timer and a Download button, shown only while a game runs
//! and the setting is on. No SDK: the protocol is length-prefixed JSON frames.
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// The Discord application whose name and art the presence shows.
/// shortcut: set at build time (FLASH_DISCORD_CLIENT_ID) until the project has one.
pub const CLIENT_ID: Option<&str> = option_env!("FLASH_DISCORD_CLIENT_ID");

fn frame(op: u32, payload: &Value) -> Vec<u8> {
    let body = payload.to_string().into_bytes();
    let mut out = Vec::with_capacity(8 + body.len());
    out.extend_from_slice(&op.to_le_bytes());
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(&body);
    out
}

fn read_frame(stream: &mut UnixStream) -> std::io::Result<Value> {
    let mut head = [0u8; 8];
    stream.read_exact(&mut head)?;
    let len = u32::from_le_bytes(head[4..8].try_into().unwrap()) as usize;
    if len > 64 * 1024 { return Err(std::io::Error::other("oversized frame")) }
    let mut body = vec![0u8; len];
    stream.read_exact(&mut body)?;
    Ok(serde_json::from_slice(&body).unwrap_or(Value::Null))
}

/// Discord, its Flatpak and Snap builds, and clients like Vesktop all listen here.
fn sockets() -> Vec<PathBuf> {
    let base = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/tmp"));
    let dirs = [base.clone(), base.join("app/com.discordapp.Discord"), base.join("app/dev.vencord.Vesktop"), base.join("snap.discord")];
    dirs.iter().flat_map(|d| (0..10).map(move |i| d.join(format!("discord-ipc-{i}")))).filter(|p| p.exists()).collect()
}

pub struct Presence { stream: Option<UnixStream>, shown: Option<String>, started: u64, nonce: u64 }

impl Presence {
    pub fn new() -> Presence { Presence { stream: None, shown: None, started: 0, nonce: 0 } }

    fn connect(&mut self, client_id: &str) -> Option<&mut UnixStream> {
        if self.stream.is_none() {
            for path in sockets() {
                let Ok(mut stream) = UnixStream::connect(&path) else { continue };
                stream.set_read_timeout(Some(Duration::from_secs(3))).ok();
                if stream.write_all(&frame(0, &json!({ "v": 1, "client_id": client_id }))).is_err() { continue }
                // READY on success; an error payload (bad client id) means give up on this socket.
                match read_frame(&mut stream) {
                    Ok(ready) if ready["evt"] == "READY" => { self.stream = Some(stream); break }
                    Ok(other) => eprintln!("flash: Discord refused the presence: {}", other["message"].as_str().or(other["data"]["message"].as_str()).unwrap_or("unknown error")),
                    Err(_) => {}
                }
            }
        }
        self.stream.as_mut()
    }

    /// Shows `game` (or clears with None). Cheap to call every few seconds: it
    /// only talks to Discord when what should be shown changes.
    pub fn update(&mut self, game: Option<&str>) {
        let Some(client_id) = CLIENT_ID else { return };
        if self.shown.as_deref() == game { return }
        if game.is_some() && self.shown.is_none() {
            self.started = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
        }
        let activity = game.map(|game| json!({
            "details": format!("Clipping {game}"),
            "state": "with Flash",
            "timestamps": { "start": self.started },
            "assets": { "large_image": "flash", "large_text": "Flash" },
            "buttons": [{ "label": "Download Flash", "url": "https://github.com/flash-labs-dev/flash/releases" }],
        }));
        self.nonce += 1;
        let payload = json!({ "cmd": "SET_ACTIVITY", "args": { "pid": std::process::id(), "activity": activity }, "nonce": self.nonce.to_string() });
        let sent = self.connect(client_id).is_some_and(|s| s.write_all(&frame(1, &payload)).is_ok() && read_frame(s).is_ok());
        if sent { self.shown = game.map(str::to_owned) } else { self.stream = None }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn frames_are_little_endian_length_prefixed() {
        let f = super::frame(1, &serde_json::json!({ "a": 1 }));
        assert_eq!(&f[..4], &1u32.to_le_bytes());
        assert_eq!(u32::from_le_bytes(f[4..8].try_into().unwrap()) as usize, f.len() - 8);
    }
}
