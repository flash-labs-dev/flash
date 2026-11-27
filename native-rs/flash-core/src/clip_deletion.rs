//! Deleting a clip another program may still have open (port of
//! shared/clipDeletion.ts). This version blocks, so it has no per-path queue:
//! the caller must not delete one path from two threads at once.

use std::io;

/// Retries after the first attempt.
const RETRIES: u32 = 10;

#[derive(Debug, PartialEq, Eq)]
pub enum DeleteResult {
    Deleted,
    /// `allowed` said no, for example because the clip was starred.
    Refused,
    Failed(String),
}

/// A sharing violation (Windows 32) or EBUSY/EPERM in the TypeScript.
fn is_busy(error: &io::Error) -> bool {
    matches!(error.kind(), io::ErrorKind::PermissionDenied | io::ErrorKind::ResourceBusy)
        || (cfg!(windows) && error.raw_os_error() == Some(32))
}

/// `wait` is called between attempts; the caller chooses the delay (the app
/// uses 200 ms). A `cleanup` failure is retried like an `unlink` failure.
pub fn delete_clip(
    mut allowed: impl FnMut() -> bool,
    mut unlink: impl FnMut() -> io::Result<()>,
    mut cleanup: impl FnMut() -> io::Result<()>,
    mut wait: impl FnMut(),
) -> DeleteResult {
    let mut attempt = 0;
    loop {
        // Checked right before every unlink, so a star added during a retry wins.
        if !allowed() {
            return DeleteResult::Refused;
        }
        let Err(error) = unlink().and_then(|()| cleanup()) else {
            return DeleteResult::Deleted;
        };
        if !is_busy(&error) {
            let message = error.to_string();
            return DeleteResult::Failed(if message.is_empty() {
                "Could not delete the clip".into()
            } else {
                message
            });
        }
        if attempt == RETRIES {
            return DeleteResult::Failed("Close anything using this file, then try again".into());
        }
        attempt += 1;
        wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use io::{Error, ErrorKind};

    fn busy() -> io::Result<()> {
        Err(Error::from(ErrorKind::PermissionDenied))
    }

    #[test]
    fn retries_while_busy_then_succeeds() {
        let (mut tries, mut waits) = (0, 0);
        let result = delete_clip(
            || true,
            || {
                tries += 1;
                if tries < 3 { busy() } else { Ok(()) }
            },
            || Ok(()),
            || waits += 1,
        );
        assert_eq!((result, tries, waits), (DeleteResult::Deleted, 3, 2));
    }

    #[test]
    fn gives_up_after_eleven_attempts() {
        let mut tries = 0;
        let result = delete_clip(|| true, || { tries += 1; busy() }, || Ok(()), || {});
        assert_eq!(tries, 11);
        assert_eq!(result, DeleteResult::Failed("Close anything using this file, then try again".into()));
    }

    #[test]
    fn protection_added_during_a_retry_wins() {
        let (mut checks, mut tries) = (0, 0);
        let result = delete_clip(
            || { checks += 1; checks == 1 },
            || { tries += 1; busy() },
            || Ok(()),
            || {},
        );
        assert_eq!((result, tries), (DeleteResult::Refused, 1));
    }

    #[test]
    fn other_errors_stop_at_once() {
        let mut cleaned = false;
        let result = delete_clip(
            || true,
            || Err(Error::new(ErrorKind::NotFound, "gone")),
            || { cleaned = true; Ok(()) },
            || panic!("no retry"),
        );
        assert_eq!(result, DeleteResult::Failed("gone".into()));
        assert!(!cleaned);
        let quiet = delete_clip(|| true, || Err(Error::other("")), || Ok(()), || {});
        assert_eq!(quiet, DeleteResult::Failed("Could not delete the clip".into()));
    }
}
