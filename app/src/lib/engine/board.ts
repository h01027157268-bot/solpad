/**
 * The two bounded membership sets the lottery mode needs, mirrored from
 * `programs/launchpad/src/board.rs`.
 *
 * `TopBoard` - the ten largest positions, kept sorted. The 3% slice is split
 * evenly across its seats and paid inside the trade that produced it.
 *
 * `Registry` - every wallet that ever held the token, in arrival order, capped
 * at `MAX_HOLDERS`. The 6% draw picks ten distinct winners out of it.
 *
 * On-chain the draw is seeded by Switchboard or a future slot hash. Here it is
 * seeded by a deterministic digest of the round commitment plus that entropy, so
 * the same round always resolves to the same winners and the UI can show them.
 */

import { DRAW_WINNERS, MAX_HOLDERS, TOP_SEATS } from './constants';

export interface TopBoardState {
  seats: string[];
  balances: bigint[];
}

export function emptyBoard(): TopBoardState {
  return { seats: [], balances: [] };
}

/** Insert, move or evict `owner` so the board keeps the ten largest, sorted. */
export function upsertSeat(board: TopBoardState, owner: string, balance: bigint): TopBoardState {
  const seats = [...board.seats];
  const balances = [...board.balances];
  const index = seats.indexOf(owner);

  if (balance <= 0n) {
    if (index >= 0) {
      seats.splice(index, 1);
      balances.splice(index, 1);
    }
    return { seats, balances };
  }

  if (index >= 0) {
    balances[index] = balance;
  } else if (seats.length < TOP_SEATS) {
    seats.push(owner);
    balances.push(balance);
  } else if (balance > balances[TOP_SEATS - 1]) {
    seats[TOP_SEATS - 1] = owner;
    balances[TOP_SEATS - 1] = balance;
  } else {
    return board;
  }

  // ten entries: an insertion sort is the cheapest fix-up
  const order = seats.map((_, i) => i).sort((a, b) => (balances[b] > balances[a] ? 1 : -1));
  return {
    seats: order.map((i) => seats[i]),
    balances: order.map((i) => balances[i]),
  };
}

export function isSeated(board: TopBoardState, owner: string): boolean {
  return board.seats.includes(owner);
}

export function seatRank(board: TopBoardState, owner: string): number | null {
  const index = board.seats.indexOf(owner);
  return index >= 0 ? index + 1 : null;
}

/** What a single seat receives from a trade's 3% slice. */
export function seatShare(topLamports: bigint, seats: number): bigint {
  if (seats <= 0) return 0n;
  return topLamports / BigInt(Math.min(seats, TOP_SEATS));
}

export function addHolder(registry: string[], owner: string): string[] {
  if (registry.includes(owner) || registry.length >= MAX_HOLDERS) return registry;
  return [...registry, owner];
}

/**
 * A 32 byte digest. A stand-in for `solana_program::hash::hashv` (SHA-256) -
 * deterministic, well mixed, and enough for a local simulation. The chain runs
 * the real thing, and the selection logic below is identical.
 */
export function digest(...parts: (string | Uint8Array | number)[]): Uint8Array {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  let h3 = 0x9e3779b9;
  let h4 = 0x85ebca6b;
  for (const part of parts) {
    const bytes =
      typeof part === 'string'
        ? new TextEncoder().encode(part)
        : typeof part === 'number'
          ? new TextEncoder().encode(String(part))
          : part;
    for (const byte of bytes) {
      h1 = Math.imul(h1 ^ byte, 0x01000193) >>> 0;
      h2 = Math.imul(h2 + byte + 0x9e3779b9, 0x85ebca6b) >>> 0;
      h3 = Math.imul(h3 ^ (byte + h1), 0xc2b2ae35) >>> 0;
      h4 = Math.imul(h4 + (byte ^ h2), 0x27d4eb2f) >>> 0;
    }
  }
  const out = new Uint8Array(32);
  const view = new DataView(out.buffer);
  view.setUint32(0, h1);
  view.setUint32(4, h2);
  view.setUint32(8, h3);
  view.setUint32(12, h4);
  for (let i = 4; i < 8; i++) {
    h1 = Math.imul(h1 ^ h1 >>> 15, 0x2545f491) >>> 0;
    h2 = Math.imul(h2 ^ h2 >>> 13, 0x9e3779b9) >>> 0;
    h3 = Math.imul(h3 ^ h3 >>> 16, 0x85ebca6b) >>> 0;
    h4 = Math.imul(h4 ^ h4 >>> 14, 0xc2b2ae35) >>> 0;
    view.setUint32(i * 4, h1 ^ h2 ^ h3 ^ h4);
  }
  return out;
}

export function digestToTicket(digestBytes: Uint8Array, poolSize: number): number {
  if (poolSize <= 0) return 0;
  const view = new DataView(digestBytes.buffer, digestBytes.byteOffset, digestBytes.byteLength);
  const head = view.getBigUint64(0, true);
  return Number(head % BigInt(poolSize));
}

/** Pick `DRAW_WINNERS` distinct wallets out of the registry. */
export function drawWinners(registry: string[], commitment: Uint8Array, entropy: Uint8Array): string[] {
  if (registry.length === 0) return [];
  const winners: string[] = [];
  let seed = 0;
  while (winners.length < DRAW_WINNERS && seed < DRAW_WINNERS * 64) {
    const index = digestToTicket(digest(commitment, entropy, seed), registry.length);
    const candidate = registry[index];
    if (!winners.includes(candidate)) winners.push(candidate);
    seed += 1;
  }
  return winners;
}

export function commitmentFor(seed: string, index: number, targetSlot: number): Uint8Array {
  return digest(seed, index, targetSlot);
}
