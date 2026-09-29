'use client';

import { Bar, Pill, Sparkline } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { SOL_PRICE_USD } from '@/lib/const';
import type { LaunchState } from '@/lib/data/types';
import { eligibleSupply, priceE6, graduationProgressBps } from '@/lib/engine';
import { fmtAgo, fmtSol, fmtTokens, fmtUsd } from '@/lib/format';
import { avatarGradient, initials, isRenderableImage } from '@/lib/avatar';
import Link from 'next/link';
import { useState } from 'react';

export function TokenCard({ launch, now }: { launch: LaunchState; now: number }) {
  const progress = graduationProgressBps(launch.realSol, launch.graduationLamports);
  const migrated = launch.status === 'migrated';
  const age = now - launch.createdAt;
  const holders = Object.values(launch.balances).filter((b) => b > 0n).length;
  const price = priceE6(launch.virtualSol, launch.virtualTokens);
  const eligible = eligibleSupply(launch.totalSupply, launch.realTokens, launch.poolReserve);
  const spark = launch.history.slice(-40).map((p) => p.mcap);
  const change =
    spark.length > 1 && spark[0] !== 0
      ? ((spark[spark.length - 1] - spark[0]) / spark[0]) * 100
      : 0;

  return (
    <Link
      href={`/token/${launch.mint}`}
      className="group relative flex h-52 flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.05] bg-white/[0.02] p-4 transition-colors hover:border-white/20"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-[0.14] blur-2xl transition-opacity group-hover:opacity-25"
        style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.55), transparent 70%)' }}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-extralight text-white">{launch.name}</p>
            <p className="truncate text-[10px] font-light uppercase tracking-widest text-slate-500">
              ${launch.symbol}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Pill tone="accent">{launch.mode === 'dividend' ? 'dividend 5%' : 'lottery 10%'}</Pill>
          {migrated ? <Pill>graduated</Pill> : null}
        </div>
      </div>

      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="label-xs">market cap</p>
          <p className="mt-0.5 truncate text-lg font-thin tabular-nums text-white">
            {fmtUsd(launch.marketCapLamports, SOL_PRICE_USD)}
          </p>
          <p
            className={cn(
              'mt-0.5 text-[10px] font-extralight tabular-nums',
              change >= 0 ? 'text-[#c8f7d4]' : 'text-[#ffa2ae]',
            )}
          >
            {change >= 0 ? '+' : ''}
            {change.toFixed(1)}%  {price.toLocaleString('en-US')} lamports
          </p>
        </div>
        <div className="w-28 shrink-0">
          <Sparkline points={spark} positive={change >= 0} />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-[10px] font-extralight uppercase tracking-widest text-slate-500">
          <span>{migrated ? 'pool locked' : `${(progress / 100).toFixed(1)}% to graduation`}</span>
          <span className="tabular-nums">
            {fmtSol(launch.realSol)} / {fmtSol(launch.graduationLamports)} SOL
          </span>
        </div>
        <Bar value={progress / 100} />
        <div className="flex items-center justify-between gap-2 pt-0.5 text-[10px] font-extralight uppercase tracking-widest text-slate-600">
          <span>{holders} holders</span>
          <span>{fmtTokens(eligible)} circulating</span>
          <span>{age > 0 ? `${fmtAgo(launch.createdAt)} ago` : 'now'}</span>
        </div>
      </div>
    </Link>
  );
}

export function Avatar({
  launch,
  size = 34,
  rounded = 'rounded-lg',
}: {
  launch: Pick<LaunchState, 'mint' | 'symbol' | 'imageUrl' | 'uri'>;
  size?: number;
  rounded?: string;
}) {
  const [failed, setFailed] = useState(false);
  const candidate = launch.imageUrl || launch.uri || '';
  const showImage = !failed && isRenderableImage(candidate);
  return (
    <span
      className={`relative flex shrink-0 items-center justify-center overflow-hidden border border-white/10 ${rounded}`}
      style={{ width: size, height: size, background: avatarGradient(launch.mint || launch.symbol) }}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={candidate}
          alt={launch.symbol || 'token'}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span
          className="font-light uppercase tracking-widest text-white/85"
          style={{ fontSize: Math.max(9, size * 0.32) }}
        >
          {initials(launch.symbol)}
        </span>
      )}
    </span>
  );
}

