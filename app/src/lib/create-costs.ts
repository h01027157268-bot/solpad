import {
  DEFAULT_CREATION_FEE_LAMPORTS,
  REGISTRY_RENT_LAMPORTS,
  ROUND_ACCOUNT_RENT_LAMPORTS,
  TOP_BOARD_RENT_LAMPORTS,
  MINT_RENT_LAMPORTS,
  PDA_RENT_LAMPORTS,
  TOKEN_ACCOUNT_RENT_LAMPORTS,
} from '@/lib/engine/constants';

/** Rent for the launched account itself (`8 + Launch::INIT_SPACE` bytes). */
export const LAUNCH_ACCOUNT_RENT_LAMPORTS = 4_885_920;

export interface CostLine {
  label: string;
  lamports: bigint;
  hint?: string;
}

/** Everything a launch costs, in lamports. Mirrors the account list of `create_launch`. */
export function creationCosts(devBuyLamports: bigint): { lines: CostLine[]; total: bigint } {
  const lines: CostLine[] = [
    {
      label: 'Launch fee',
      lamports: BigInt(DEFAULT_CREATION_FEE_LAMPORTS),
      hint: 'paid to the platform vault',
    },
    {
      label: 'Launch account',
      lamports: BigInt(LAUNCH_ACCOUNT_RENT_LAMPORTS),
      hint: 'curve state, name, symbol and metadata uri',
    },
    {
      label: 'Mint + token vaults',
      lamports: BigInt(MINT_RENT_LAMPORTS) + 2n * BigInt(TOKEN_ACCOUNT_RENT_LAMPORTS),
      hint: 'one mint, the curve vault and the migration reserve',
    },
    {
      label: 'Top-ten board',
      lamports: BigInt(TOP_BOARD_RENT_LAMPORTS),
      hint: '10 seats, rewritten on every trade',
    },
    {
      label: 'Holder registry',
      lamports: BigInt(REGISTRY_RENT_LAMPORTS),
      hint: '64 slots - the pool the draw picks from',
    },
    {
      label: 'Round',
      lamports: BigInt(ROUND_ACCOUNT_RENT_LAMPORTS),
      hint: 'pot, commitment and the ten winners',
    },
    {
      label: 'SOL vaults',
      lamports: 3n * BigInt(PDA_RENT_LAMPORTS),
      hint: 'raise, dividends and lottery pot stay rent exempt',
    },
    {
      label: 'Your token account',
      lamports: BigInt(TOKEN_ACCOUNT_RENT_LAMPORTS),
      hint: 'created on your first buy',
    },
  ];
  if (devBuyLamports > 0n) {
    lines.push({ label: 'Dev buy', lamports: devBuyLamports, hint: 'same transaction as the launch' });
  }
  const total = lines.reduce((sum, line) => sum + line.lamports, 0n);
  return { lines, total };
}

