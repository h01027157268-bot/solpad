'use client';

/**
 * App store.
 *
 * Real data only. The board is filled by `syncChain()`, which reads the
 * deployed program; the SOL price and the mainnet feed come from `/api/live`.
 * There is no local sandbox state and no simulated trading: if the program is
 * not deployed on the configured cluster, every action is refused with an
 * explanation instead of pretending.
 */

import { AnchorProvider, Program, type Idl } from '@coral-xyz/anchor';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { create } from 'zustand';
import { RPC_URL } from '@/lib/const';
import {
  buyIx,
  claimDividendsIx,
  closeRoundIx,
  createLaunchIx,
  fetchAllLaunches,
  idl,
  migrateIx,
  resolveRoundIx,
  sellIx,
} from '@/lib/solana/client';
import { Market } from './market';
import type { CreateLaunchInput, LaunchState } from './types';

export interface Session {
  address: string;
  label: string;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'error' | 'info';
}

export interface ChainWallet {
  publicKey: { toBase58(): string } | null;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  signTransaction?: (tx: any) => Promise<any>;
  signAllTransactions?: (txs: any[]) => Promise<any[]>;
}

interface StoreState {
  version: number;
  /** Read-only container: only `syncChain()` ever writes to it. */
  market: Market;
  session: Session | null;
  toasts: Toast[];
  hydrated: boolean;
  connection: Connection | null;
  program: Program | null;
  lastSyncedAt: number;
  syncing: boolean;
  setSession: (session: Session | null) => void;
  attachWallet: (wallet: ChainWallet | null) => void;
  syncChain: () => Promise<void>;
  hydrate: () => void;
  buy: (mint: string, lamports: bigint) => void;
  sell: (mint: string, tokens: bigint) => void;
  claim: (mint: string) => void;
  draw: (mint: string) => void;
  closeRound: (mint: string) => void;
  migrate: (mint: string) => void;
  create: (input: CreateLaunchInput) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  dismiss: (id: number) => void;
}

const SESSION_KEY = 'solpad.session.v2';
const NOT_DEPLOYED = 'The launchpad program is not deployed on this cluster yet.';
let toastSeq = 0;

