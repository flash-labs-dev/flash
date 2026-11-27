//! Platform decisions (port of shared/platform.ts). `clipPathFromUrl` is not
//! ported: it needs URL parsing, which std does not have.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureCommand {
    Clip,
    Short,
    Screenshot,
}

pub fn capture_command(argv: &[&str]) -> Option<CaptureCommand> {
    [
        ("--save-clip", CaptureCommand::Clip),
        ("--save-short", CaptureCommand::Short),
        ("--screenshot", CaptureCommand::Screenshot),
    ]
    .into_iter()
    .find_map(|(flag, command)| argv.contains(&flag).then_some(command))
}

pub fn linux_config_home(home: &str, xdg: Option<&str>) -> String {
    match xdg {
        Some(dir) if dir.starts_with('/') => dir.strip_suffix('/').unwrap_or(dir).to_string(),
        _ => format!("{home}/.config"),
    }
}

/// `None` for a path that cannot be written safely into a desktop file.
pub fn autostart_desktop_entry(executable: &str) -> Option<String> {
    if !executable.starts_with('/') || executable.contains(['\r', '\n', '\0']) {
        return None;
    }
    // Exec quoting is followed by desktop-file string unescaping.
    let mut quoted = String::new();
    for c in executable.chars() {
        match c {
            '%' => quoted.push_str("%%"),
            '\\' => quoted.push_str(r"\\\\"),
            '"' | '`' | '$' => {
                quoted.push_str(r"\\");
                quoted.push(c);
            }
            _ => quoted.push(c),
        }
    }
    Some(format!(
        "[Desktop Entry]\nType=Application\nName=Flash\nExec=\"{quoted}\" --autostart\nIcon=flash\nTerminal=false\nStartupWMClass=flash\nX-GNOME-Autostart-enabled=true\n"
    ))
}

fn is_wine(name: &str) -> bool {
    matches!(name, "wine" | "wine64" | "wine-preloader" | "wine64-preloader")
}

pub fn is_linux_infrastructure(exe: &str) -> bool {
    let lower = exe.to_ascii_lowercase();
    // Wine prefix helpers and the python3 that runs the Proton script inherit SteamAppId.
    let helper = matches!(
        lower.strip_suffix(".exe"),
        Some("wineboot" | "winedevice" | "services" | "plugplay" | "svchost" | "rpcss" | "explorer" | "tabtip" | "conhost")
    );
    let python = lower.strip_prefix("python3").is_some_and(|rest| {
        rest.is_empty()
            || rest.strip_prefix('.').is_some_and(|v| !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit()))
    });
    if helper || python {
        return true;
    }
    let name = lower.strip_suffix(".exe").unwrap_or(&lower);
    is_wine(name)
        || matches!(name, "wineserver" | "proton" | "steam" | "steamwebhelper" | "reaper" | "srt-bwrap")
        || name.starts_with("pressure-vessel")
}

/// `cmdline` is NUL separated. Anything but a Wine loader is returned as is.
pub fn linux_game_executable<'a>(exe: &'a str, cmdline: &'a str) -> &'a str {
    if !is_wine(&exe.to_ascii_lowercase()) {
        return exe;
    }
    cmdline
        .split('\0')
        .map(|argument| argument.rsplit(['/', '\\']).next().unwrap_or(argument))
        .find(|name| name.to_ascii_lowercase().ends_with(".exe") && !is_linux_infrastructure(name))
        .unwrap_or(exe)
}

/// Splits off a leading app id (digits, not starting with zero).
fn app_id(text: &str) -> Option<(&str, &str)> {
    let end = text.find(|c: char| !c.is_ascii_digit()).unwrap_or(text.len());
    (end > 0 && !text.starts_with('0')).then(|| text.split_at(end))
}

