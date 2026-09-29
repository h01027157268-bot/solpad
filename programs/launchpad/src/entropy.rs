//! Lottery entropy sources.
//!
//! The selection logic (`draw_index` + `winner_of`) is identical for every
//! source - only the 32 bytes it is seeded with change. Two sources ship:
//!
//! * [`EntropySource::SlotHashes`] - the round is bound to a slot that had not
//!   happened yet while tickets were being sold, and the draw reads that slot's
//!   hash out of the SlotHashes sysvar. No oracle, no liveness assumption, and
//!   nobody can influence the hash without being the leader for that slot.
//!
//! * [`EntropySource::Switchboard`] - the draw consumes a Switchboard
//!   On-Demand randomness account. The board binds one specific account when
//!   the round opens, and the account must have been committed in the window
//!   between the previous round closing and this round opening - a window in
//!   which the round holds zero tickets, so the committer has no information to
//!   grind against. Switchboard's own rule that the value is only valid in the
//!   slot it was revealed in (`reveal_slot == clock.slot`) stops anyone from
//!   shopping between pre-committed accounts after the tickets are frozen.
//!
//! The layout below is a faithful copy of `RandomnessAccountData` from the
//! official `switchboard-on-demand` v0.13.0 crate
//! (`src/on_demand/accounts/randomness.rs`), including the discriminator, so we
//! can verify accounts without pulling a protobuf toolchain into the build.

use anchor_lang::prelude::*;

use crate::errors::LaunchpadError;

/// Switchboard On-Demand program, mainnet-beta.
pub const SWITCHBOARD_ON_DEMAND_MAINNET: Pubkey =
    pubkey!("SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv");
/// Switchboard On-Demand program, devnet.
pub const SWITCHBOARD_ON_DEMAND_DEVNET: Pubkey =
    pubkey!("Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2");

/// `RandomnessAccountData::DISCRIMINATOR` (v0.13.0).
pub const RANDOMNESS_DISCRIMINATOR: [u8; 8] = [10, 66, 229, 135, 220, 239, 217, 114];
/// `RandomnessAccountData::size()`: the 8 byte discriminator plus the struct.
pub const RANDOMNESS_ACCOUNT_SIZE: usize = 408;
/// Size of the struct that follows the discriminator.
pub const RANDOMNESS_DATA_SIZE: usize = 400;

/// How the draw gets its 32 bytes of entropy.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum EntropySource {
    /// Lazily read a future slot hash out of the SlotHashes sysvar.
    SlotHashes,
    /// Consume a Switchboard On-Demand randomness account the round committed to.
    Switchboard,
}

pub fn is_switchboard_program(owner: &Pubkey) -> bool {
    owner == &SWITCHBOARD_ON_DEMAND_MAINNET || owner == &SWITCHBOARD_ON_DEMAND_DEVNET
}

/// The subset of `RandomnessAccountData` the lottery needs, parsed from raw bytes.
#[derive(Clone, Copy, Debug, Default)]
pub struct RandomnessAccount {
    pub authority: Pubkey,
    pub queue: Pubkey,
    /// Slot hash the randomness was seeded with.
    pub seed_slothash: [u8; 32],
    /// Slot at which the seed was committed. Must predate the round's tickets.
    pub seed_slot: u64,
    pub oracle: Pubkey,
    /// Slot at which the oracle revealed the value.
    pub reveal_slot: u64,
    /// The random value itself.
    pub value: [u8; 32],
}

impl RandomnessAccount {
    pub fn parse(data: &[u8]) -> Result<Self> {
        require!(
            data.len() >= RANDOMNESS_ACCOUNT_SIZE,
            LaunchpadError::RandomnessNotReady
        );
        require!(
            data[..8] == RANDOMNESS_DISCRIMINATOR,
            LaunchpadError::InvalidRandomnessSource
        );
        let body = &data[8..RANDOMNESS_ACCOUNT_SIZE];
        let mut account = RandomnessAccount::default();
        account.authority = read_pubkey(&body[0..32])?;
        account.queue = read_pubkey(&body[32..64])?;
        account.seed_slothash.copy_from_slice(&body[64..96]);
        account.seed_slot = read_u64(&body[96..104])?;
        account.oracle = read_pubkey(&body[104..136])?;
        account.reveal_slot = read_u64(&body[136..144])?;
        account.value.copy_from_slice(&body[144..176]);
        Ok(account)
    }

