import type { LaunchMode } from '@/lib/engine/fees';
import type { TopBoardState } from '@/lib/engine/board';

export type LaunchStatus = 'bonding' | 'migrated';

/** Mirrors the on-chain `Round` account. */
export interface RoundState {
  index: number;
  /** The 6% slice accrued so far. */
  pot: bigint;
  volumeLamports: bigint;
  trades: number;
  openedAtSlot: number;
  closedAtSlot: number;
  targetSlot: number;
  commitment: Uint8Array;
  resolved: boolean;
  winners: string[];
  /** What each winner receives. */
  prize: bigint;
}

/** Mirrors the on-chain `Launch` account one-to-one. */
export interface LaunchState {
  mint: string;
  creator: string;
  mode: LaunchMode;
  status: LaunchStatus;
  name: string;
  symbol: string;
  uri: string;
  description: string;
  imageUrl?: string;
  createdAt: number;

  // curve
  virtualSol: bigint;
  virtualTokens: bigint;
  realSol: bigint;
  realTokens: bigint;
  totalSupply: bigint;
  poolReserve: bigint;
  graduationLamports: bigint;
  marketCapLamports: bigint;

  // stats
  trades: number;
  buys: number;
  sells: number;
  volumeLamports: bigint;
  positions: number;
  migratedAt: number;

  // taxes
  vaultBps: number;
  topBps: number;
  drawBps: number;
  dividendBps: number;

  // dividends (the pro-rata slice: 4% in dividend mode, 3% would be here too)
  dividendAcc: bigint;
  dividendDistributed: bigint;
  dividendClaimed: bigint;

  // lottery
  board: TopBoardState;
  registry: string[];
  round: RoundState;
  /** Lifetime SOL paid to the seated top holders. */
  topDistributed: bigint;
  /** Lifetime SOL paid to the draw winners. */
  drawDistributed: bigint;
  /** Lifetime SOL the platform vault took from this launch's trades (1%). */
  vaultDistributed: bigint;

  // graduation
  pool: { solReserves: bigint; tokenReserves: bigint; lpSupply: bigint } | null;

  // local mirrors
  balances: Record<string, bigint>;
  dividendPaid: Record<string, bigint>;
  dividendsClaimed: Record<string, bigint>;
  /** SOL each wallet has received from the 3% seat slice. */
  seatEarnings: Record<string, bigint>;
  /** SOL each wallet has won in the draw. */
  winnings: Record<string, bigint>;
  volumeByOwner: Record<string, bigint>;
  tradeLog: TradeRow[];
  history: PricePoint[];
  winners: WinnerRow[];
  nameRegistry: Record<string, string>;
}

export interface TradeRow {
  id: string;
  ts: number;
  owner: string;
  isBuy: boolean;
  solAmount: bigint;
  tokenAmount: bigint;
  priceE6: bigint;
  marketCapLamports: bigint;
  fees: {
    vault: bigint;
    top: bigint;
    draw: bigint;
    dividend: bigint;
    total: bigint;
  };
  slot: number;
  round: number;
}

export interface PricePoint {
  t: number;
  mcap: number;
  price: number;
}

export interface WinnerRow {
  round: number;
  winners: string[];
  prize: bigint;
  ts: number;
}

export interface PositionView {
  owner: string;
  balance: bigint;
  pendingDividends: bigint;
  dividendsClaimed: bigint;
  volumeLamports: bigint;
  seatRank: number | null;
  seatEarnings: bigint;
  winnings: bigint;
  shareBps: number;
}

export interface HolderRow {
  owner: string;
  label: string;
  balance: bigint;
  shareBps: number;
  valueLamports: bigint;
  seated: boolean;
}

export type Filter = 'live' | 'trending' | 'new' | 'graduating' | 'graduated';

export interface CreateLaunchInput {
  mode: LaunchMode;
  name: string;
  symbol: string;
  description: string;
  imageUrl?: string;
  devBuyLamports: bigint;
}


