//! Per-game capture settings (port of shared/perGame.ts).

use std::collections::HashMap;

/// Per-game or merged settings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GameSetting {
    pub quality: Option<String>,
    pub buffer_length: Option<u32>,
}

/// Global (fallback) settings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GlobalSettings {
    pub quality: String,
    pub buffer_length: u32,
}

/// Per-game or merged settings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedSettings {
    pub quality: String,
    pub buffer_length: u32,
}

/// Effective settings for a game: each per-game override wins over the global.
/// An empty game name means no game, as in the TypeScript.
pub fn resolve_game_settings(
    per_game: &HashMap<String, GameSetting>,
    game: Option<&str>,
    globals: &GlobalSettings,
) -> ResolvedSettings {
    let maybe_override = game.filter(|g| !g.is_empty()).and_then(|g| per_game.get(g));

    // Per-game value when present, else the global.
    let quality = maybe_override
        .and_then(|s| s.quality.clone())
        .unwrap_or_else(|| globals.quality.clone());

    let buffer_length = maybe_override
        .and_then(|s| s.buffer_length)
        .unwrap_or(globals.buffer_length);

    ResolvedSettings {
        quality,
        buffer_length,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_globals() -> GlobalSettings {
        GlobalSettings {
            quality: "high".to_string(),
            buffer_length: 30,
        }
    }

    fn make_map(pairs: &[(&str, GameSetting)]) -> HashMap<String, GameSetting> {
        let mut map = HashMap::new();
        for (k, v) in pairs {
            map.insert((*k).to_string(), v.clone());
        }
        map
    }

    #[test]
    fn uses_globals_when_no_game_given() {
        let per = make_map(&[]);
        let globals = sample_globals();
        let out = resolve_game_settings(&per, None, &globals);
        assert_eq!(out, ResolvedSettings {
            quality: "high".to_string(),
            buffer_length: 30,
        });
    }

    #[test]
    fn falls_back_to_globals_when_game_not_in_map() {
        let per = make_map(&[]);
        let globals = sample_globals();
        let out = resolve_game_settings(&per, Some("unknown"), &globals);
        assert_eq!(out, ResolvedSettings {
            quality: "high".to_string(),
            buffer_length: 30,
        });
    }

    #[test]
    fn overrides_quality_only() {
        let per = make_map(&[(
            "game1",
            GameSetting {
                quality: Some("low".to_string()),
                buffer_length: None,
            },
        )]);
        let globals = sample_globals();
        let out = resolve_game_settings(&per, Some("game1"), &globals);
        assert_eq!(out, ResolvedSettings {
            quality: "low".to_string(),
            buffer_length: 30,
        });
    }

    #[test]
    fn overrides_both_fields() {
        let per = make_map(&[(
            "game2",
            GameSetting {
                quality: Some("ultra".to_string()),
                buffer_length: Some(45),
            },
        )]);
        let globals = sample_globals();
        let out = resolve_game_settings(&per, Some("game2"), &globals);
        assert_eq!(out, ResolvedSettings {
            quality: "ultra".to_string(),
            buffer_length: 45,
        });
    }

    #[test]
    fn empty_game_name_uses_globals() {
        let per = make_map(&[(
            "",
            GameSetting {
                quality: Some("low".to_string()),
                buffer_length: None,
            },
        )]);
        let out = resolve_game_settings(&per, Some(""), &sample_globals());
        assert_eq!(out.quality, "high");
    }
}
