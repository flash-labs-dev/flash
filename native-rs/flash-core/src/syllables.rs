//! Approximate syllable count from shared/syllables.ts.

/// Count runs of ASCII vowels, including y. The TypeScript regex is not
/// Unicode aware, so accented vowels do not contribute to the count.
pub fn count_syllables(phrase: &str) -> usize {
    let mut count = 0;
    let mut in_vowel_run = false;
    for byte in phrase.bytes() {
        let is_vowel = matches!(byte.to_ascii_lowercase(), b'a' | b'e' | b'i' | b'o' | b'u' | b'y');
        if is_vowel && !in_vowel_run {
            count += 1;
        }
        in_vowel_run = is_vowel;
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn original_cases() {
        assert_eq!(count_syllables(""), 0);
        assert_eq!(count_syllables("flash"), 1);
        assert_eq!(count_syllables("flash clip"), 2);
        assert_eq!(count_syllables("flash clip that"), 3);
        assert_eq!(count_syllables("QUEUE AUDIO"), 3);
        assert_eq!(count_syllables("my clip"), 2);
    }

    #[test]
    fn ascii_regex_edge_cases() {
        assert_eq!(count_syllables("123!!!"), 0);
        assert_eq!(count_syllables("aeiouyAEIOUY"), 1);
        assert_eq!(count_syllables("a-b"), 1);
        assert_eq!(count_syllables("éï😀a"), 1);
        assert_eq!(count_syllables("Éclair"), 1);
    }
}
