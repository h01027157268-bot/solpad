/**
 * Chain client.
 *
 * The app runs on the offline mirror market until `NEXT_PUBLIC_PROGRAM_ID` is
 * set (see `lib/const.ts`). This module is the switch: it turns the same UI
 * state into Anchor calls against a deployed program.
 *
 * `idl.json` is generated from the program source by `scripts/gen-idl.mjs` and
 * cross-checked against `programs/launchpad/src/state.rs`, so the layouts here
 * cannot silently drift. After `anchor build` you can overwrite it with
 * `target/idl/launchpad.json` - they describe the same program.
 */

import { AnchorProvider, BN, Program, type Idl } from '@coral-xyz/anchor';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_SLOT_HASHES_PUBKEY,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';

import { PROGRAM_ID } from '../const';
import type { LaunchState } from '../data/types';
import idlJson from './idl.json';

export const idl = idlJson as unknown as Idl;

export const SEEDS = {
  config: Buffer.from('config'),
  launch: Buffer.from('launch'),
  mint: Buffer.from('mint'),
  curveVault: Buffer.from('curve_vault'),
  poolReserve: Buffer.from('pool_reserve'),
  solVault: Buffer.from('sol_vault'),
  dividendVault: Buffer.from('dividend_vault'),
  drawVault: Buffer.from('draw_vault'),
  topBoard: Buffer.from('top_board'),
  registry: Buffer.from('holder_registry'),
  round: Buffer.from('round'),
  position: Buffer.from('position'),
  pool: Buffer.from('pool'),
  poolSol: Buffer.from('pool_sol'),
  poolTokens: Buffer.from('pool_tokens'),
  lpMint: Buffer.from('lp_mint'),
  lpLock: Buffer.from('lp_lock'),
} as const;

export function programId(): PublicKey {
  return new PublicKey(PROGRAM_ID);
}

export function getProgram(connection: Connection, wallet: unknown): Program {
  const provider = new AnchorProvider(connection, wallet as never, { commitment: 'confirmed' });
  return new Program(idl, provider);
}

export function pda(seed: Buffer, ...rest: (PublicKey | Buffer | Uint8Array)[]): PublicKey {
  return PublicKey.findProgramAddressSync(
    [seed, ...rest.map((item) => (item instanceof PublicKey ? item.toBuffer() : Buffer.from(item)))],
    programId(),
  )[0];
}

export const configPda = () => pda(SEEDS.config);
export const launchPda = (mint: PublicKey) => pda(SEEDS.launch, mint);
export const curveVaultPda = (launch: PublicKey) => pda(SEEDS.curveVault, launch);
export const poolReservePda = (launch: PublicKey) => pda(SEEDS.poolReserve, launch);
export const solVaultPda = (launch: PublicKey) => pda(SEEDS.solVault, launch);
export const dividendVaultPda = (launch: PublicKey) => pda(SEEDS.dividendVault, launch);
export const drawVaultPda = (launch: PublicKey) => pda(SEEDS.drawVault, launch);
export const topBoardPda = (launch: PublicKey) => pda(SEEDS.topBoard, launch);
export const registryPda = (launch: PublicKey) => pda(SEEDS.registry, launch);
export const roundPda = (launch: PublicKey) => pda(SEEDS.round, launch);
export const positionPda = (launch: PublicKey, owner: PublicKey) =>
  pda(SEEDS.position, launch, owner);
export const poolPda = (launch: PublicKey) => pda(SEEDS.pool, launch);
export const poolSolPda = (launch: PublicKey) => pda(SEEDS.poolSol, launch);
export const poolTokensPda = (launch: PublicKey) => pda(SEEDS.poolTokens, launch);
export const lpMintPda = (launch: PublicKey) => pda(SEEDS.lpMint, launch);
export const lpLockPda = (launch: PublicKey) => pda(SEEDS.lpLock, launch);

/** The mint of the `nth` launch of `creator`, exactly as `create_launch` derives it. */
export function mintPda(creator: PublicKey, launchIndex: number | bigint): PublicKey {
  const nonce = Buffer.alloc(8);
  nonce.writeBigUInt64LE(BigInt(launchIndex));
  return pda(SEEDS.mint, creator, nonce);
}