/// Empty when neither source names an app.
pub fn steam_app_id(environment: &str, cmdline: &str) -> String {
    let from_environment = environment.split('\0').find_map(|entry| {
        let value = entry
            .strip_prefix("SteamAppId=")
            .or_else(|| entry.strip_prefix("STEAM_COMPAT_APP_ID="))?;
        app_id(value).and_then(|(id, rest)| rest.is_empty().then_some(id))
    });
    let from_cmdline = || {
        let parts: Vec<&str> = cmdline.split(['/', '\\']).collect();
        // The first part has no separator before it, so it cannot match.
        parts.get(1..)?.windows(2).find_map(|pair| {
            if pair[0] != "compatdata" {
                return None;
            }
            app_id(pair[1])
                .and_then(|(id, rest)| (rest.is_empty() || rest.starts_with(char::is_whitespace)).then_some(id))
        })
    };
    from_environment.or_else(from_cmdline).unwrap_or("").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_and_config_home() {
        assert_eq!(capture_command(&["flash", "--save-short"]), Some(CaptureCommand::Short));
        assert_eq!(capture_command(&["--screenshot", "--save-clip"]), Some(CaptureCommand::Clip));
        assert_eq!(capture_command(&["flash", "--autostart"]), None);
        assert_eq!(linux_config_home("/home/me", Some("/tmp/config/")), "/tmp/config");
        assert_eq!(linux_config_home("/home/me", Some("/")), "");
        assert_eq!(linux_config_home("/home/me", Some("relative")), "/home/me/.config");
        assert_eq!(linux_config_home("/home/me", None), "/home/me/.config");
    }

    #[test]
    fn autostart_escaping() {
        let entry = |path| autostart_desktop_entry(path).unwrap();
        assert!(entry("/opt/Flash App/Flash").contains("Exec=\"/opt/Flash App/Flash\" --autostart\n"));
        assert!(entry("/opt/100%/Flash").contains("100%%"));
        // Same output as the TypeScript: one backslash becomes four, $ gains two.
        assert!(entry(r"/a\b").contains(r#"Exec="/a\\\\b""#));
        assert!(entry("/a$b").contains(r#"Exec="/a\\$b""#));
        assert_eq!(autostart_desktop_entry("/tmp/Flash\nHidden=true"), None);
        assert_eq!(autostart_desktop_entry("relative/Flash"), None);
    }

    #[test]
    fn wine_and_infrastructure() {
        for exe in ["Wine64", "wineserver", "proton", "steam", "steamwebhelper.exe", "pressure-vessel-wrap"] {
            assert!(is_linux_infrastructure(exe), "{exe}");
        }
        assert!(!is_linux_infrastructure("game.exe"));
        for exe in ["explorer.exe", "WineBoot.exe", "svchost.exe", "python3", "python3.12"] {
            assert!(is_linux_infrastructure(exe), "{exe}");
        }
        for exe in ["explorer", "python", "python3.", "python3.x", "python3.12.exe"] {
            assert!(!is_linux_infrastructure(exe), "{exe}");
        }
        assert_eq!(linux_game_executable("wine", "wine\0/game/explorer.exe\0"), "wine");
        assert_eq!(linux_game_executable("wine64-preloader", "wine64\0Z:\\games\\Game.exe\0"), "Game.exe");
        assert_eq!(linux_game_executable("wine64", "wine64\0C:\\steamwebhelper.exe\0"), "wine64");
        assert_eq!(linux_game_executable("game", "wine\0Other.exe\0"), "game");
    }

    #[test]
    fn steam_ids() {
        assert_eq!(steam_app_id("USER=a\0SteamAppId=1234\0", ""), "1234");
        assert_eq!(steam_app_id("STEAM_COMPAT_APP_ID=5678\0", ""), "5678");
        assert_eq!(steam_app_id("SteamAppId=0\0", ""), "");
        assert_eq!(steam_app_id("SteamAppId=12x\0", ""), "");
        assert_eq!(steam_app_id("", "/steam/steamapps/compatdata/42/pfx/game.exe"), "42");
        assert_eq!(steam_app_id("", "x /compatdata/compatdata/7 --go"), "7");
        assert_eq!(steam_app_id("", "compatdata/42/pfx"), "");
        assert_eq!(steam_app_id("", "/compatdata/42x/pfx"), "");
    }
}