export const useStore = create<StoreState>((set, get) => ({
  version: 0,
  market: new Market(),
  session: null,
  toasts: [],
  hydrated: false,
  connection: null,
  program: null,
  lastSyncedAt: 0,
  syncing: false,

  setSession: (session) => {
    if (typeof window !== 'undefined') {
      if (session) window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else window.localStorage.removeItem(SESSION_KEY);
    }
    set({ session });
  },

  attachWallet: (wallet) => {
    if (!wallet?.publicKey) {
      set({ connection: null, program: null });
      return;
    }
    const connection = new Connection(RPC_URL, 'confirmed');
    const provider = new AnchorProvider(
      connection,
      {
        publicKey: wallet.publicKey as never,
        signTransaction: (wallet.signTransaction ?? (async (tx: unknown) => tx)) as never,
        signAllTransactions: wallet.signAllTransactions as never,
      },
      { commitment: 'confirmed' },
    );
    set({ connection, program: new Program(idl as Idl, provider) });
    void get().syncChain();
  },

  /** Replaces the board with what the program actually holds. */
  syncChain: async () => {
    const { program, market } = get();
    if (!program || get().syncing) return;
    set({ syncing: true });
    try {
      const launches = await fetchAllLaunches(program);
      market.launches = new Map(launches.map((launch) => [launch.mint, launch]));
      set((state) => ({
        version: state.version + 1,
        lastSyncedAt: Math.floor(Date.now() / 1000),
      }));
    } catch (error) {
      get().toast(`Could not read the program: ${message(error)}`, 'error');
    } finally {
      set({ syncing: false });
    }
  },

  hydrate: () => {
    if (get().hydrated) return;
    let session: Session | null = null;
    if (typeof window !== 'undefined') {
      const raw = window.localStorage.getItem(SESSION_KEY);
      if (raw) {
        try {
          session = JSON.parse(raw) as Session;
        } catch {
          session = null;
        }
      }
    }
    set((state) => ({ version: state.version + 1, hydrated: true, session }));
  },

  buy: (mint, lamports) => {
    const { program, session } = get();
    if (!session) return get().toast('Connect a wallet first.', 'error');
    if (!program) return get().toast(NOT_DEPLOYED, 'error');
    void chainRun(get, (p, owner) => buyIx(p, new PublicKey(mint), owner, lamports, 0n));
  },

  sell: (mint, tokens) => {
    const { program, session } = get();
    if (!session) return get().toast('Connect a wallet first.', 'error');
    if (!program) return get().toast(NOT_DEPLOYED, 'error');
    void chainRun(get, (p, owner) =>
      sellIx(p, new PublicKey(mint), owner, tokens, (tokens * 97n) / 100n),
    );
  },

  claim: (mint) => {
    const { program, session } = get();
    if (!session) return get().toast('Connect a wallet first.', 'error');
    if (!program) return get().toast(NOT_DEPLOYED, 'error');
    void chainRun(get, (p, owner) => claimDividendsIx(p, new PublicKey(mint), owner));
  },

  draw: (mint) => {
    const { program, session } = get();
    if (!session) return get().toast('Connect a wallet first.', 'error');
    if (!program) return get().toast(NOT_DEPLOYED, 'error');
    void chainRun(get, (p, owner) => resolveRoundIx(p, new PublicKey(mint), owner));
  },

  closeRound: (mint) => {
    const { program, session } = get();
    if (!session) return get().toast('Connect a wallet first.', 'error');
    if (!program) return get().toast(NOT_DEPLOYED, 'error');
    void chainRun(get, (p, owner) => closeRoundIx(p, new PublicKey(mint), owner));
  },

  migrate: (mint) => {
    const { program, session } = get();
    if (!session) return get().toast('Connect a wallet first.', 'error');
    if (!program) return get().toast(NOT_DEPLOYED, 'error');
    void chainRun(get, (p, owner) => migrateIx(p, new PublicKey(mint), owner));
  },

  create: (input) => {
    const { program, session } = get();
    if (!session) return get().toast('Connect a wallet first.', 'error');
    if (!program) return get().toast(NOT_DEPLOYED, 'error');
    void chainCreate(get, input);
  },

  toast: (text, tone = 'info') => {
    const id = ++toastSeq;
    set((state) => ({ toasts: [...state.toasts, { id, text, tone }].slice(-4) }));
    if (typeof window !== 'undefined') {
      window.setTimeout(() => get().dismiss(id), 5_000);
    }
  },

  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

type Getter = () => StoreState;

async function chainRun(
  get: Getter,
  build: (program: Program, owner: PublicKey) => Promise<unknown>,
): Promise<string | null> {
  const { program, session, toast } = get();
  if (!program || !session) return null;
  try {
    const owner = new PublicKey(session.address);
    const instruction = (await build(program, owner)) as never;
    const signature = await program.provider.sendAndConfirm!(
      new Transaction().add(instruction),
      [],
      { commitment: 'confirmed' },
    );
    toast(`Confirmed  ${signature.slice(0, 8)}`, 'ok');
    await get().syncChain();
    return signature;
  } catch (error) {
    toast(message(error), 'error');
    return null;
  }
}

async function chainCreate(get: Getter, input: CreateLaunchInput): Promise<void> {
  const { program, session, toast } = get();
  if (!program || !session) return;
  try {
    const owner = new PublicKey(session.address);
    const { instruction, mint } = await createLaunchIx(program, owner, {
      mode: input.mode,
      name: input.name.slice(0, 32),
      symbol: input.symbol.slice(0, 10),
      uri: (input.imageUrl ?? '').slice(0, 200),
    });
    const instructions: never[] = [instruction as never];
    if (input.devBuyLamports > 0n) {
      instructions.push((await buyIx(program, mint, owner, input.devBuyLamports, 0n)) as never);
    }
    const signature = await program.provider.sendAndConfirm!(
      new Transaction().add(...instructions),
      [],
      { commitment: 'confirmed' },
    );
    toast(`Launched ${input.symbol}  ${signature.slice(0, 8)}`, 'ok');
    await get().syncChain();
    if (typeof window !== 'undefined') window.location.href = `/token/${mint.toBase58()}`;
  } catch (error) {
    toast(message(error), 'error');
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
