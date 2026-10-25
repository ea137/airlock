//! Random secrets, and the hashes Airlock stores instead of them.

use sha2::{Digest, Sha256};

fn random<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).expect("the OS random source failed");
    bytes
}

/// A fresh 256-bit secret, hex-encoded: device tokens and pairing secrets.
pub fn secret() -> String {
    hex::encode(random::<32>())
}

/// A public id for a database row. Not a secret.
pub fn id() -> String {
    hex::encode(random::<8>())
}

/// The six-digit code a pairing request shows on the phone and on the laptop,
/// so you can tell which request you are approving. Not a secret.
pub fn pairing_code() -> String {
    format!("{:06}", u32::from_le_bytes(random::<4>()) % 1_000_000)
}

/// What the database keeps: the SHA-256 of a secret, never the secret.
pub fn hash(secret: &str) -> String {
    hex::encode(Sha256::digest(secret.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_are_long_and_distinct() {
        let (a, b) = (secret(), secret());
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
    }

    #[test]
    fn codes_are_six_digits() {
        for _ in 0..100 {
            let code = pairing_code();
            assert_eq!(code.len(), 6);
            assert!(code.chars().all(|c| c.is_ascii_digit()));
        }
    }

    #[test]
    fn hash_is_stable_and_not_the_secret() {
        let secret = secret();
        assert_eq!(hash(&secret), hash(&secret));
        assert_ne!(hash(&secret), secret);
    }
}
