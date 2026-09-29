//! Metaplex token metadata.
//!
//! `create_launch` deliberately keeps the metadata out of the launch
//! transaction: it stays atomic and cheap, and a cluster without the Metaplex
//! program can still launch. `attach_metadata` is the follow-up CPI - it is
//! permissionless, so the app sends it right behind `create_launch` in the same
//! transaction, and anybody can attach or refresh metadata afterwards.
//!
//! The mint authority is the launch PDA, so the program signs the CPI with the
//! launch seeds and the creator never has to expose a key. Metadata is mutable
//! (Creators can fix a typo) while the supply itself can never change, because
//! `create_launch` already revoked the mint authority.

use anchor_lang::prelude::*;
use anchor_spl::metadata::{
    create_metadata_accounts_v3, mpl_token_metadata::types::DataV2, CreateMetadataAccountsV3,
    Metadata,
};
use anchor_spl::token::Mint;

use crate::constants::*;
use crate::errors::LaunchpadError;
use crate::state::Launch;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MetadataArgs {
    pub name: String,
    pub symbol: String,
    pub uri: String,
    /// Royalty in basis points, 0 for a launchpad token.
    pub seller_fee_basis_points: u16,
}

#[derive(Accounts)]
pub struct AttachMetadata<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut, seeds = [LAUNCH_SEED, mint.key().as_ref()], bump = launch.bump)]
    pub launch: Account<'info, Launch>,

    #[account(mut, address = launch.mint)]
    pub mint: Account<'info, Mint>,

    /// CHECK: the Metaplex metadata PDA for this mint, verified below.
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,

    pub token_metadata_program: Program<'info, Metadata>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn attach_metadata_handler(ctx: Context<AttachMetadata>, args: MetadataArgs) -> Result<()> {
    require!(args.name.as_bytes().len() <= MAX_NAME_LEN, LaunchpadError::MetadataTooLong);
    require!(args.symbol.as_bytes().len() <= MAX_SYMBOL_LEN, LaunchpadError::MetadataTooLong);
    require!(args.uri.as_bytes().len() <= MAX_URI_LEN, LaunchpadError::MetadataTooLong);
    require!(
        args.seller_fee_basis_points <= MAX_SELLER_FEE_BPS,
        LaunchpadError::InvalidFeeConfig
    );

    // The caller may pass any account; only the canonical PDA is accepted.
    let mint_key = ctx.accounts.mint.key();
    let (expected, _) = Pubkey::find_program_address(
        &[b"metadata", anchor_spl::metadata::mpl_token_metadata::ID.as_ref(), mint_key.as_ref()],
        &anchor_spl::metadata::mpl_token_metadata::ID,
    );
    require_keys_eq!(
        ctx.accounts.metadata.key(),
        expected,
        LaunchpadError::InvalidProgramId
    );

    let launch_bump = ctx.accounts.launch.bump;
    let signer_seeds: &[&[u8]] = &[LAUNCH_SEED, mint_key.as_ref(), &[launch_bump]];

    let data = DataV2 {
        name: args.name.clone(),
        symbol: args.symbol.clone(),
        uri: args.uri.clone(),
        seller_fee_basis_points: args.seller_fee_basis_points,
        creators: None,
        collection: None,
        uses: None,
    };

    create_metadata_accounts_v3(
        CpiContext::new_with_signer(
            ctx.accounts.token_metadata_program.to_account_info(),
            CreateMetadataAccountsV3 {
                metadata: ctx.accounts.metadata.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                mint_authority: ctx.accounts.launch.to_account_info(),
                payer: ctx.accounts.payer.to_account_info(),
                update_authority: ctx.accounts.launch.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            &[signer_seeds],
        ),
        data,
        true, // is_mutable: the creator can fix the uri later
        true, // update_authority_is_signer
        None, // collection_details
    )?;

    emit!(crate::events::MetadataAttached {
        launch: ctx.accounts.launch.key(),
        mint: mint_key,
        metadata: expected,
        name: args.name,
        symbol: args.symbol,
        uri: args.uri,
    });
    Ok(())
}
