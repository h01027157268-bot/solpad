export const SOL_PRICE_USD = Number(process.env.NEXT_PUBLIC_SOL_PRICE ?? 180);

/** The deployed program. Empty = the app runs on its offline mirror engine. */
export const PROGRAM_ID = process.env.NEXT_PUBLIC_PROGRAM_ID ?? '';
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://api.devnet.solana.com';


/**
 * The platform vault: every trade pays 1% straight into this address.
 *
 * It is set as `Config.treasury` when the platform is initialised
 * (`scripts/init-config.mjs`), so this value is only a default for the scripts
 * and for the UI display - the program reads it from its own config account.
 */
export const TREASURY_ADDRESS =
  process.env.NEXT_PUBLIC_TREASURY ?? 'EYB8XKsysDpSkK4PdBg4Rx3EMqY5NJ1LGfmvUdiKkqaQ';

/** The real cluster this build talks to. Never a placeholder label. */
export const NETWORK = RPC_URL.includes('devnet')
  ? 'devnet'
  : RPC_URL.includes('testnet')
    ? 'testnet'
    : 'mainnet';

/**
 * Seeded sample launches. Off by default: with it off the board shows the real
 * state of this launchpad (which is empty until somebody launches).
 */
export const SHOW_DEMO_LAUNCHES = process.env.NEXT_PUBLIC_DEMO_LAUNCHES === '1';

export function explorerAddress(address: string): string {
  const cluster = RPC_URL.includes('devnet') ? '?cluster=devnet' : '';
  return `https://solscan.io/account/${address}${cluster}`;
}

export function explorerTx(signature: string): string {
  const cluster = RPC_URL.includes('devnet') ? '?cluster=devnet' : '';
  return `https://solscan.io/tx/${signature}${cluster}`;
}


