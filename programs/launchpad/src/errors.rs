//! Program errors.

use anchor_lang::prelude::*;

#[error_code]
pub enum LaunchpadError {
    #[msg("Protocol is paused")]
    Paused,
    #[msg("Caller is not authorised for this action")]
    Unauthorized,
    #[msg("Invalid fee configuration: total tax exceeds the cap")]
    InvalidFeeConfig,
    #[msg("Invalid fee configuration: vault fee exceeds the cap")]
    VaultFeeTooHigh,
    #[msg("Invalid fee configuration: dividend fee exceeds the cap")]
    DividendFeeTooHigh,
    #[msg("Invalid fee configuration: lottery fee exceeds the cap")]
    LotteryFeeTooHigh,
    #[msg("Invalid curve configuration")]
    InvalidCurveConfig,
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Trade amount is below the configured minimum")]
    AmountTooSmall,
    #[msg("Not enough tokens in the wallet for this trade")]
    InsufficientTokens,
    #[msg("Curve is sold out, migrate to the pool first")]
    CurveSoldOut,
    #[msg("Launch has already migrated to the AMM pool")]
    AlreadyMigrated,
    #[msg("Launch has not migrated yet")]
    NotMigrated,
    #[msg("Curve has not reached the graduation target yet")]
    NotGraduated,
    #[msg("Not enough tokens available on the curve")]
    InsufficientCurveTokens,
    #[msg("Not enough SOL in the curve vault")]
    InsufficientCurveSol,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Arithmetic underflow")]
    MathUnderflow,
    #[msg("New authority must differ from the current authority")]
    SameAuthority,
    #[msg("No authority transfer is pending")]
    NoPendingAuthority,
    #[msg("Token metadata exceeds the allowed length")]
    MetadataTooLong,
    #[msg("Position does not hold any tokens")]
    EmptyPosition,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Lottery round is still open")]
    RoundStillOpen,
    #[msg("This lottery round has already been drawn")]
    RoundAlreadyResolved,
    #[msg("Lottery round has not been drawn yet")]
    RoundNotResolved,
    #[msg("The supplied account is not the winner of the round")]
    NotTheWinner,
    #[msg("Lottery prize has already been claimed")]
    PrizeAlreadyClaimed,
    #[msg("Randomness is not available yet, retry in a few slots")]
    RandomnessNotReady,
    #[msg("Invalid randomness source account")]
    InvalidRandomnessSource,
    #[msg("The token account balance does not match the tracked balance")]
    BalanceMismatch,
    #[msg("Launch is currently in the wrong state for this action")]
    InvalidLaunchState,
    #[msg("Launch mode does not support this action")]
    UnsupportedMode,
    #[msg("A dividend distribution could not be attributed, no eligible supply")]
    NoEligibleSupply,
    #[msg("Program id mismatch")]
    InvalidProgramId,
    #[msg("The seated holders or winners must be passed as remaining accounts, in order")]
    MissingSeatAccounts,
    #[msg("A passed seat or winner does not match the on-chain board")]
    InvalidSeatAccount,
}

