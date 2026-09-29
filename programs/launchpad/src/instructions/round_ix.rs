//! Round cranks: close a quiet round, then draw and pay the winners.

use anchor_lang::prelude::*;
use anchor_spl::token::Mint;

use crate::board::HolderRegistry;
use crate::constants::*;
use crate::entropy::{self, EntropySource, RandomnessAccount};
use crate::errors::LaunchpadError;
use crate::events;
use crate::instructions::transfer_lamports;
use crate::round as lifecycle;
use crate::state::*;

#[derive(Accounts)]
pub struct CloseRound<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [LAUNCH_SEED, mint.key().as_ref()], bump = launch.bump)]
    pub launch: Account<'info, Launch>,

    #[account(address = launch.mint)]
    pub mint: Account<'info, Mint>,

    #[account(mut, seeds = [ROUND_SEED, launch.key().as_ref()], bump = round.bump)]
    pub round: Account<'info, Round>,
}

pub fn close_round_handler(ctx: Context<CloseRound>) -> Result<()> {
    let clock = Clock::get()?;
    let launch_key = ctx.accounts.launch.key();
    let entropy_source = ctx.accounts.launch.entropy_source;
    let round = &mut ctx.accounts.round;
    require!(round.is_open(), LaunchpadError::RoundStillOpen);
    require!(
        round.volume_lamports >= ROUND_VOLUME_TARGET_LAMPORTS as u128
            || clock.slot.saturating_sub(round.opened_at_slot) >= ROUND_QUIET_SLOTS,
        LaunchpadError::RoundStillOpen
    );
    close_now(launch_key, entropy_source, round, clock.slot);
    Ok(())
}

fn close_now(launch_key: Pubkey, entropy_source: EntropySource, round: &mut Round, slot: u64) {
    let target = match entropy_source {
        EntropySource::SlotHashes => slot.saturating_add(REVEAL_DELAY_SLOTS),
        EntropySource::Switchboard => round.randomness_seed_slot,
    };
    lifecycle::close_round(round, slot, target);
    emit!(events::RoundClosed {
        launch: launch_key,
        index: round.index,
        pot: round.pot,
        volume_lamports: round.volume_lamports as u64,
        target_slot: round.target_slot,
        commitment: round.commitment,
    });
}

#[derive(Accounts)]
pub struct ResolveRound<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [LAUNCH_SEED, mint.key().as_ref()], bump = launch.bump)]
    pub launch: Account<'info, Launch>,

    #[account(address = launch.mint)]
    pub mint: Account<'info, Mint>,

    #[account(mut, seeds = [ROUND_SEED, launch.key().as_ref()], bump = round.bump)]
    pub round: Account<'info, Round>,

    #[account(seeds = [HOLDER_REGISTRY_SEED, launch.key().as_ref()], bump = registry.bump)]
    pub registry: Account<'info, HolderRegistry>,

    /// CHECK: the round pot, a system PDA and therefore a signer of this program.
    #[account(mut, seeds = [DRAW_VAULT_SEED, launch.key().as_ref()], bump)]
    pub draw_vault: SystemAccount<'info>,

    /// CHECK: platform vault, receives the dust and any unreachable prize.
    #[account(mut, address = config.treasury)]
    pub treasury: SystemAccount<'info>,

    /// CHECK: the slot hashes sysvar, used by the `SlotHashes` source.
    #[account(address = SLOT_HASHES_ID)]
    pub slot_hashes: UncheckedAccount<'info>,

    /// CHECK: the Switchboard account the *next* round will be bound to.
    #[account(mut)]
    pub randomness_account: UncheckedAccount<'info>,

    /// The ten winners, in the order the draw produced them. Only the first
    /// `winners_found` are required; pass the program id as a placeholder for
    /// the rest.
    #[account(mut)]
    pub winner0: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub winner1: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub winner2: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub winner3: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub winner4: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub winner5: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub winner6: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub winner7: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub winner8: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub winner9: Option<UncheckedAccount<'info>>,

    pub system_program: Program<'info, System>,
}