export const ata = (mint: PublicKey, owner: PublicKey) =>
  getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

/** The ten seats, in board order, as Anchor optional accounts. */
export function seatAccounts(seats: PublicKey[]): Record<string, PublicKey | null> {
  const accounts: Record<string, PublicKey | null> = {};
  for (let i = 0; i < 10; i++) accounts[`seat${i}`] = seats[i] ?? null;
  return accounts;
}

/** The ten winners a draw produces, in the order the draw gives them. */
export function winnerAccounts(winners: PublicKey[]): Record<string, PublicKey | null> {
  const accounts: Record<string, PublicKey | null> = {};
  for (let i = 0; i < 10; i++) accounts[`winner${i}`] = winners[i] ?? null;
  return accounts;
}

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

interface AccountNamespace {
  launch: { all(): Promise<{ publicKey: PublicKey; account: unknown }[]> };
}

export async function fetchAllLaunches(program: Program): Promise<LaunchState[]> {
  const namespace = program.account as unknown as AccountNamespace;
  const accounts = await namespace.launch.all();
  return accounts.map(({ publicKey, account }) => decodeLaunch(publicKey, account as RawLaunch));
}

export async function fetchLaunch(program: Program, mint: PublicKey): Promise<LaunchState | null> {
  const info = await program.provider.connection.getAccountInfo(launchPda(mint));
  if (!info) return null;
  const account = program.coder.accounts.decode('launch', info.data);
  return decodeLaunch(launchPda(mint), account as RawLaunch);
}

export interface RawConfig {
  authority: PublicKey;
  treasury: PublicKey;
  creationFeeLamports: BN;
  totalLaunches: BN;
}

export async function fetchConfig(program: Program): Promise<RawConfig | null> {
  const info = await program.provider.connection.getAccountInfo(configPda());
  if (!info) return null;
  return program.coder.accounts.decode('config', info.data) as unknown as RawConfig;
}

interface RawLaunch {
  creator: PublicKey;
  mint: PublicKey;
  mode: Record<string, unknown>;
  status: Record<string, unknown>;
  createdAt: BN;
  name: string;
  symbol: string;
  uri: string;
  buyTaxBps: number;
  sellTaxBps: number;
  vaultBps: number;
  dividendBps: number;
  topBps: number;
  drawBps: number;
  virtualSolReserves: BN;
  virtualTokenReserves: BN;
  realSolReserves: BN;
  realTokenReserves: BN;
  totalSupply: BN;
  poolReserve: BN;
  graduationLamports: BN;
  marketCapLamports: BN;
  trades: BN;
  buys: BN;
  sells: BN;
  volumeLamports: BN;
  positions: BN;
  migratedAt: BN;
  dividendAcc: BN;
  dividendDistributed: BN;
  dividendClaimed: BN;
  round: BN;
  topDistributed: BN;
  drawDistributed: BN;
}

const enumKey = (value: Record<string, unknown>): string => Object.keys(value)[0] ?? 'unknown';