    /// The entropy, valid only in the slot the oracle revealed it in.
    ///
    /// This is Switchboard's anti-replay rule and it is what makes the lottery
    /// ungrindable: the value cannot be carried over to a slot of the caller's
    /// choosing, so the tickets are already frozen by the time anybody learns
    /// the outcome.
    pub fn get_value(&self, clock_slot: u64) -> Result<[u8; 32]> {
        require!(
            clock_slot == self.reveal_slot,
            LaunchpadError::RandomnessNotReady
        );
        Ok(self.value)
    }
}

fn read_pubkey(bytes: &[u8]) -> Result<Pubkey> {
    let mut raw = [0u8; 32];
    raw.copy_from_slice(bytes);
    Ok(Pubkey::new_from_array(raw))
}

fn read_u64(bytes: &[u8]) -> Result<u64> {
    let mut raw = [0u8; 8];
    raw.copy_from_slice(bytes);
    Ok(u64::from_le_bytes(raw))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_account(seed_slot: u64, reveal_slot: u64, value: [u8; 32]) -> Vec<u8> {
        let mut data = Vec::with_capacity(RANDOMNESS_ACCOUNT_SIZE);
        data.extend_from_slice(&RANDOMNESS_DISCRIMINATOR);
        data.extend_from_slice(&[1u8; 32]); // authority
        data.extend_from_slice(&[2u8; 32]); // queue
        data.extend_from_slice(&[3u8; 32]); // seed slot hash
        data.extend_from_slice(&seed_slot.to_le_bytes());
        data.extend_from_slice(&[4u8; 32]); // oracle
        data.extend_from_slice(&reveal_slot.to_le_bytes());
        data.extend_from_slice(&value);
        data.extend_from_slice(&[0u8; 96]);
        data.extend_from_slice(&[0u8; 128]);
        assert_eq!(data.len(), RANDOMNESS_ACCOUNT_SIZE);
        data
    }

    #[test]
    fn parses_the_official_layout() {
        let account = RandomnessAccount::parse(&build_account(1_000, 1_010, [9u8; 32])).unwrap();
        assert_eq!(account.seed_slot, 1_000);
        assert_eq!(account.reveal_slot, 1_010);
        assert_eq!(account.value, [9u8; 32]);
        assert_eq!(account.authority, Pubkey::new_from_array([1u8; 32]));
        assert_eq!(account.queue, Pubkey::new_from_array([2u8; 32]));
        assert_eq!(account.oracle, Pubkey::new_from_array([4u8; 32]));
        assert_eq!(account.seed_slothash, [3u8; 32]);
        assert_eq!(RANDOMNESS_ACCOUNT_SIZE, 8 + RANDOMNESS_DATA_SIZE);
    }

    #[test]
    fn rejects_a_wrong_discriminator_or_a_short_account() {
        let mut bad = build_account(1, 2, [0u8; 32]);
        bad[0] = 0;
        assert!(RandomnessAccount::parse(&bad).is_err());
        assert!(RandomnessAccount::parse(&build_account(1, 2, [0u8; 32])[..200]).is_err());
    }

    #[test]
    fn the_value_is_only_valid_in_its_reveal_slot() {
        let account = RandomnessAccount::parse(&build_account(1_000, 1_010, [7u8; 32])).unwrap();
        assert_eq!(account.get_value(1_010).unwrap(), [7u8; 32]);
        assert!(account.get_value(1_011).is_err());
        assert!(account.get_value(1_009).is_err());
    }

    #[test]
    fn switchboard_programs_are_recognised() {
        assert!(is_switchboard_program(&SWITCHBOARD_ON_DEMAND_MAINNET));
        assert!(is_switchboard_program(&SWITCHBOARD_ON_DEMAND_DEVNET));
        assert!(!is_switchboard_program(&Pubkey::default()));
    }
}
