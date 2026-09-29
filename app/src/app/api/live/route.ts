/**
 * Live Solana market data.
 *
 * Everything here is real: the SOL price comes from Binance, the pools come
 * from GeckoTerminal's "new pools" feed on Solana mainnet. It is fetched on the
 * server (no CORS, no keys) and cached for 30 seconds so the page can poll it
 * without hammering the upstreams.
 *
 *   GET /api/live
 *   {
 *     solPrice: 187.42,
 *     source: { price: 'binance', pools: 'geckoterminal' },
 *     updatedAt: 1769000000,
 *     pools: [{ address, name, symbol, baseMint, dex, priceUsd, fdvUsd, liquidityUsd, volume24hUsd, createdAt, change1h }]
 *   }
 */

import { NextResponse } from 'next/server';

export const revalidate = 30;

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

interface Cache {
  at: number;
  solPrice: number;
  priceSource: string;
  pools: LivePool[];
  poolSource: string;
}

const TTL_MS = 30_000;
let cache: Cache | null = null;

async function json<T>(url: string, ms = 8_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Binance first (no key, very reliable), CoinGecko as a fallback. */
async function fetchSolPrice(): Promise<{ price: number; source: string }> {
  try {
    const binance = await json<{ price: string }>(
      'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT',
    );
    const price = Number(binance.price);
    if (Number.isFinite(price) && price > 0) return { price, source: 'binance' };
  } catch {
    /* try the next one */
  }
  try {
    const gecko = await json<{ solana: { usd: number } }>(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
    );
    const price = gecko.solana?.usd;
    if (Number.isFinite(price) && price > 0) return { price: price as number, source: 'coingecko' };
  } catch {
    /* fall through */
  }
  return { price: 0, source: 'unavailable' };
}

interface GeckoPool {
  id: string;
  attributes: {
    name: string;
    address: string;
    base_token_price_usd: string;
    fdv_usd: string;
    market_cap_usd: string | null;
    reserve_in_usd: string;
    pool_created_at: string;
    price_change_percentage?: { h1?: string };
    volume_usd?: { h24?: string };
    base_token_price_native_currency?: string;
  };
  relationships?: { base_token?: { data?: { id?: string } }; dex?: { data?: { id?: string } } };
}

/** The newest Solana pools - i.e. what is actually launching on mainnet right now. */
async function fetchNewPools(): Promise<{ pools: LivePool[]; source: string }> {
  try {
    const data = await json<{ data: GeckoPool[] }>(
      'https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1',
    );
    const pools = (data.data ?? [])
      .map((entry) => {
        const a = entry.attributes;
        const baseId = entry.relationships?.base_token?.data?.id ?? '';
        const baseMint = baseId.includes('_') ? baseId.split('_')[1] : '';
        const symbol = a.name.includes('/') ? a.name.split('/')[0].trim() : a.name.trim();
        return {
          address: a.address,
          name: a.name,
          symbol,
          baseMint,
          dex: entry.relationships?.dex?.data?.id ?? 'unknown',
          priceUsd: Number(a.base_token_price_usd) || 0,
          fdvUsd: Number(a.fdv_usd) || 0,
          liquidityUsd: Number(a.reserve_in_usd) || 0,
          volume24hUsd: Number(a.volume_usd?.h24 ?? 0) || 0,
          createdAt: a.pool_created_at ? Math.floor(new Date(a.pool_created_at).getTime() / 1000) : 0,
          change1h: Number(a.price_change_percentage?.h1 ?? 0) || 0,
        } satisfies LivePool;
      })
      .filter((pool) => pool.address && pool.liquidityUsd > 0)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 24);
    return { pools, source: 'geckoterminal' };
  } catch {
    return { pools: [], source: 'unavailable' };
  }
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) {
    return NextResponse.json(toPayload(cache));
  }

  const [price, pools] = await Promise.all([fetchSolPrice(), fetchNewPools()]);
  cache = {
    at: now,
    // keep the last good price if the upstream is briefly down
    solPrice: price.price > 0 ? price.price : cache?.solPrice ?? 0,
    priceSource: price.source,
    pools: pools.pools.length > 0 ? pools.pools : cache?.pools ?? [],
    poolSource: pools.source,
  };
  return NextResponse.json(toPayload(cache));
}

function toPayload(entry: Cache) {
  return {
    solPrice: entry.solPrice,
    updatedAt: Math.floor(entry.at / 1000),
    source: { price: entry.priceSource, pools: entry.poolSource },
    pools: entry.pools,
  };
}