function decodeLaunch(address: PublicKey, raw: RawLaunch): LaunchState {
  return {
    mint: address.toBase58(),
    creator: raw.creator.toBase58(),
    mode: enumKey(raw.mode) as LaunchState['mode'],
    status: enumKey(raw.status) as LaunchState['status'],
    name: raw.name,
    symbol: raw.symbol,
    uri: raw.uri,
    description: '',
    createdAt: raw.createdAt.toNumber(),
    virtualSol: BigInt(raw.virtualSolReserves.toString()),
    virtualTokens: BigInt(raw.virtualTokenReserves.toString()),
    realSol: BigInt(raw.realSolReserves.toString()),
    realTokens: BigInt(raw.realTokenReserves.toString()),
    totalSupply: BigInt(raw.totalSupply.toString()),
    poolReserve: BigInt(raw.poolReserve.toString()),
    graduationLamports: BigInt(raw.graduationLamports.toString()),
    marketCapLamports: BigInt(raw.marketCapLamports.toString()),
    trades: raw.trades.toNumber(),
    buys: raw.buys.toNumber(),
    sells: raw.sells.toNumber(),
    volumeLamports: BigInt(raw.volumeLamports.toString()),
    positions: raw.positions.toNumber(),
    migratedAt: raw.migratedAt.toNumber(),
    vaultBps: raw.vaultBps,
    topBps: raw.topBps,
    drawBps: raw.drawBps,
    dividendBps: raw.dividendBps,
    dividendAcc: BigInt(raw.dividendAcc.toString()),
    dividendDistributed: BigInt(raw.dividendDistributed.toString()),
    dividendClaimed: BigInt(raw.dividendClaimed.toString()),
    // The board, the registry and the round live in their own accounts; the
    // curve and tax state above is everything a quote needs.
    board: { seats: [], balances: [] },
    registry: [],
    round: {
      index: raw.round.toNumber(),
      pot: 0n,
      volumeLamports: 0n,
      trades: 0,
      openedAtSlot: 0,
      closedAtSlot: 0,
      targetSlot: 0,
      commitment: new Uint8Array(32),
      resolved: false,
      winners: [],
      prize: 0n,
    },
    topDistributed: BigInt(raw.topDistributed.toString()),
    drawDistributed: BigInt(raw.drawDistributed.toString()),
    vaultDistributed: BigInt(raw.drawDistributed.toString()),
    pool: null,
    balances: {},
    dividendPaid: {},
    dividendsClaimed: {},
    seatEarnings: {},
    winnings: {},
    volumeByOwner: {},
    tradeLog: [],
    history: [],
    winners: [],
    nameRegistry: {},
  };
}

// ---------------------------------------------------------------------------
// writes
// ---------------------------------------------------------------------------

