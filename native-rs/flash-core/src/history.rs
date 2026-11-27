// History module - port of the TypeScript implementation.
// No external crates, only std, and fully ASCII.

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct History<T> {
    pub past: Vec<T>,
    pub present: T,
    pub future: Vec<T>,
}

/// Create a new history with the given present value.
pub fn create_history<T>(present: T) -> History<T> {
    History {
        past: Vec::new(),
        present,
        future: Vec::new(),
    }
}

/// Push a new present value onto the history, clearing the future.
/// Keeps only the last 100 entries in `past`.
pub fn push<T>(history: &History<T>, present: T) -> History<T>
where
    T: Clone,
{
    let mut new_past = history.past.clone();
    new_past.push(history.present.clone());

    // Keep only the most recent 100 entries.
    if new_past.len() > 100 {
        let start = new_past.len() - 100;
        new_past = new_past[start..].to_vec();
    }

    History {
        past: new_past,
        present,
        future: Vec::new(),
    }
}

/// Undo one step. If there is nothing to undo, returns the original history.
pub fn undo<T>(history: &History<T>) -> History<T>
where
    T: Clone,
{
    if history.past.is_empty() {
        return history.clone();
    }

    let mut new_past = history.past.clone();
    let new_present = new_past.pop().unwrap(); // safe because we checked length

    let mut new_future = Vec::with_capacity(history.future.len() + 1);
    new_future.push(history.present.clone());
    new_future.extend_from_slice(&history.future);

    History {
        past: new_past,
        present: new_present,
        future: new_future,
    }
}

/// Redo one step. If there is nothing to redo, returns the original history.
pub fn redo<T>(history: &History<T>) -> History<T>
where
    T: Clone,
{
    if history.future.is_empty() {
        return history.clone();
    }

    let mut new_past = history.past.clone();
    new_past.push(history.present.clone());

    let mut new_future = history.future.clone();
    let new_present = new_future.remove(0);

    History {
        past: new_past,
        present: new_present,
        future: new_future,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_and_push() {
        let h0 = create_history(1);
        let h1 = push(&h0, 2);
        assert_eq!(h1.past, vec![1]);
        assert_eq!(h1.present, 2);
        assert!(h1.future.is_empty());
    }

    #[test]
    fn test_undo_redo_cycle() {
        let h0 = create_history(0);
        let h1 = push(&h0, 1);
        let h2 = push(&h1, 2);
        // h2: past=[0,1], present=2
        let h3 = undo(&h2);
        // after undo: past=[0], present=1, future=[2]
        assert_eq!(h3.past, vec![0]);
        assert_eq!(h3.present, 1);
        assert_eq!(h3.future, vec![2]);

        let h4 = redo(&h3);
        // after redo: past=[0,1], present=2, future=[]
        assert_eq!(h4.past, vec![0, 1]);
        assert_eq!(h4.present, 2);
        assert!(h4.future.is_empty());
    }

    #[test]
    fn test_undo_without_past() {
        let h = create_history(5);
        let h2 = undo(&h);
        assert_eq!(h2, h);
    }

    #[test]
    fn test_redo_without_future() {
        let h = create_history(5);
        let h2 = redo(&h);
        assert_eq!(h2, h);
    }

    #[test]
    fn test_past_cap() {
        let mut h = create_history(0);
        // push 101 times, each time the present becomes the next integer.
        for i in 1..=101 {
            h = push(&h, i);
        }
        // After 101 pushes, we have 101 present values (0..101),
        // but only the last 100 of the *previous* presents are kept in `past`.
        // The current present is 101, so past should contain 1..100.
        assert_eq!(h.present, 101);
        assert_eq!(h.past.len(), 100);
        assert_eq!(h.past[0], 1);
        assert_eq!(h.past[99], 100);
    }
}
