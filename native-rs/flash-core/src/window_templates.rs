//! Pure window placement from shared/windowTemplates.ts.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Position a window inside a display work area using the same string checks
/// and 16-pixel padding as the TypeScript helper.
pub fn corner_bounds(area: Bounds, position: &str, width: f64, height: f64) -> Bounds {
    let pad = 16.0;
    Bounds {
        width,
        height,
        x: if position.ends_with("right") { area.x + area.width - width - pad } else { area.x + pad },
        y: if position.starts_with("bottom") { area.y + area.height - height - pad } else { area.y + pad },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corners() {
        let area = Bounds { x: 100.0, y: 200.0, width: 800.0, height: 600.0 };
        assert_eq!(corner_bounds(area, "top-left", 240.0, 40.0), Bounds { x: 116.0, y: 216.0, width: 240.0, height: 40.0 });
        assert_eq!(corner_bounds(area, "top-right", 240.0, 40.0), Bounds { x: 644.0, y: 216.0, width: 240.0, height: 40.0 });
        assert_eq!(corner_bounds(area, "bottom-left", 240.0, 40.0), Bounds { x: 116.0, y: 744.0, width: 240.0, height: 40.0 });
        assert_eq!(corner_bounds(area, "bottom-right", 240.0, 40.0), Bounds { x: 644.0, y: 744.0, width: 240.0, height: 40.0 });
    }

    #[test]
    fn string_and_numeric_edges() {
        let area = Bounds { x: -10.0, y: -20.0, width: 0.0, height: 0.0 };
        assert_eq!(corner_bounds(area, "upright", -2.0, 3.0), Bounds { x: -24.0, y: -4.0, width: -2.0, height: 3.0 });
        assert_eq!(corner_bounds(area, "bottomless", -2.0, 3.0), Bounds { x: 6.0, y: -39.0, width: -2.0, height: 3.0 });
    }
}