export async function buyIx(
  program: Program,
  mint: PublicKey,
  buyer: PublicKey,
  lamports: bigint,
  minTokensOut: bigint,
  seats: PublicKey[] = [],
): Promise<TransactionInstruction> {
  const launch = launchPda(mint);
  return program.methods
    .buy(new BN(lamports.toString()), new BN(minTokensOut.toString()))
    .accounts({
      buyer,
      config: configPda(),
      launch,
      mint,
      buyerToken: ata(mint, buyer),
      curveVault: curveVaultPda(launch),
      solVault: solVaultPda(launch),
      dividendVault: dividendVaultPda(launch),
      drawVault: drawVaultPda(launch),
      topBoard: topBoardPda(launch),
      registry: registryPda(launch),
      round: roundPda(launch),
      position: positionPda(launch, buyer),
      ...seatAccounts(seats),
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export async function sellIx(
  program: Program,
  mint: PublicKey,
  seller: PublicKey,
  tokens: bigint,
  minSolOut: bigint,
  seats: PublicKey[] = [],
): Promise<TransactionInstruction> {
  const launch = launchPda(mint);
  return program.methods
    .sell(new BN(tokens.toString()), new BN(minSolOut.toString()))
    .accounts({
      seller,
      config: configPda(),
      launch,
      mint,
      sellerToken: ata(mint, seller),
      curveVault: curveVaultPda(launch),
      solVault: solVaultPda(launch),
      dividendVault: dividendVaultPda(launch),
      drawVault: drawVaultPda(launch),
      topBoard: topBoardPda(launch),
      registry: registryPda(launch),
      round: roundPda(launch),
      position: positionPda(launch, seller),
      ...seatAccounts(seats),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export async function claimDividendsIx(
  program: Program,
  mint: PublicKey,
  owner: PublicKey,
): Promise<TransactionInstruction> {
  const launch = launchPda(mint);
  return program.methods
    .claimDividends()
    .accounts({
      owner,
      launch,
      mint,
      ownerToken: ata(mint, owner),
      position: positionPda(launch, owner),
      dividendVault: dividendVaultPda(launch),
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export async function swapIx(
  program: Program,
  mint: PublicKey,
  trader: PublicKey,
  direction: 'buy' | 'sell',
  amountIn: bigint,
  minAmountOut: bigint,
  seats: PublicKey[] = [],
): Promise<TransactionInstruction> {
  const launch = launchPda(mint);
  return program.methods
    .swap({ [direction]: {} }, new BN(amountIn.toString()), new BN(minAmountOut.toString()))
    .accounts({
      trader,
      config: configPda(),
      launch,
      mint,
      pool: poolPda(launch),
      poolSol: poolSolPda(launch),
      poolTokens: poolTokensPda(launch),
      traderToken: ata(mint, trader),
      dividendVault: dividendVaultPda(launch),
      drawVault: drawVaultPda(launch),
      topBoard: topBoardPda(launch),
      registry: registryPda(launch),
      round: roundPda(launch),
      position: positionPda(launch, trader),
      ...seatAccounts(seats),
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export async function migrateIx(
  program: Program,
  mint: PublicKey,
  cranker: PublicKey,
): Promise<TransactionInstruction> {
  const launch = launchPda(mint);
  return program.methods
    .migrate()
    .accounts({
      cranker,
      config: configPda(),
      launch,
      mint,
      curveVault: curveVaultPda(launch),
      poolReserve: poolReservePda(launch),
      solVault: solVaultPda(launch),
      pool: poolPda(launch),
      poolSol: poolSolPda(launch),
      poolTokens: poolTokensPda(launch),
      lpMint: lpMintPda(launch),
      lpLock: lpLockPda(launch),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

/** Close a round that has gone quiet (permissionless). */
export async function closeRoundIx(
  program: Program,
  mint: PublicKey,
  cranker: PublicKey,
): Promise<TransactionInstruction> {
  const launch = launchPda(mint);
  return program.methods
    .closeRound()
    .accounts({ cranker, config: configPda(), launch, mint, round: roundPda(launch) })
    .instruction();
}

/**
 * Draw the round's ten winners, pay them and open the next round.
 *
 * The winners are recomputed on-chain, so `winners` only has to be the set the
 * caller expects - a mismatch fails the transaction rather than paying the
 * wrong wallets.
 */
export async function resolveRoundIx(
  program: Program,
  mint: PublicKey,
  cranker: PublicKey,
  winners: PublicKey[] = [],
): Promise<TransactionInstruction> {
  const launch = launchPda(mint);
  return program.methods
    .resolveRound()
    .accounts({
      cranker,
      config: configPda(),
      launch,
      mint,
      round: roundPda(launch),
      registry: registryPda(launch),
      drawVault: drawVaultPda(launch),
      slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
      systemProgram: SystemProgram.programId,
      ...winnerAccounts(winners),
    })
    .instruction();
}

export async function createLaunchIx(
  program: Program,
  creator: PublicKey,
  params: {
    mode: 'dividend' | 'lottery';
    name: string;
    symbol: string;
    uri: string;
    seed?: Uint8Array;
  },
): Promise<{ instruction: TransactionInstruction; mint: PublicKey; launch: PublicKey }> {
  const config = await fetchConfig(program);
  if (!config) throw new Error('The platform config has not been initialised on this cluster.');

  const mint = mintPda(creator, config.totalLaunches.toNumber());
  const launch = launchPda(mint);
  const seed = params.seed ?? new Uint8Array(32);
  if (!params.seed && typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(seed);
  }

  const instruction = await program.methods
    .createLaunch({
      mode: { [params.mode]: {} },
      name: params.name,
      symbol: params.symbol,
      uri: params.uri,
      seed: Array.from(seed),
    })
    .accounts({
      creator,
      config: configPda(),
      treasury: config.treasury,
      launch,
      mint,
      curveVault: curveVaultPda(launch),
      poolReserve: poolReservePda(launch),
      topBoard: topBoardPda(launch),
      registry: registryPda(launch),
      round: roundPda(launch),
      solVault: solVaultPda(launch),
      dividendVault: dividendVaultPda(launch),
      drawVault: drawVaultPda(launch),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  return { instruction, mint, launch };
}

/** Send one or more instructions and wait for the signature. */
export async function send(program: Program, instructions: TransactionInstruction[]) {
  return program.provider.sendAndConfirm!(new Transaction().add(...instructions), [], {
    commitment: 'confirmed',
  });
}

