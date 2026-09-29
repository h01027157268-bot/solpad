'use client';

import { Pill, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { useLive, usd, type LivePool } from '@/lib/live';
import { fmtAgo } from '@/lib/format';
import { ArrowUpRight, Radio } from 'lucide-react';
import Link from 'next/link';

/**
 * What is actually launching on Solana mainnet right now.
 *
 * This is real data (GeckoTerminal's new-pools feed), shown next to the
 * launchpad's own curves so the app is useful before a program is deployed. The
 * cards link out to the DEX, because these tokens are not ours to trade.
 */
export function LiveBoard() {
  const { data, error, loading, refresh } = useLive();

  if (loading && !data) {
    return (
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-40" />
        ))}
      </div>
    );
  }

  if (!data || data.pools.length === 0) {
    return (
      <div className="mt-6 rounded-2xl border border-dashed border-white/10 bg-white/[0.01] p-8 text-center">
        <p className="text-sm font-extralight text-slate-400">
          The live feed is not reachable right now.
        </p>
        <p className="mt-1 text-[10px] font-extralight text-slate-600">
          {error ?? 'geckoterminal returned no pools'}
        </p>
        <button type="button" onClick={refresh} className="btn-quiet mt-4">
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-white/[0.05] py-3">
        <span className="flex items-center gap-1.5 text-[10px] font-light uppercase tracking-widest text-[#c8f7d4]">
          <Radio size={11} /> live  solana mainnet
        </span>
        <span className="text-[11px] font-extralight tabular-nums text-slate-300">
          SOL {data.solPrice > 0 ? `$${data.solPrice.toFixed(2)}` : ''}
        </span>
        <span className="text-[10px] font-extralight uppercase tracking-widest text-slate-600">
          {data.source.price}  refreshed {fmtAgo(data.updatedAt)} ago
        </span>
        <button
          type="button"
          onClick={refresh}
          className="ml-auto text-[10px] font-light uppercase tracking-widest text-slate-500 transition-colors hover:text-white"
        >
          refresh
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {data.pools.map((pool) => (
          <LiveCard key={pool.address} pool={pool} now={data.updatedAt} />
        ))}
      </div>

      <p className="mt-4 text-[10px] font-extralight leading-relaxed text-slate-600">
        These are the newest pools on Solana mainnet, read live from GeckoTerminal -
        not launches from this platform. Cards open the pair on DexScreener. The
        curves above are this launchpad&apos;s own.
      </p>
    </>
  );
}

function LiveCard({ pool, now }: { pool: LivePool; now: number }) {
  const up = pool.change1h >= 0;
  return (
    <Link
      href={`https://dexscreener.com/solana/${pool.address}`}
      target="_blank"
      rel="noreferrer"
      className="group flex h-40 flex-col justify-between rounded-2xl border border-white/[0.05] bg-white/[0.02] p-4 transition-colors hover:border-white/20"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-extralight text-white">${pool.symbol}</p>
          <p className="truncate text-[10px] font-light uppercase tracking-widest text-slate-500">
            {pool.dex}
          </p>
        </div>
        <Pill tone={up ? 'up' : 'down'}>
          {up ? '+' : ''}
          {pool.change1h.toFixed(1)}%
        </Pill>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Cell label="Price" value={usd(pool.priceUsd)} />
        <Cell label="FDV" value={usd(pool.fdvUsd)} />
        <Cell label="Liquidity" value={usd(pool.liquidityUsd)} />
        <Cell label="Volume 24h" value={usd(pool.volume24hUsd)} />
      </div>

      <div className="flex items-center justify-between text-[10px] font-extralight uppercase tracking-widest text-slate-600">
        <span>{pool.createdAt ? `${fmtAgo(pool.createdAt)} ago` : 'just now'}</span>
        <span className="flex items-center gap-1 transition-colors group-hover:text-white">
          dexscreener <ArrowUpRight size={10} />
        </span>
      </div>
      <span className="hidden">{now}</span>
    </Link>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn('min-w-0')}>
      <p className="text-[9px] font-light uppercase tracking-widest text-slate-600">{label}</p>
      <p className="truncate text-[11px] font-extralight tabular-nums text-slate-300">{value}</p>
    </div>
  );
}
