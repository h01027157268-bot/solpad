//! SolPad - a Solana fair-launch launchpad.
//!
//! Everything about a launch happens in one program:
//!
//! * `create_launch` mints the whole pump.fun supply onto a bonding curve,
//! * `buy` / `sell` trade against that curve and split the trade tax,
//! * `claim_dividends` pays the holders' share of the tax in dividend mode,
//! * the lottery board draws the pool's share in lottery mode,
//! * `migrate` locks the raise and the reserved tokens into a pool, and
//! * `swap` keeps trading - and taxing - after graduation.
//!
//! Fee model
//! ---------
//! ```text
//! Dividend mode   5% of every buy and sell
//!                 1% platform vault | 4% pro-rata to every holder
//!
//! Lottery mode   10% of every buy and sell
//!                 1% platform vault | 6% pot for the first ten trades
//!                 3% pot afterwards | remainder -> configurable bucket
//! ```

use anchor_lang::prelude::*;

pub mod constants;
pub mod board;
pub mod curve;
pub mod dividends;
pub mod entropy;
pub mod errors;
pub mod events;
pub mod fees;
pub mod instructions;
pub mod round;
pub mod state;

use instructions::*;

declare_id!("8Fg3GzGg2pDHHRy4uMZ1Jv1HQ7cadifNbWKmVW1rwAzL");

#[program]
pub mod launchpad {
    use super::*;

    /// Create the platform config. Callable once per deployment.
    pub fn initialize_config(ctx: Context<InitializeConfig>, args: InitConfigArgs) -> Result<()> {
        initialize_config_handler(ctx, args)
    }

    /// Update the platform parameters, start an authority hand-over or pause.
    pub fn update_config(ctx: Context<UpdateConfig>, args: UpdateConfigArgs) -> Result<()> {
        update_config_handler(ctx, args)
    }

    /// Finish a two-step authority hand-over.
    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        accept_authority_handler(ctx)
    }

    /// Launch: 1B supply straight onto the curve, no creator allocation.
    pub fn create_launch(ctx: Context<CreateLaunch>, args: state::CreateLaunchArgs) -> Result<()> {
        create_launch_handler(ctx, args)
    }

    /// Buy on the curve. `amount_in` is the gross lamports the buyer pays.
    pub fn buy(ctx: Context<Buy>, amount_in: u64, min_tokens_out: u64) -> Result<()> {
        buy_handler(ctx, amount_in, min_tokens_out)
    }

    /// Sell on the curve. `tokens_in` is the gross amount and the tax is taken
    /// out of the proceeds.
    pub fn sell(ctx: Context<Sell>, tokens_in: u64, min_sol_out: u64) -> Result<()> {
        sell_handler(ctx, tokens_in, min_sol_out)
    }

    /// Claim the holder dividend slice earned so far.
    pub fn claim_dividends(ctx: Context<ClaimDividends>) -> Result<()> {
        claim_dividends_handler(ctx)
    }

    /// Move unattributable surplus out of a dividend vault (authority only).
    pub fn sweep_dividend_vault(ctx: Context<SweepDividendVault>, amount: u64) -> Result<()> {
        sweep_dividend_vault_handler(ctx, amount)
    }

    /// Close the open round early once it has gone quiet (permissionless).
    pub fn close_round(ctx: Context<CloseRound>) -> Result<()> {
        close_round_handler(ctx)
    }

    /// Draw the round's ten winners, pay them and open the next round.
    pub fn resolve_round(ctx: Context<ResolveRound>) -> Result<()> {
        resolve_round_handler(ctx)
    }

    /// Graduate: lock the raise and the reserved tokens into the pool.
    pub fn migrate(ctx: Context<Migrate>) -> Result<()> {
        migrate_handler(ctx)
    }

    /// Attach or refresh the Metaplex metadata for a launch (permissionless).
    pub fn attach_metadata(ctx: Context<AttachMetadata>, args: MetadataArgs) -> Result<()> {
        attach_metadata_handler(ctx, args)
    }

    /// Trade against the locked pool after graduation; the same tax applies.
    pub fn swap(
        ctx: Context<Swap>,
        direction: SwapDirection,
        amount_in: u64,
        min_amount_out: u64,
    ) -> Result<()> {
        swap_handler(ctx, direction, amount_in, min_amount_out)
    }
}




