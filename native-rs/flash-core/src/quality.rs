pub fn compute_even_width(source_width: u32, source_height: u32, target_height: u32) -> u32 {
    if source_width == 0 || source_height == 0 || target_height == 0 {
        return 0;
    }
    let scaled = source_width as f64 * target_height as f64 / source_height as f64;
    // C++ lround rounds halfway away from zero. Inputs here are nonnegative.
    let width = scaled.round() as u32;
    width.saturating_add(1) & !1
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn source_aspect_and_even_rounding() {
        assert_eq!(compute_even_width(1920, 1080, 1080), 1920);
        assert_eq!(compute_even_width(2560, 1440, 1080), 1920);
        assert_eq!(compute_even_width(3440, 1440, 1080) % 2, 0);
        assert_eq!(compute_even_width(1, 2, 1), 2);
    }
    #[test]
    fn half_and_even_rounding_boundaries() {
        assert_eq!(compute_even_width(5, 2, 1), 4); // 2.5 rounds to 3, then even 4
        assert_eq!(compute_even_width(3, 2, 1), 2); // 1.5 rounds to 2
        assert_eq!(compute_even_width(249, 100, 1), 2); // below half
        assert_eq!(compute_even_width(3, 1, 1), 4); // odd integer rounds up to even
        assert_eq!(compute_even_width(4, 1, 1), 4);
    }
    #[test]
    fn zero_dimensions() {
        for dims in [(0, 1080, 1080), (1, 0, 1), (1, 1, 0)] {
            assert_eq!(compute_even_width(dims.0, dims.1, dims.2), 0);
        }
    }
}
