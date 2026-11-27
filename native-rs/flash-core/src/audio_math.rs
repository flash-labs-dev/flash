pub fn resample_stereo(
    input: &[f32],
    frames: u32,
    channels: u32,
    input_rate: u32,
    output_rate: u32,
) -> Vec<f32> {
    if frames == 0
        || channels == 0
        || input_rate == 0
        || output_rate == 0
        || input.len() < frames as usize * channels as usize
    {
        return vec![];
    }
    let out_frames = ((frames as u64 * output_rate as u64 + (input_rate / 2) as u64)
        / input_rate as u64)
        .min(u32::MAX as u64) as u32;
    let mut output = Vec::with_capacity(out_frames as usize * 2);
    for i in 0..out_frames {
        let position = i as f64 * input_rate as f64 / output_rate as f64;
        let a = (position as u32).min(frames - 1);
        let b = a.saturating_add(1).min(frames - 1);
        let t = (position - a as f64) as f32;
        for c in 0..2 {
            let source_channel = if channels == 1 {
                0
            } else {
                c.min(channels - 1)
            };
            let av = input[a as usize * channels as usize + source_channel as usize];
            let bv = input[b as usize * channels as usize + source_channel as usize];
            output.push(av + (bv - av) * t);
        }
    }
    output
}

pub fn audio_packet_start_us(
    device_position_frames: i64,
    first_device_position: i64,
    first_clock_us: i64,
    sample_rate: u32,
) -> Option<i64> {
    if sample_rate == 0 {
        return None;
    }
    let value = first_clock_us as i128
        + (device_position_frames as i128 - first_device_position as i128) * 1_000_000
            / sample_rate as i128;
    i64::try_from(value).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mono_stereo_and_linear_interpolation() {
        assert_eq!(
            resample_stereo(&[0.0, 1.0], 2, 1, 2, 4),
            [0.0, 0.0, 0.5, 0.5, 1.0, 1.0, 1.0, 1.0]
        );
        assert_eq!(
            resample_stereo(&[0.25, -0.5], 1, 2, 48000, 48000),
            [0.25, -0.5]
        );
        assert_eq!(
            resample_stereo(&[1.0, 2.0, 3.0], 1, 3, 48000, 48000),
            [1.0, 2.0]
        );
    }
    #[test]
    fn empty_and_clock_math() {
        assert!(resample_stereo(&[], 1, 2, 48000, 48000).is_empty());
        assert!(resample_stereo(&[1.0], 1, 1, 0, 48000).is_empty());
        assert_eq!(audio_packet_start_us(480, 0, 10, 48000), Some(10010));
        assert_eq!(audio_packet_start_us(0, 480, 10, 48000), Some(-9990));
        assert_eq!(audio_packet_start_us(0, 0, 0, 0), None);
    }
    #[test]
    fn downsampling_selects_the_correct_source_frames() {
        assert_eq!(
            resample_stereo(&[0.0, 10.0, 1.0, 11.0, 2.0, 12.0, 3.0, 13.0], 4, 2, 4, 2),
            [0.0, 10.0, 2.0, 12.0]
        );
    }
    #[test]
    fn forty_four_one_khz_resampling_and_clock() {
        let input: Vec<f32> = (0..441).map(|i| i as f32 / 441.0).collect();
        let output = resample_stereo(&input, 441, 1, 44_100, 48_000);
        assert_eq!(output.len(), 480 * 2);
        for frame in [0, 1, 100, 400] {
            let expected = frame as f32 / 480.0;
            assert!((output[frame * 2] - expected).abs() < 1e-6);
            assert_eq!(output[frame * 2], output[frame * 2 + 1]);
        }
        assert!((output[479 * 2] - 440.0 / 441.0).abs() < 1e-6);
        assert_eq!(audio_packet_start_us(441, 0, 123, 44_100), Some(10_123));
    }
}
