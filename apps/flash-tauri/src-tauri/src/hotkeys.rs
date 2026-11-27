//! Global hotkeys through the xdg GlobalShortcuts portal (KDE, GNOME 48+,
//! Hyprland). X11 key grabs only fire while an XWayland window has focus, so
//! on Wayland the portal is the one way a key works inside any game.
use ashpd::desktop::global_shortcuts::{BindShortcutsOptions, GlobalShortcuts, NewShortcut};
use ashpd::desktop::CreateSessionOptions;
use futures_util::StreamExt;
use std::sync::{Arc, Mutex};
use tokio::sync::watch;

pub const IDS: [&str; 3] = ["clip", "short", "screenshot"];
const LABELS: [&str; 3] = ["Save clip", "Save short clip", "Take screenshot"];

/// Electron accelerator ("Shift+F8", "CommandOrControl+K") to the portal's
/// trigger syntax ("SHIFT+F8", "CTRL+k").
pub fn trigger(accelerator: &str) -> String {
    let mut parts: Vec<String> = Vec::new();
    for part in accelerator.split('+').map(str::trim).filter(|p| !p.is_empty()) {
        parts.push(match part.to_lowercase().as_str() {
            "ctrl" | "control" | "commandorcontrol" | "cmdorctrl" => "CTRL".into(),
            "alt" | "option" => "ALT".into(),
            "shift" => "SHIFT".into(),
            "super" | "meta" | "cmd" | "command" => "LOGO".into(),
            "space" => "space".into(),
            key if key.chars().count() == 1 => key.into(),
            _ => part.into(),
        });
    }
    parts.join("+")
}

/// Binds the three Flash shortcuts and re-binds whenever `keys` changes.
/// `status` mirrors which ones the portal accepted; `fire` gets the id.
pub async fn run(mut keys: watch::Receiver<[String; 3]>, status: Arc<Mutex<[bool; 3]>>, fire: impl Fn(&str)) {
    // An unsandboxed app has no app id unless it registers one.
    if let Ok(id) = "com.flash.clipper".try_into() { ashpd::register_host_app(id).await.ok(); }
    loop {
        let wanted = keys.borrow_and_update().clone();
        match bind(&wanted).await {
            Ok((proxy, session, bound)) => {
                *status.lock().unwrap() = bound;
                let (Ok(mut activated), Ok(mut changed_keys)) = (proxy.receive_activated().await, proxy.receive_shortcuts_changed().await) else { break };
                loop {
                    tokio::select! {
                        Some(event) = activated.next() => fire(event.shortcut_id()),
                        // The user assigned or cleared keys in System Settings.
                        Some(event) = changed_keys.next() => *status.lock().unwrap() = assigned(event.shortcuts()),
                        changed = keys.changed() => { session.close().await.ok(); if changed.is_err() { return } break }
                    }
                }
            }
            Err(error) => {
                eprintln!("flash: global shortcuts unavailable: {error}");
                *status.lock().unwrap() = [false; 3];
                if keys.changed().await.is_err() { return }
            }
        }
    }
}

async fn bind(keys: &[String; 3]) -> ashpd::Result<(GlobalShortcuts, ashpd::desktop::Session<GlobalShortcuts>, [bool; 3])> {
    let proxy = GlobalShortcuts::new().await?;
    let session = proxy.create_session(CreateSessionOptions::default()).await?;
    // A key that repeats an earlier Flash action is left out, like the Electron build.
    let shortcuts: Vec<NewShortcut> = (0..3)
        .filter(|&i| !keys[i].is_empty() && !keys[..i].contains(&keys[i]))
        .map(|i| NewShortcut::new(IDS[i], LABELS[i]).preferred_trigger(Some(trigger(&keys[i]).as_str())))
        .collect();
    let response = proxy.bind_shortcuts(&session, &shortcuts, None, BindShortcutsOptions::default()).await?.response()?;
    Ok((proxy, session, assigned(response.shortcuts())))
}

/// A shortcut counts only once it has a key: KDE registers one with no key when
/// the preferred key is taken, and the UI must say so.
fn assigned(shortcuts: &[ashpd::desktop::global_shortcuts::Shortcut]) -> [bool; 3] {
    let mut bound = [false; 3];
    for shortcut in shortcuts.iter().filter(|s| !s.trigger_description().is_empty()) {
        if let Some(i) = IDS.iter().position(|id| *id == shortcut.id()) { bound[i] = true }
    }
    bound
}

#[cfg(test)]
mod tests {
    #[test]
    fn accelerators_become_portal_triggers() {
        assert_eq!(super::trigger("F9"), "F9");
        assert_eq!(super::trigger("Shift+F8"), "SHIFT+F8");
        assert_eq!(super::trigger("CommandOrControl+Alt+K"), "CTRL+ALT+k");
    }
}
