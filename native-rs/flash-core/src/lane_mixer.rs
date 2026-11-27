use std::collections::{BTreeMap, VecDeque};

pub const RATE: i64 = 48_000;
pub const CHANNELS: usize = 2;
pub const PACKET_FRAMES: i64 = 480;
pub const HOLD_FRAMES: i64 = 3840;
pub const MAX_BUFFERED_FRAMES: i64 = 14_400;
pub const GAP_FRAMES: i64 = 960;
const MAX_AHEAD_US: i64 = 60_000_000;
const MAX_PAST_US: i64 = 300_000_000;
const MAX_TIMELINE_US: i64 = 1 << 45;
fn frames_to_us(frames: i64) -> i64 {
    frames / RATE * 1_000_000 + frames % RATE * 1_000_000 / RATE
}
#[derive(Clone, Debug, PartialEq)]
pub struct Packet {
    pub samples: Vec<f32>,
    pub start_us: i64,
}
#[derive(Default)]
struct Source {
    samples: VecDeque<f32>,
    front: i64,
}
impl Source {
    fn buffered(&self) -> i64 {
        self.samples.len() as i64 / CHANNELS as i64
    }
}
#[derive(Default)]
pub struct LaneMixer {
    sources: BTreeMap<u64, Source>,
    origin_us: i64,
    emitted: i64,
    started: bool,
}
impl LaneMixer {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn push(&mut self, source: u64, samples: &[f32], frames: u32, start_us: i64) {
        if frames == 0 || samples.len() < frames as usize * CHANNELS {
            return;
        }
        if !self.started {
            self.origin_us = start_us;
            self.started = true;
        }
        let rel_us = start_us
            .saturating_sub(self.origin_us)
            .saturating_sub(frames_to_us(self.emitted));
        if rel_us > MAX_AHEAD_US || rel_us < -MAX_PAST_US {
            return;
        }
        let mut position = self.emitted + rel_us * RATE / 1_000_000;
        let s = self.sources.entry(source).or_default();
        let buffered = s.buffered();
        let mut skip = 0usize;
        if buffered == 0 {
            if position < self.emitted {
                skip = (self.emitted - position).min(frames as i64) as usize;
                position = self.emitted;
            }
            s.front = position;
        } else {
            let gap = position - (s.front + buffered);
            if gap > MAX_BUFFERED_FRAMES {
                s.samples.clear();
                s.front = position;
            } else if gap > GAP_FRAMES {
                s.samples
                    .extend(std::iter::repeat_n(0.0, (gap as usize) * CHANNELS));
            }
        }
        s.samples.extend(
            samples[skip * CHANNELS..frames as usize * CHANNELS]
                .iter()
                .map(|&v| if v.is_finite() { v } else { 0.0 }),
        );
        let waiting = s.buffered();
        if waiting > MAX_BUFFERED_FRAMES {
            let drop = waiting - HOLD_FRAMES;
            s.samples.drain(..drop as usize * CHANNELS);
            s.front += drop;
        }
    }
    pub fn remove(&mut self, source: u64) {
        self.sources.remove(&source);
    }
    pub fn pull(&mut self, now_us: i64, out: &mut Vec<Packet>) {
        if !self.started {
            self.origin_us = now_us;
            self.started = true;
        }
        let since = now_us.saturating_sub(self.origin_us);
        if !(-MAX_TIMELINE_US..=MAX_TIMELINE_US).contains(&since) {
            return;
        }
        let ready = since * RATE / 1_000_000 - HOLD_FRAMES;
        while self.emitted + PACKET_FRAMES <= ready {
            let earliest = self
                .sources
                .values()
                .filter(|s| s.buffered() > 0)
                .map(|s| s.front)
                .min();
            if earliest.is_none() || earliest.unwrap() >= self.emitted + PACKET_FRAMES {
                let target = earliest.map_or(ready, |time| ready.min(time));
                self.emitted += (target - self.emitted) / PACKET_FRAMES * PACKET_FRAMES;
                continue;
            }
            let end = self.emitted + PACKET_FRAMES;
            let mut packet = Packet {
                samples: vec![0.0; PACKET_FRAMES as usize * CHANNELS],
                start_us: self.origin_us.saturating_add(frames_to_us(self.emitted)),
            };
            let mut audible = false;
            for s in self.sources.values_mut() {
                let buffered = s.buffered();
                if buffered == 0 || s.front >= end {
                    continue;
                }
                let to = (s.front + buffered).min(end);
                for frame in s.front..to {
                    for c in 0..CHANNELS {
                        let value = s.samples[(frame - s.front) as usize * CHANNELS + c];
                        if value != 0.0 {
                            audible = true;
                        }
                        packet.samples[(frame - self.emitted) as usize * CHANNELS + c] += value;
                    }
                }
                s.samples.drain(..(to - s.front) as usize * CHANNELS);
                s.front = to;
            }
            self.emitted = end;
            if audible {
                for sample in &mut packet.samples {
                    *sample = sample.clamp(-1.0, 1.0);
                }
                out.push(packet);
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn tone(frames: usize, value: f32) -> Vec<f32> {
        vec![value; frames * 2]
    }
    fn us(frames: i64) -> i64 {
        frames * 1_000_000 / RATE
    }
    fn near(a: f32, b: f32) -> bool {
        (a - b).abs() < 1e-6
    }
    #[test]
    fn sum_and_limit() {
        let mut m = LaneMixer::new();
        let mut out = vec![];
        m.push(1, &tone(480, 0.25), 480, 0);
        m.push(2, &tone(480, 0.5), 480, 0);
        m.pull(us(480) + us(HOLD_FRAMES), &mut out);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].start_us, 0);
        assert!(out[0].samples.iter().all(|&v| near(v, 0.75)));
        let mut m = LaneMixer::new();
        let mut out = vec![];
        m.push(1, &tone(480, 0.8), 480, 0);
        m.push(2, &tone(480, 0.8), 480, 0);
        m.pull(us(480) + us(HOLD_FRAMES), &mut out);
        assert!(out[0].samples.iter().all(|&v| near(v, 1.0)));
    }
    #[test]
    fn offset_gap_and_drain() {
        let mut m = LaneMixer::new();
        let mut out = vec![];
        m.push(1, &tone(480, 0.25), 480, 0);
        m.push(2, &tone(480, 0.5), 480, us(240));
        m.pull(us(960) + us(HOLD_FRAMES), &mut out);
        assert_eq!(out.len(), 2);
        assert!(near(out[0].samples[239 * 2], 0.25));
        assert!(near(out[0].samples[240 * 2], 0.75));
        assert_eq!(out[1].start_us, us(480));
        assert!(near(out[1].samples[240 * 2], 0.0));
        let mut m = LaneMixer::new();
        let mut out = vec![];
        m.push(1, &tone(480, 0.25), 480, 0);
        m.pull(us(960) + us(HOLD_FRAMES), &mut out);
        m.push(1, &tone(480, 0.25), 480, us(1920));
        m.pull(us(2400) + us(HOLD_FRAMES), &mut out);
        assert_eq!(out.len(), 2);
        assert_eq!(out[1].start_us, us(1920));
    }
    #[test]
    fn continuous_source_and_buffer_limit() {
        let mut m = LaneMixer::new();
        let mut out = vec![];
        m.push(1, &tone(2400, 0.1), 2400, 0);
        m.push(1, &tone(2400, 0.1), 2400, us(2400) - 3000);
        m.pull(us(4800) + us(HOLD_FRAMES), &mut out);
        assert_eq!(out.len(), 10);
        for (i, p) in out.iter().enumerate() {
            assert_eq!(p.start_us, i as i64 * 10_000);
        }
        let mut m = LaneMixer::new();
        let mut out = vec![];
        let ramp: Vec<f32> = (1..=24000).flat_map(|i| [i as f32 / 24000.0; 2]).collect();
        m.push(1, &ramp, 24000, 0);
        m.pull(us(24000) + us(HOLD_FRAMES), &mut out);
        assert_eq!(out.len(), 8);
        assert_eq!(out[0].start_us, us(20160));
        assert!(near(out[0].samples[0], 20161.0 / 24000.0));
    }
    #[test]
    fn late_remove_invalid_and_nonfinite() {
        let mut m = LaneMixer::new();
        let mut out = vec![];
        m.pull(0, &mut out);
        m.pull(us(3360) + us(HOLD_FRAMES), &mut out);
        m.push(2, &tone(480, 0.5), 480, us(3120));
        m.pull(us(3840) + us(HOLD_FRAMES), &mut out);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].start_us, us(3360));
        assert!(near(out[0].samples[240 * 2], 0.0));
        let mut m = LaneMixer::new();
        let mut out = vec![];
        m.push(1, &tone(480, 0.25), 480, 0);
        m.remove(1);
        m.pull(us(480) + us(HOLD_FRAMES), &mut out);
        assert!(out.is_empty());
        m.push(1, &[], 480, 0);
        m.push(1, &tone(480, 0.25), 0, 0);
        assert!(out.is_empty());
        let mut a = tone(480, 0.25);
        a[10] = f32::NAN;
        a[11] = f32::INFINITY;
        a[20] = f32::NEG_INFINITY;
        let mut m = LaneMixer::new();
        m.push(1, &a, 480, 0);
        m.pull(us(480) + us(HOLD_FRAMES), &mut out);
        for i in [10, 11, 20] {
            assert_eq!(out[0].samples[i], 0.0);
        }
    }
    #[test]
    fn wild_timestamps_and_huge_idle_jump() {
        let mut m = LaneMixer::new();
        let mut out = vec![];
        m.pull(0, &mut out);
        for stamp in [i64::MAX / 2, i64::MIN / 2, i64::MAX, i64::MIN] {
            m.push(1, &tone(480, 0.25), 480, stamp);
        }
        m.pull(us(480) + us(HOLD_FRAMES), &mut out);
        assert!(out.is_empty());
        m.push(1, &tone(480, 0.25), 480, us(480));
        m.pull(us(960) + us(HOLD_FRAMES), &mut out);
        assert_eq!(out.len(), 1);
        let mut m = LaneMixer::new();
        let mut out = vec![];
        m.pull(0, &mut out);
        m.pull(1000 * 3600 * 1_000_000, &mut out);
        assert!(out.is_empty());
        let later = 1000 * 3600 * 1_000_000;
        m.push(1, &tone(480, 0.25), 480, later);
        m.pull(later + 40_000 + us(HOLD_FRAMES), &mut out);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].start_us, later);
        m.pull(i64::MAX, &mut out);
        assert_eq!(out.len(), 1);
    }
    #[test]
    fn no_sources_then_start_and_ten_second_jump() {
        let mut m = LaneMixer::new();
        let mut out = vec![];
        m.pull(0, &mut out);
        m.pull(us(4800), &mut out);
        assert!(out.is_empty());
        m.push(1, &tone(480, 0.25), 480, us(4800));
        m.pull(us(5280) + us(HOLD_FRAMES), &mut out);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].start_us, us(4800));
        let mut m = LaneMixer::new();
        let mut out = vec![];
        m.pull(0, &mut out);
        m.push(1, &tone(480, 0.25), 480, us(480_000));
        m.pull(us(480_480) + us(HOLD_FRAMES), &mut out);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].start_us, us(480_000));
    }
    #[test]
    fn wild_stamps_with_audio_waiting_do_not_shift_it() {
        let a = tone(480, 0.25);
        for stamp in [i64::MAX / 2, i64::MIN / 2, i64::MAX, i64::MIN] {
            for waiting in [false, true] {
                let mut m = LaneMixer::new();
                let mut out = vec![];
                m.pull(0, &mut out);
                if waiting {
                    m.push(1, &a, 480, 0);
                }
                m.push(1, &a, 480, stamp);
                m.pull(us(4800) + us(HOLD_FRAMES), &mut out);
                assert_eq!(out.len(), usize::from(waiting));
                if waiting {
                    assert_eq!(out[0].start_us, 0);
                }
                out.clear();
                m.push(1, &a, 480, us(4800));
                m.pull(us(5280) + us(HOLD_FRAMES), &mut out);
                assert_eq!(out.len(), 1);
                assert_eq!(out[0].start_us, us(4800));
            }
        }
    }
    #[test]
    fn gap_fill_keeps_timestamped_audio_in_place() {
        let mut m = LaneMixer::new();
        m.push(1, &tone(480, 0.25), 480, 0);
        m.push(1, &tone(480, 0.5), 480, us(1920));
        let source = &m.sources[&1];
        assert_eq!(source.front, 0);
        assert_eq!(source.buffered(), 2400);
        assert!(source
            .samples
            .iter()
            .skip(480 * 2)
            .take(1440 * 2)
            .all(|&v| v == 0.0));
        let mut out = vec![];
        m.pull(us(2400) + us(HOLD_FRAMES), &mut out);
        assert_eq!(
            out.iter().map(|p| p.start_us).collect::<Vec<_>>(),
            [0, us(1920)]
        );
        assert!(out[1].samples.iter().all(|&v| near(v, 0.5)));
    }
    #[test]
    fn gap_over_max_clears_stale_audio() {
        let mut m = LaneMixer::new();
        m.push(1, &tone(480, 0.25), 480, 0);
        let later = 480 + MAX_BUFFERED_FRAMES + 480;
        m.push(1, &tone(480, 0.5), 480, us(later));
        let source = &m.sources[&1];
        assert_eq!(source.front, later);
        assert_eq!(source.buffered(), 480);
        assert!(source.samples.iter().all(|&v| near(v, 0.5)));
    }
}
