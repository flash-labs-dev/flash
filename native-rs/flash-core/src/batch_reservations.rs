use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq)]
struct Reservation {
    token: String,
    paths: Vec<String>,
}

#[derive(Debug, Default)]
pub struct BatchReservations {
    active: HashMap<u64, Reservation>,
}

impl BatchReservations {
    pub fn new() -> Self {
        Self {
            active: HashMap::new(),
        }
    }

    pub fn replace(
        &mut self,
        sender: u64,
        token: impl Into<String>,
        paths: Vec<String>,
    ) -> Vec<String> {
        let previous = self.release(sender, None);
        self.active.insert(
            sender,
            Reservation {
                token: token.into(),
                paths,
            },
        );
        previous
    }

    pub fn release(&mut self, sender: u64, token: Option<&str>) -> Vec<String> {
        let matches = match self.active.get(&sender) {
            Some(current) => token.map_or(true, |t| current.token.as_str() == t),
            None => false,
        };

        if !matches {
            return Vec::new();
        }

        self.active.remove(&sender).map_or_else(Vec::new, |r| r.paths)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_batch_cannot_release_new_reservation() {
        let mut reservations = BatchReservations::new();

        assert_eq!(
            reservations.replace(1, "A", vec!["first.mp4".to_string()]),
            Vec::<String>::new()
        );
        assert_eq!(
            reservations.replace(1, "B", vec!["second.mp4".to_string()]),
            vec!["first.mp4".to_string()]
        );
        assert_eq!(reservations.release(1, Some("A")), Vec::<String>::new());
        assert_eq!(
            reservations.release(1, Some("B")),
            vec!["second.mp4".to_string()]
        );
        assert_eq!(reservations.release(1, Some("B")), Vec::<String>::new());
    }

    #[test]
    fn release_without_token_clears_reservation() {
        let mut reservations = BatchReservations::new();

        assert_eq!(
            reservations.replace(2, "X", vec!["a".to_string(), "b".to_string()]),
            Vec::<String>::new()
        );
        assert_eq!(
            reservations.release(2, None),
            vec!["a".to_string(), "b".to_string()]
        );
        assert_eq!(reservations.release(2, None), Vec::<String>::new());
    }
}
