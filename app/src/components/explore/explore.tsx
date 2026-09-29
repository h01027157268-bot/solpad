'use client';

import { LiveBoard } from '@/components/explore/live-board';
import { TokenCard } from '@/components/explore/token-card';
import { ClientOnly, Eyebrow, Pill, Skeleton } from '@/components/ui/primitives';
import { SOL_PRICE_USD } from '@/lib/const';
import { useStore } from '@/lib/data/store';
import { graduationProgressBps } from '@/lib/engine';
import { fmtSol, fmtUsd } from '@/lib/format';
import { ArrowUpRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

type FilterKind = 'live' | 'trending' | 'new' | 'graduating' | 'graduated';
type Source = 'pad' | 'mainnet';

const FILTERS: { key: FilterKind; label: string }[] = [
  { key: 'live', label: 'Live' },
  { key: 'trending', label: 'Trending' },
  { key: 'new', label: 'New' },
  { key: 'graduating', label: 'Near graduation' },
  { key: 'graduated', label: 'Graduated' },
];

export default function ExplorePage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-24 pt-8 md:px-6">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <Eyebrow>Explore</Eyebrow>
          <h1 className="mt-2 text-3xl font-thin uppercase tracking-tight text-white md:text-4xl">
            On the curve
          </h1>
          <p className="mt-3 max-w-xl text-sm font-extralight leading-relaxed text-slate-500">
            Every launch mints its whole supply onto a pump.fun curve. No presale, no
            allocation, no team wallet. Taxes are taken by the program on every trade and
            split the way the creator chose at launch.
          </p>
        </div>
        <Link href="/create" className="btn-ghost">
          <Plus size={13} /> Launch a token
        </Link>
      </div>

      <ClientOnly
        fallback={
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-52" />
            ))}
          </div>
        }
      >
        <SourceSwitch />
      </ClientOnly>
    </div>
  );
}

function SourceSwitch() {
  const [source, setSource] = useState<Source>('pad');
  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Pill active={source === 'pad'} onClick={() => setSource('pad')}>
          this launchpad
        </Pill>
        <Pill active={source === 'mainnet'} onClick={() => setSource('mainnet')}>
          live  solana mainnet
        </Pill>
      </div>
      {source === 'mainnet' ? <LiveBoard /> : <Board />}
    </>
  );
}

function Board() {
  const version = useStore((s) => s.version);
  const market = useStore((s) => s.market);
  const [filter, setFilter] = useState<FilterKind>('live');

  const board = useMemo(() => {
    const all = market.list();
    const now = Math.floor(Date.now() / 1000);
    const filtered = all.filter((launch) => {
      const progress = graduationProgressBps(launch.realSol, launch.graduationLamports);
      switch (filter) {
        case 'live':
          return launch.status === 'bonding';
        case 'trending':
          return launch.status === 'bonding' && launch.volumeLamports > 0n;
        case 'new':
          return now - launch.createdAt < 6 * 3_600;
        case 'graduating':
          return launch.status === 'bonding' && progress >= 7_000;
        case 'graduated':
          return launch.status === 'migrated';
      }
    });
    const sorted = [...filtered].sort((a, b) => {
      if (filter === 'new') return b.createdAt - a.createdAt;
      if (filter === 'trending') return Number(b.volumeLamports - a.volumeLamports);
      if (filter === 'graduating')
        return (
          graduationProgressBps(b.realSol, b.graduationLamports) -
          graduationProgressBps(a.realSol, a.graduationLamports)
        );
      return Number(b.marketCapLamports - a.marketCapLamports);
    });
    const volume = all.reduce((sum, l) => sum + l.volumeLamports, 0n);
    const raised = all.reduce((sum, l) => sum + l.realSol, 0n);
    const liquidity = all.reduce((sum, l) => sum + (l.pool?.solReserves ?? 0n), 0n);
    return { sorted, now, volume, raised, liquidity, total: all.length };
  }, [market, version, filter]);

  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-4 border-y border-white/[0.05] py-4 md:grid-cols-4">
        <Metric label="Tokens launched" value={String(board.total)} />
        <Metric
          label="Volume (all time)"
          value={fmtUsd(board.volume, SOL_PRICE_USD)}
          sub={`${fmtSol(board.volume)} SOL`}
        />
        <Metric
          label="On the curves"
          value={`${fmtSol(board.raised)} SOL`}
          sub={fmtUsd(board.raised, SOL_PRICE_USD)}
        />
        <Metric
          label="Locked in pools"
          value={`${fmtSol(board.liquidity)} SOL`}
          sub="LP held by the launch PDA"
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {FILTERS.map((item) => (
          <Pill key={item.key} active={filter === item.key} onClick={() => setFilter(item.key)}>
            {item.label}
          </Pill>
        ))}
      </div>

      {board.sorted.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-white/10 bg-white/[0.01] p-10 text-center">
          <p className="text-sm font-extralight text-slate-400">Nothing here yet.</p>
          <Link href="/create" className="btn-ghost mt-4">
            <Plus size={13} /> Be the first curve
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {board.sorted.map((launch) => (
            <TokenCard key={launch.mint} launch={launch} now={board.now} />
          ))}
          {filter === 'live' ? <LaunchCta /> : null}
        </div>
      )}
    </>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="label-xs">{label}</p>
      <p className="mt-1 text-lg font-thin tabular-nums text-white">{value}</p>
      {sub ? <p className="mt-0.5 text-[10px] font-extralight text-slate-600">{sub}</p> : null}
    </div>
  );
}

function LaunchCta() {
  return (
    <Link
      href="/create"
      className="group flex h-52 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.01] transition-colors hover:border-white/30"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-white/70 transition-colors group-hover:border-white/40 group-hover:text-white">
        <Plus size={16} />
      </span>
      <span className="text-[11px] font-light uppercase tracking-widest text-slate-400 group-hover:text-white">
        Launch a token
      </span>
      <span className="flex items-center gap-1 text-[10px] font-extralight uppercase tracking-widest text-slate-600">
        Dividends or lottery <ArrowUpRight size={11} />
      </span>
    </Link>
  );
}

