/**
 * Protocol constants - the single source of truth is
 * `programs/launchpad/src/constants.rs`. Every number below is mirrored from it
 * so the UI, the quotes and the mirror market cannot drift from the chain.
 */

export const BPS_DENOMINATOR = 10_000;
export const ACC_PRECISION = 10n ** 18n;
export const TOKEN_DECIMALS = 6;
export const ONE_TOKEN = 1_000_000;

/** pump.fun curve, unchanged. */
export const TOTAL_SUPPLY = 1_000_000_000 * ONE_TOKEN;
export const CURVE_SUPPLY = 793_100_000 * ONE_TOKEN;
export const POOL_RESERVE = 206_900_000 * ONE_TOKEN;
export const VIRTUAL_SOL_RESERVES = 30_000_000_000;
export const VIRTUAL_TOKEN_RESERVES = 1_073_000_000 * ONE_TOKEN;
export const GRADUATION_LAMPORTS = 85_000_000_000;

/**
 * Taxes, in basis points.
 *
 * Dividend mode   5%  = 1% platform vault + 4% pro-rata to every holder
 * Lottery mode   10%  = 1% platform vault
 *                     + 3% split evenly across the ten largest holders
 *                     + 6% split evenly across ten random holders
 */
export const VAULT_BPS = 100;
export const DIVIDEND_MODE_TAX_BPS = 500;
export const DIVIDEND_MODE_DIVIDEND_BPS = 400;
export const LOTTERY_MODE_TAX_BPS = 1_000;
/** Seats on the top-holder board - the 3% is split evenly across them. */
export const TOP_SEATS = 10;
export const TOP_SHARE_BPS = 300;
/** Winners drawn from the holder registry each round - they split the 6%. */
export const DRAW_WINNERS = 10;
export const DRAW_SHARE_BPS = 600;
/** Wallet slots in the registry the draw picks from. */
export const MAX_HOLDERS = 64;

/** A round closes once this much volume has traded into it (10 SOL). */
export const ROUND_VOLUME_TARGET_LAMPORTS = 10_000_000_000n;
/** Slots to wait between closing a round and drawing it (lazy VRF delay). */
export const REVEAL_DELAY_SLOTS = 8;
/** A round can be closed early once it has been quiet for this long. */
export const ROUND_QUIET_SLOTS = 43_200;

/** Platform. */
export const MIN_TRADE_LAMPORTS = 1_000_000;
export const DEFAULT_CREATION_FEE_LAMPORTS = 20_000_000;
export const PDA_RENT_LAMPORTS = 1_000_000;
export const ROUND_ACCOUNT_RENT_LAMPORTS = 4_500_000;
export const TOP_BOARD_RENT_LAMPORTS = 4_000_000;
export const REGISTRY_RENT_LAMPORTS = 15_400_000;
export const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280;
export const MINT_RENT_LAMPORTS = 1_461_600;

/** UI default: 1% slippage tolerance. */
export const DEFAULT_SLIPPAGE_BPS = 100;
