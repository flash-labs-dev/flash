//! Sequences batch clip sharing (port of shared/shareSelection.ts).
//! The caller supplies the upload; `Err(())` stands in for a thrown error.

const BUSY: &str = "A link is already being made";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShareResult {
    Ok { url: String, days: u32 },
    Err { error: String },
}

impl ShareResult {
    fn is_busy(&self) -> bool {
        matches!(self, ShareResult::Err { error } if error == BUSY)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ShareSelectionResult {
    pub completed: usize,
    pub total: usize,
    pub failed: usize,
    pub urls: Vec<String>,
    pub stopped_by: Option<String>,
}

pub fn is_share_capacity_error(error: &str) -> bool {
    error == "Too many links this hour. Try again later."
        || error == "The share server is full right now."
}

/// Retries while another link is being made. `wait` does the pause.
pub fn share_when_available(
    path: &str,
    mut share: impl FnMut(&str) -> Result<ShareResult, ()>,
    mut wait: impl FnMut(),
    mut should_stop: impl FnMut() -> bool,
) -> Result<ShareResult, ()> {
    loop {
        let result = share(path)?;
        if !result.is_busy() {
            return Ok(result);
        }
        wait();
        // Stop pressed while queued: never start a public upload afterwards.
        if should_stop() {
            return Ok(result);
        }
    }
}

/// `on_progress` sees the running totals after each attempted clip.
pub fn share_selection(
    paths: &[&str],
    mut share: impl FnMut(&str) -> Result<ShareResult, ()>,
    mut on_progress: impl FnMut(&ShareSelectionResult),
    mut should_stop: impl FnMut() -> bool,
) -> ShareSelectionResult {
    let mut result = ShareSelectionResult {
        total: paths.len(),
        ..Default::default()
    };
    for path in paths {
        if should_stop() {
            break;
        }
        match share(path) {
            Ok(response) => {
                // A clip still queued when Stop was pressed was never attempted.
                if response.is_busy() && should_stop() {
                    break;
                }
                match response {
                    ShareResult::Ok { url, .. } => result.urls.push(url),
                    ShareResult::Err { error } => {
                        result.failed += 1;
                        if is_share_capacity_error(&error) {
                            result.stopped_by = Some(error);
                        }
                    }
                }
            }
            Err(()) => result.failed += 1,
        }
        result.completed += 1;
        on_progress(&result);
        if result.stopped_by.is_some() {
            break;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    const FULL: &str = "The share server is full right now.";

    fn ok(url: &str) -> Result<ShareResult, ()> {
        Ok(ShareResult::Ok { url: url.into(), days: 7 })
    }

    fn err(error: &str) -> Result<ShareResult, ()> {
        Ok(ShareResult::Err { error: error.into() })
    }

    #[test]
    fn retries_while_busy() {
        let (mut calls, mut waits) = (0, 0);
        let result = share_when_available(
            "a",
            |_| {
                calls += 1;
                if calls < 3 { err(BUSY) } else { ok("u") }
            },
            || waits += 1,
            || false,
        );
        assert_eq!(result, ok("u"));
        assert_eq!(waits, 2);
    }

    #[test]
    fn stop_while_queued_does_not_upload_again() {
        let mut calls = 0;
        let result = share_when_available(
            "a",
            |_| {
                calls += 1;
                err(BUSY)
            },
            || {},
            || true,
        );
        assert_eq!(result, err(BUSY));
        assert_eq!(calls, 1);
        assert_eq!(share_when_available("a", |_| Err(()), || {}, || false), Err(()));
    }

    #[test]
    fn counts_failures_and_stops_at_capacity() {
        let mut seen = Vec::new();
        let result = share_selection(
            &["ok", "throws", "full", "never"],
            |path| match path {
                "ok" => ok("u1"),
                "throws" => Err(()),
                "full" => err(FULL),
                _ => panic!("shared after capacity error"),
            },
            |p| seen.push((p.completed, p.failed)),
            || false,
        );
        assert_eq!((result.completed, result.total, result.failed), (3, 4, 2));
        assert_eq!(result.urls, ["u1"]);
        assert_eq!(result.stopped_by.as_deref(), Some(FULL));
        assert_eq!(seen, [(1, 0), (2, 1), (3, 2)]);
    }

    #[test]
    fn queued_clip_is_not_counted_after_stop() {
        let stop = Cell::new(false);
        let result = share_selection(
            &["a", "b"],
            |_| {
                stop.set(true);
                err(BUSY)
            },
            |_| panic!("nothing was attempted"),
            || stop.get(),
        );
        assert_eq!((result.completed, result.failed), (0, 0));
    }
}
