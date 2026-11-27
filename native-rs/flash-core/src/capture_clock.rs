use std::sync::OnceLock;
use std::time::Instant;

static EPOCH: OnceLock<Instant> = OnceLock::new();

pub fn capture_clock_us() -> i64 {
    EPOCH
        .get_or_init(Instant::now)
        .elapsed()
        .as_micros()
        .min(i64::MAX as u128) as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn monotonic_microseconds() {
        let first = capture_clock_us();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let second = capture_clock_us();
        assert!(first >= 0 && second > first);
    }
}
