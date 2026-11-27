#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EncodedPacket {
    pub data: Vec<u8>,
    pub pts_us: i64,
    pub is_keyframe: bool,
    pub dts_us: i64,
    pub duration_us: i64,
}

// The caller owns synchronization, like other core logic. A Mutex can wrap this
// at the daemon boundary; flush retains packet history as in the C++ buffer.
pub struct RingBuffer {
    packets: Vec<EncodedPacket>,
    write_pos: usize,
    count: usize,
    max_duration_seconds: u32,
    fps: u32,
}
impl RingBuffer {
    pub fn new(seconds: u32, fps: u32) -> Self {
        let capacity = seconds as usize * fps as usize;
        Self {
            packets: vec![EncodedPacket::default(); capacity],
            write_pos: 0,
            count: 0,
            max_duration_seconds: seconds,
            fps,
        }
    }
    pub fn push(&mut self, packet: EncodedPacket) {
        if self.packets.is_empty() {
            return;
        }
        self.packets[self.write_pos] = packet;
        self.write_pos = (self.write_pos + 1) % self.packets.len();
        self.count = (self.count + 1).min(self.packets.len());
    }
    fn chronological(&self) -> Vec<EncodedPacket> {
        if self.count == 0 {
            return vec![];
        }
        let oldest = if self.count < self.packets.len() {
            0
        } else {
            self.write_pos
        };
        (0..self.count)
            .map(|i| self.packets[(oldest + i) % self.packets.len()].clone())
            .collect()
    }
    pub fn flush(&self, window_seconds: f64) -> Vec<EncodedPacket> {
        let mut result = self.chronological();
        if result.is_empty() {
            return result;
        }
        let duration = if window_seconds > 0.0 {
            window_seconds.min(self.max_duration_seconds as f64)
        } else {
            self.max_duration_seconds as f64
        };
        let cutoff = result
            .last()
            .unwrap()
            .pts_us
            .saturating_sub((duration * 1_000_000.0) as i64);
        let start = result
            .iter()
            .position(|p| p.pts_us >= cutoff)
            .unwrap_or(result.len());
        // Keep malformed timelines from indexing past the packet array.
        if start == result.len() {
            return vec![];
        }
        let key = (0..=start)
            .rev()
            .find(|&i| result[i].is_keyframe)
            .or_else(|| (start..result.len()).find(|&i| result[i].is_keyframe));
        let Some(key) = key else {
            return vec![];
        };
        result.drain(..key);
        result
    }
    pub fn duration_seconds(&self) -> f32 {
        if self.count < 2 {
            return 0.0;
        }
        let oldest = if self.count < self.packets.len() {
            0
        } else {
            self.write_pos
        };
        let newest = (self.write_pos + self.packets.len() - 1) % self.packets.len();
        self.packets[newest]
            .pts_us
            .saturating_sub(self.packets[oldest].pts_us)
            .max(0) as f32
            / 1_000_000.0
    }
    pub fn packet_count(&self) -> usize {
        self.count
    }
    pub fn clear(&mut self) {
        self.count = 0;
        self.write_pos = 0;
    }
    pub fn set_max_duration(&mut self, seconds: u32, fps: u32) {
        let capacity = seconds as usize * fps as usize;
        if seconds == self.max_duration_seconds && fps == self.fps && capacity == self.packets.len()
        {
            return;
        }
        let mut history = self.chronological();
        if history.len() > capacity {
            history.drain(..history.len() - capacity);
        }
        let count = history.len();
        history.resize(capacity, EncodedPacket::default());
        self.packets = history;
        self.count = count;
        self.write_pos = if capacity > 0 { count % capacity } else { 0 };
        self.max_duration_seconds = seconds;
        self.fps = fps;
    }
}
impl Default for RingBuffer {
    fn default() -> Self {
        Self::new(30, 60)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn packet(i: usize) -> EncodedPacket {
        let pts_us = i as i64 * (1_000_000 / 60);
        EncodedPacket {
            data: vec![i as u8; 16],
            pts_us,
            is_keyframe: i % 120 == 0,
            dts_us: pts_us,
            duration_us: 1_000_000 / 60,
        }
    }
    #[test]
    fn flush_keeps_history_and_metadata() {
        let mut b = RingBuffer::new(5, 60);
        for i in 0..300 {
            b.push(packet(i));
        }
        let first = b.flush(0.0);
        assert!(!first.is_empty());
        assert!(first[0].is_keyframe);
        assert_eq!(first[0].dts_us, first[0].pts_us);
        assert_eq!(first, b.flush(0.0));
        assert_eq!(b.packet_count(), 300);
    }
    #[test]
    fn wrap_static_timestamps_and_window_keyframe() {
        let mut b = RingBuffer::new(5, 60);
        for i in 0..900 {
            b.push(packet(i));
        }
        let clip = b.flush(0.0);
        assert!(clip[0].is_keyframe);
        assert!(clip.windows(2).all(|w| w[0].pts_us < w[1].pts_us));
        let mut b = RingBuffer::new(5, 60);
        for i in 0..40 {
            b.push(EncodedPacket {
                pts_us: i * 1_000_000,
                is_keyframe: true,
                ..Default::default()
            });
        }
        let clip = b.flush(0.0);
        assert!(clip.len() > 1);
        assert!(clip.last().unwrap().pts_us - clip[0].pts_us <= 5_000_000);
        let mut b = RingBuffer::new(10, 60);
        for i in 0..600 {
            b.push(packet(i));
        }
        let clip = b.flush(4.0);
        let span = clip.last().unwrap().pts_us - clip[0].pts_us;
        assert!(clip[0].is_keyframe && span > 5_900_000 && span < 6_100_000);
    }
    #[test]
    fn duration_resize_clear_and_empty() {
        let mut b = RingBuffer::new(10, 60);
        assert!(b.flush(0.0).is_empty());
        for i in 0..6 {
            b.push(EncodedPacket {
                pts_us: i * 200_000,
                is_keyframe: true,
                ..Default::default()
            });
        }
        assert!((b.duration_seconds() - 1.0).abs() < 0.01);
        b.set_max_duration(10, 60);
        assert_eq!(b.packet_count(), 6);
        b.set_max_duration(1, 2);
        assert_eq!(b.packet_count(), 2);
        assert_eq!(b.flush(0.0).last().unwrap().pts_us, 1_000_000);
        b.clear();
        assert_eq!(b.duration_seconds(), 0.0);
    }
    #[test]
    fn zero_capacity_and_missing_keyframe() {
        let mut b = RingBuffer::new(0, 60);
        b.push(packet(0));
        assert_eq!(b.packet_count(), 0);
        b.set_max_duration(1, 2);
        b.push(EncodedPacket::default());
        assert!(b.flush(0.0).is_empty());
    }
    #[test]
    fn growth_preserves_wrapped_history_and_accepts_new_packets() {
        let mut b = RingBuffer::new(1, 3);
        for i in 0..5 {
            b.push(EncodedPacket {
                pts_us: i * 100_000,
                is_keyframe: true,
                ..Default::default()
            });
        }
        b.set_max_duration(2, 3);
        assert_eq!(b.packet_count(), 3);
        assert_eq!(
            b.flush(0.0).iter().map(|p| p.pts_us).collect::<Vec<_>>(),
            [200_000, 300_000, 400_000]
        );
        for i in 5..9 {
            b.push(EncodedPacket {
                pts_us: i * 100_000,
                is_keyframe: true,
                ..Default::default()
            });
        }
        assert_eq!(b.packet_count(), 6);
        assert_eq!(
            b.flush(0.0).iter().map(|p| p.pts_us).collect::<Vec<_>>(),
            [300_000, 400_000, 500_000, 600_000, 700_000, 800_000]
        );
    }
}
