'use client';

/**
 * Polls the server's live market feed (`/api/live`), which proxies real Solana
 * mainnet data: the SOL price and the newest pools on the network.
 *
 * The launchpad's own economics still run on the program (or on the offline
 * mirror when no program id is configured) - this hook is the bridge to the real
 * world, so the app quotes real prices and shows what is actually launching.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface LivePool {
  address: string;
  name: string;
  symbol: string;
  baseMint: string;
  dex: string;
  priceUsd: number;
  fdvUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  createdAt: number;
  change1h: number;
}

export interface LiveData {
  solPrice: number;
  updatedAt: number;
  source: { price: string; pools: string };
  pools: LivePool[];
}

const REFRESH_MS = 30_000;

export function useLive(): { data: LiveData | null; error: string | null; loading: boolean; refresh: () => void } {
  const [data, setData] = useState<LiveData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/live', { cache: 'no-store' });
      if (!response.ok) throw new Error(`live feed ${response.status}`);
      const payload = (await response.json()) as LiveData;
      if (!mounted.current) return;
      setData(payload);
      setError(null);
    } catch (issue) {
      if (!mounted.current) return;
      setError(issue instanceof Error ? issue.message : String(issue));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void load();
    }, REFRESH_MS);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, [load]);

  return { data, error, loading, refresh: load };
}

/** USD formatting that never shows a misleading $0 for tiny caps. */
export function usd(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '$0';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toPrecision(3)}`;
}
