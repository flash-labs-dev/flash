#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ExportCodec {
    #[default]
    H264,
    Hevc,
    Av1,
}
impl ExportCodec {
    pub fn name(self) -> &'static str {
        match self {
            Self::H264 => "h264",
            Self::Hevc => "hevc",
            Self::Av1 => "av1",
        }
    }
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "h264" => Some(Self::H264),
            "hevc" => Some(Self::Hevc),
            "av1" => Some(Self::Av1),
            _ => None,
        }
    }
    pub fn min_bits_per_pixel(self) -> f64 {
        match self {
            Self::H264 => 0.05,
            Self::Hevc => 0.033,
            Self::Av1 => 0.03,
        }
    }
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ExportPlan {
    pub width: u32,
    pub height: u32,
    pub video_kbps: u32,
    pub audio_kbps: u32,
    pub fps: u32,
    pub codec: ExportCodec,
    pub max_video_kbps: u32,
}
pub const EXPORT_AUDIO_KBPS: u32 = 128;
pub const EXPORT_MIN_VIDEO_KBPS: u32 = 300;
pub const EXPORT_MAX_VIDEO_KBPS: u32 = 200_000;
pub const EXPORT_FILL: f64 = 0.94;
pub const EXPORT_FLOOR: f64 = 0.88;
pub const EXPORT_UNLIMITED_BYTES: u64 = 1 << 40;
const LADDER: [u32; 6] = [2160, 1440, 1080, 720, 480, 360];
pub fn bits_per_pixel_per_frame(width: u32, height: u32, fps: u32, kbps: u32) -> f64 {
    let pixels = width as f64 * height as f64 * fps.max(1) as f64;
    if pixels > 0.0 {
        kbps as f64 * 1000.0 / pixels
    } else {
        0.0
    }
}
fn even_width(source_width: u32, source_height: u32, height: u32) -> u32 {
    let rounded =
        (source_width as u64 * height as u64 + source_height as u64 / 2) / source_height as u64;
    (rounded as u32) & !1
}
pub fn plan_export(
    source_width: u32,
    source_height: u32,
    fps: u32,
    duration_seconds: f64,
    max_bytes: u64,
    max_height: u32,
    codec: ExportCodec,
    max_fps: u32,
    source_kbps: u32,
) -> ExportPlan {
    let mut plan = ExportPlan {
        audio_kbps: EXPORT_AUDIO_KBPS,
        codec,
        ..Default::default()
    };
    if source_width == 0
        || source_height == 0
        || !duration_seconds.is_finite()
        || duration_seconds <= 0.0
        || max_bytes == 0
    {
        return plan;
    }
    let total_kbits = max_bytes as f64 * 8.0 * EXPORT_FILL / 1000.0;
    let shortest = duration_seconds.max(1.0 / if fps == 0 { 30.0 } else { fps as f64 });
    let mut video_kbps = total_kbits / shortest - plan.audio_kbps as f64;
    if video_kbps < EXPORT_MIN_VIDEO_KBPS as f64 {
        return plan;
    }
    video_kbps = video_kbps.min(EXPORT_MAX_VIDEO_KBPS as f64);
    if source_kbps >= EXPORT_MIN_VIDEO_KBPS {
        plan.max_video_kbps = source_kbps.min(EXPORT_MAX_VIDEO_KBPS);
        video_kbps = video_kbps.min(plan.max_video_kbps as f64);
    }
    let ceiling = if max_height == 0 {
        source_height
    } else {
        max_height.min(source_height)
    };
    let source_fps = if fps == 0 { 30 } else { fps };
    let first = if max_fps == 0 {
        source_fps
    } else {
        source_fps.min(max_fps)
    };
    let rates = [first, first.min(30)];
    plan.fps = first;
    let mut height = 0;
    for rate in rates {
        height = 0;
        for candidate in LADDER {
            if candidate > ceiling {
                continue;
            }
            let width = even_width(source_width, source_height, candidate);
            if bits_per_pixel_per_frame(width, candidate, rate, video_kbps as u32)
                >= codec.min_bits_per_pixel()
            {
                height = candidate;
                plan.width = width.max(2);
                plan.fps = rate;
                break;
            }
        }
        if height >= 720 || rate == rates[1] {
            break;
        }
    }
    if height == 0 {
        height = ceiling.min(360);
        plan.width = even_width(source_width, source_height, height).max(2);
    }
    plan.height = (height & !1).max(2);
    plan.video_kbps = video_kbps as u32;
    plan
}
pub fn export_needs_retry(plan: &ExportPlan, budget: u64, actual: u64) -> bool {
    if actual > budget {
        return true;
    }
    if budget >= EXPORT_UNLIMITED_BYTES {
        return false;
    }
    let ceiling = if plan.max_video_kbps > 0 {
        plan.max_video_kbps
    } else {
        EXPORT_MAX_VIDEO_KBPS
    };
    (actual as f64) < budget as f64 * EXPORT_FLOOR && plan.video_kbps < ceiling
}
pub fn retry_export_plan(previous: &ExportPlan, budget: u64, actual: u64) -> ExportPlan {
    if actual == 0 || budget == 0 {
        return ExportPlan::default();
    }
    let mut plan = *previous;
    let bitrate = previous.video_kbps as f64 * (budget as f64 * EXPORT_FILL / actual as f64);
    if bitrate < EXPORT_MIN_VIDEO_KBPS as f64 {
        for height in LADDER {
            if height >= previous.height {
                continue;
            }
            plan.height = height;
            if previous.height > 0 {
                plan.width =
                    ((previous.width as u64 * height as u64 / previous.height as u64) as u32 & !1)
                        .max(2);
            }
            break;
        }
    }
    let ceiling = if previous.max_video_kbps > 0 {
        previous.max_video_kbps
    } else {
        EXPORT_MAX_VIDEO_KBPS
    };
    plan.video_kbps = bitrate
        .min(ceiling as f64)
        .max(EXPORT_MIN_VIDEO_KBPS as f64) as u32;
    plan
}
#[derive(Clone, Copy, Debug)]
pub struct FrameGrid {
    pub fps: u32,
    pub next: i64,
}
impl FrameGrid {
    pub fn new(fps: u32) -> Self {
        Self { fps, next: 0 }
    }
    pub fn take(&mut self, time_us: i64) -> i64 {
        if time_us < 0 || self.fps == 0 {
            return -1;
        }
        let slot = ((time_us as i128 * self.fps as i128 + 500_000) / 1_000_000)
            .min(i64::MAX as i128) as i64;
        if slot < self.next {
            return -1;
        }
        self.next = slot.saturating_add(1);
        slot
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn plan(bytes: u64) -> ExportPlan {
        plan_export(1920, 1080, 60, 30.0, bytes, 0, ExportCodec::H264, 0, 0)
    }
    #[test]
    fn ten_megabyte_plan_is_pinned() {
        let p = plan(10 * 1024 * 1024);
        assert_eq!(
            (p.width, p.height, p.fps, p.video_kbps, p.audio_kbps),
            (1280, 720, 30, 2500, 128)
        );
    }
    #[test]
    fn zero_width_rungs_fall_back_after_both_rates() {
        let p = plan_export(
            1,
            1_000_000,
            60,
            1.0,
            10 * 1024 * 1024,
            2160,
            ExportCodec::H264,
            0,
            0,
        );
        assert_eq!((p.width, p.height, p.fps), (2, 360, 60));
    }
    #[test]
    fn budget_resolution_and_aspect() {
        let small = plan(10 * 1024 * 1024);
        assert!(small.height >= 360 && small.height <= 1080 && small.fps == 30);
        assert!(
            bits_per_pixel_per_frame(small.width, small.height, small.fps, small.video_kbps)
                >= 0.05
        );
        assert_eq!(
            (
                plan(500 * 1024 * 1024).width,
                plan(500 * 1024 * 1024).height
            ),
            (1920, 1080)
        );
        let capped = plan_export(
            1920,
            1080,
            60,
            10.0,
            500 * 1024 * 1024,
            720,
            ExportCodec::H264,
            0,
            0,
        );
        assert_eq!((capped.width, capped.height), (1280, 720));
        let wide = plan_export(
            2560,
            1080,
            60,
            30.0,
            50 * 1024 * 1024,
            0,
            ExportCodec::H264,
            0,
            0,
        );
        assert!((wide.width as f64 / wide.height as f64 - 2560.0 / 1080.0).abs() < 0.05);
    }
    #[test]
    fn invalid_minimum_and_unlimited() {
        assert_eq!(
            plan_export(0, 0, 0, 0.0, 0, 0, ExportCodec::H264, 0, 0).width,
            0
        );
        assert_eq!(
            plan_export(
                1920,
                1080,
                60,
                600.0,
                5 * 1024 * 1024,
                0,
                ExportCodec::H264,
                0,
                0
            )
            .width,
            0
        );
        let floor = (428_000.0 * 10.0 / 8.0 / EXPORT_FILL).ceil() as u64;
        assert_eq!(
            plan_export(1920, 1080, 60, 10.0, floor - 1, 0, ExportCodec::H264, 0, 0).width,
            0
        );
        assert!(
            plan_export(1920, 1080, 60, 10.0, floor, 0, ExportCodec::H264, 0, 0).video_kbps >= 300
        );
        assert_eq!(
            plan_export(
                1920,
                1080,
                60,
                4.0,
                9_007_199_254_740_991,
                0,
                ExportCodec::H264,
                0,
                0
            )
            .video_kbps,
            EXPORT_MAX_VIDEO_KBPS
        );
    }
    #[test]
    fn retry_and_codec_ceiling() {
        let previous = ExportPlan {
            width: 1920,
            height: 1080,
            video_kbps: 2000,
            audio_kbps: 128,
            fps: 60,
            ..Default::default()
        };
        assert_eq!(retry_export_plan(&previous, 1000, 2000).video_kbps, 940);
        let starved = retry_export_plan(&previous, 100, 2000);
        assert_eq!(
            (starved.width, starved.height, starved.video_kbps),
            (1280, 720, 300)
        );
        assert_eq!(retry_export_plan(&previous, 100, 0).width, 0);
        assert_eq!(retry_export_plan(&previous, 10000, 7000).video_kbps, 2685);
        let capped = ExportPlan {
            max_video_kbps: 2500,
            ..previous
        };
        assert_eq!(retry_export_plan(&capped, 10000, 7000).video_kbps, 2500);
        assert!(export_needs_retry(&previous, 1000, 1001));
        assert!(!export_needs_retry(&previous, 1000, 880));
        assert!(export_needs_retry(&previous, 1000, 879));
        assert!(!export_needs_retry(&capped, EXPORT_UNLIMITED_BYTES, 1));
        assert_eq!(ExportCodec::parse("vp9"), None);
        assert_eq!(ExportCodec::parse("av1").unwrap().name(), "av1");
    }
    #[test]
    fn codec_rate_and_source_caps() {
        let limit = 10 * 1024 * 1024;
        let args = |codec| plan_export(1920, 1080, 141, 14.3, limit, 0, codec, 60, 27000);
        assert_eq!(
            (
                args(ExportCodec::Av1).height,
                args(ExportCodec::Hevc).height,
                args(ExportCodec::H264).height
            ),
            (1080, 1080, 720)
        );
        assert_eq!(
            plan_export(1920, 1080, 60, 4.0, limit, 0, ExportCodec::H264, 60, 8000).video_kbps,
            8000
        );
        assert_eq!(
            plan_export(
                1920,
                1080,
                24,
                14.3,
                500 * 1024 * 1024,
                0,
                ExportCodec::H264,
                60,
                0
            )
            .fps,
            24
        );
    }
    #[test]
    fn frame_grid_irregular_duplicate_and_hitch() {
        let mut grid = FrameGrid::new(60);
        for i in 0..120 {
            assert_eq!(grid.take(i * 1_000_000 / 60), i);
        }
        let mut grid = FrameGrid::new(60);
        assert_eq!(grid.take(0), 0);
        assert_eq!(grid.take(0), -1);
        assert_eq!(grid.take(100_000), 6);
        assert_eq!(grid.take(90_000), -1);
        assert_eq!(grid.take(-5), -1);
        let mut grid = FrameGrid::new(60);
        let mut taken = 0;
        let mut last = -1;
        for i in 0..141 {
            let slot = grid.take(i * 1_000_000 / 141);
            if slot >= 0 {
                assert!(slot > last);
                last = slot;
                taken += 1;
            }
        }
        assert!((59..=61).contains(&taken));
    }
}