pub fn resolve_round_handler(ctx: Context<ResolveRound>) -> Result<()> {
    let clock = Clock::get()?;
    let launch_key = ctx.accounts.launch.key();
    let entropy_source = ctx.accounts.launch.entropy_source;

    {
        let round = &ctx.accounts.round;
        require!(!round.is_open(), LaunchpadError::RoundStillOpen);
        require!(!round.resolved, LaunchpadError::RoundAlreadyResolved);
        require!(
            clock.slot >= round.target_slot,
            LaunchpadError::RandomnessNotReady
        );
    }

    // Only the entropy changes with the source; the selection logic below is the
    // same for both of them.
    let (entropy_bytes, reveal_slot) = match entropy_source {
        EntropySource::SlotHashes => {
            let target_slot = ctx.accounts.round.target_slot;
            let data = ctx.accounts.slot_hashes.try_borrow_data()?;
            let hash = lifecycle::slot_hash_at(&data, target_slot)
                .or_else(|| lifecycle::oldest_slot_hash(&data))
                .ok_or(error!(LaunchpadError::RandomnessNotReady))?;
            (hash, target_slot)
        }
        EntropySource::Switchboard => {
            let info = ctx.accounts.randomness_account.to_account_info();
            require_keys_eq!(
                info.key(),
                ctx.accounts.round.randomness_account,
                LaunchpadError::InvalidRandomnessSource
            );
            require!(
                entropy::is_switchboard_program(&info.owner),
                LaunchpadError::InvalidRandomnessSource
            );
            let data = info.try_borrow_data()?;
            let account = RandomnessAccount::parse(&data)?;
            drop(data);
            (account.get_value(clock.slot)?, account.reveal_slot)
        }
    };

    let winners = ctx
        .accounts
        .registry
        .draw_winners(&ctx.accounts.round.commitment, &entropy_bytes)?;
    let found = winners
        .iter()
        .filter(|winner| **winner != Pubkey::default())
        .count() as u8;

    let draw_vault = ctx.accounts.draw_vault.to_account_info();
    let treasury = ctx.accounts.treasury.to_account_info();
    {
        let round = &mut ctx.accounts.round;
        round.prize = if found > 0 { round.pot / found as u64 } else { 0 };
        round.winners = winners;
        round.winners_found = found;
        round.resolved = true;
        round.resolved_at_slot = clock.slot;
        round.paid_out = true;
    }
    let pot = ctx.accounts.round.pot;
    let prize = ctx.accounts.round.prize;

    let vault_seeds: &[&[u8]] = &[
        DRAW_VAULT_SEED,
        launch_key.as_ref(),
        &[ctx.bumps.draw_vault],
    ];
    let found = ctx.accounts.round.winners_found as usize;
    if found == 0 || prize == 0 {
        transfer_lamports(&draw_vault, &treasury, pot, Some(&[vault_seeds]))?;
    } else {
        let winners_accounts = [
            ctx.accounts.winner0.as_ref(),
            ctx.accounts.winner1.as_ref(),
            ctx.accounts.winner2.as_ref(),
            ctx.accounts.winner3.as_ref(),
            ctx.accounts.winner4.as_ref(),
            ctx.accounts.winner5.as_ref(),
            ctx.accounts.winner6.as_ref(),
            ctx.accounts.winner7.as_ref(),
            ctx.accounts.winner8.as_ref(),
            ctx.accounts.winner9.as_ref(),
        ];
        for i in 0..found {
            let winner =
                winners_accounts[i].ok_or(error!(LaunchpadError::MissingSeatAccounts))?;
            require_keys_eq!(
                winner.key(),
                ctx.accounts.round.winners[i],
                LaunchpadError::InvalidSeatAccount
            );
            let info = winner.to_account_info();
            let destination = if info.lamports() > 0 { &info } else { &treasury };
            transfer_lamports(&draw_vault, destination, prize, Some(&[vault_seeds]))?;
        }
        let dust = pot.saturating_sub(prize.saturating_mul(found as u64));
        if dust > 0 {
            transfer_lamports(&draw_vault, &treasury, dust, Some(&[vault_seeds]))?;
        }
    }

    emit!(events::RoundResolved {
        launch: launch_key,
        index: ctx.accounts.round.index,
        pot,
        prize,
        winners,
        winners_found: found as u8,
        entropy_source: entropy_source as u8,
        reveal_slot,
        pool_size: ctx.accounts.registry.count as u32,
    });

    // Bind the next round to its entropy *before* it can trade.
    let closed_at = ctx.accounts.round.closed_at_slot;
    let (randomness_account, randomness_seed_slot) = if entropy_source == EntropySource::Switchboard {
        let info = ctx.accounts.randomness_account.to_account_info();
        require!(
            entropy::is_switchboard_program(&info.owner),
            LaunchpadError::InvalidRandomnessSource
        );
        let data = info.try_borrow_data()?;
        let account = RandomnessAccount::parse(&data)?;
        drop(data);
        require!(
            account.seed_slot >= closed_at,
            LaunchpadError::InvalidRandomnessSource
        );
        (info.key(), account.seed_slot)
    } else {
        (Pubkey::default(), 0)
    };

    let round = &mut ctx.accounts.round;
    lifecycle::open_round(round, clock.slot, 0);
    round.randomness_account = randomness_account;
    round.randomness_seed_slot = randomness_seed_slot;
    if entropy_source == EntropySource::Switchboard {
        round.target_slot = randomness_seed_slot;
    }
    ctx.accounts.launch.round = round.index;
    let _ = ctx.accounts.system_program.key();
    Ok(())
}



