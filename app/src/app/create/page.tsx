'use client';

import { ImagePicker, type PickedImage } from '@/components/ui/image-picker';
import { ClientOnly, Eyebrow, FieldLabel, Pill, Stat } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { SOL_PRICE_USD } from '@/lib/const';
import { creationCosts } from '@/lib/create-costs';
import { useStore } from '@/lib/data/store';
import type { CreateLaunchInput } from '@/lib/data/types';
import {
  CURVE_SUPPLY,
  DEFAULT_CREATION_FEE_LAMPORTS,
  DIVIDEND_MODE_DIVIDEND_BPS,
  DIVIDEND_MODE_TAX_BPS,
  GRADUATION_LAMPORTS,
  DRAW_SHARE_BPS,
  LOTTERY_MODE_TAX_BPS,
  TOP_SHARE_BPS,
  POOL_RESERVE,
  TOTAL_SUPPLY,
  VIRTUAL_SOL_RESERVES,
  VIRTUAL_TOKEN_RESERVES,
  VAULT_BPS,
  describeTaxes,
  marketCapLamports,
  type LaunchMode,
} from '@/lib/engine';
import { avatarGradient, initials, isRenderableImage } from '@/lib/avatar';
import { fmtSol, fmtTokens, fmtUsd } from '@/lib/format';
import { CheckCircle2, Info, Rocket } from 'lucide-react';
import { useMemo, useState } from 'react';

const LAUNCH_MC = marketCapLamports(BigInt(VIRTUAL_SOL_RESERVES), BigInt(VIRTUAL_TOKEN_RESERVES));
const GRAD_MC = marketCapLamports(
  BigInt(VIRTUAL_SOL_RESERVES) + BigInt(GRADUATION_LAMPORTS),
  BigInt(VIRTUAL_TOKEN_RESERVES) - BigInt(CURVE_SUPPLY),
);

const MODES: {
  key: LaunchMode;
  title: string;
  tax: number;
  blurb: string;
  bullets: string[];
}[] = [
  {
    key: 'dividend',
    title: 'Dividends',
    tax: DIVIDEND_MODE_TAX_BPS,
    blurb: 'Every trade pays 5%. Four of those five points are shared across every wallet holding the token.',
    bullets: [
      '1% to the platform vault',
      '4% pro-rata to all holders',
      'claim any time, nothing to stake',
      'payout is pull-based: your SOL stays yours',
    ],
  },
  {
    key: 'lottery',
    title: 'Lottery',
    tax: LOTTERY_MODE_TAX_BPS,
    blurb: 'Every trade pays 10%. Three points are split evenly across the ten largest holders, six points are drawn by ten random holders every round.',
    bullets: [
      '1% to the platform vault',
      '3% split across the ten largest holders',
      '6% drawn by ten random holders each round',
      'a round closes every 10 SOL of volume',
    ],
  },
];

export default function CreatePage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-24 pt-8 md:px-6">
      <Eyebrow>Launch</Eyebrow>
      <h1 className="mt-2 text-3xl font-thin uppercase tracking-tight text-white md:text-4xl">
        Light a new curve
      </h1>
      <p className="mt-3 max-w-xl text-sm font-extralight leading-relaxed text-slate-500">
        The whole supply is minted onto the curve in one transaction. You get no
        allocation - if you want tokens, buy them in the same block you launch, at the
        floor price, in public.
      </p>
      <ClientOnly
        fallback={
          <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_380px]">
            <div className="h-[520px] animate-pulse rounded-2xl border border-white/[0.05] bg-white/[0.02]" />
            <div className="h-[420px] animate-pulse rounded-2xl border border-white/[0.05] bg-white/[0.02]" />
          </div>
        }
      >
        <Form />
      </ClientOnly>
    </div>
  );
}

function Form() {
  const create = useStore((s) => s.create);
  const session = useStore((s) => s.session);
  const program = useStore((s) => s.program);
  const toast = useStore((s) => s.toast);

  const [mode, setMode] = useState<LaunchMode>('dividend');
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [image, setImage] = useState<PickedImage | null>(null);
  const [devBuy, setDevBuy] = useState('0');
  const [busy, setBusy] = useState(false);

  const devBuyLamports = useMemo(() => {
    const value = Number(devBuy);
    if (!Number.isFinite(value) || value <= 0) return 0n;
    return BigInt(Math.floor(value * 1e9));
  }, [devBuy]);

  const costs = useMemo(() => creationCosts(devBuyLamports), [devBuyLamports]);
  const taxLines = useMemo(() => describeTaxes(mode), [mode]);
  const valid =
    name.trim().length > 0 &&
    name.trim().length <= 32 &&
    symbol.trim().length > 0 &&
    symbol.trim().length <= 10 &&
    description.length <= 160;

  function submit() {
    if (!valid) {
      toast('Name, ticker and a description under 160 characters are required.', 'error');
      return;
    }
    setBusy(true);
    const input: CreateLaunchInput = {
      mode,
      name: name.trim(),
      symbol: symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''),
      description: description.trim(),
      imageUrl: imageUrl.trim() || undefined,
      devBuyLamports,
    };
    // the transaction is sent and confirmed inside the store, which then
    // navigates to the new launch - there is nothing local to return
    create(input);
    setBusy(false);
  }

  return (
    <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_380px]">
      <div className="space-y-5">
        <section className="card space-y-5 p-6">
          <FieldLabel hint="the two economics the program supports">Mode</FieldLabel>
          <div className="grid gap-3 sm:grid-cols-2">
            {MODES.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setMode(item.key)}
                className={cn(
                  'rounded-xl border p-4 text-left transition-colors',
                  mode === item.key
                    ? 'border-white/40 bg-white/[0.05]'
                    : 'border-white/[0.07] bg-black hover:border-white/20',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-light uppercase tracking-widest text-white">
                    {item.title}
                  </span>
                  <Pill tone={mode === item.key ? 'accent' : 'neutral'}>
                    {item.tax / 100}% tax
                  </Pill>
                </div>
                <p className="mt-2 text-[11px] font-extralight leading-relaxed text-slate-500">
                  {item.blurb}
                </p>
                <ul className="mt-3 space-y-1.5">
                  {item.bullets.map((bullet) => (
                    <li
                      key={bullet}
                      className="flex items-start gap-1.5 text-[10px] font-extralight leading-relaxed text-slate-500"
                    >
                      <CheckCircle2 size={11} className="mt-0.5 shrink-0 text-slate-600" />
                      {bullet}
                    </li>
                  ))}
                </ul>
              </button>
            ))}
          </div>

          
        </section>

        <section className="card space-y-5 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel hint={`${name.length}/32`}>Name</FieldLabel>
              <input
                className="input-base"
                value={name}
                maxLength={32}
                placeholder="Umbra"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div>
              <FieldLabel hint={`${symbol.length}/10`}>Ticker</FieldLabel>
              <div className="flex items-center rounded-lg border border-slate-800 bg-black focus-within:border-white/40">
                <span className="pl-3 text-sm font-extralight text-slate-600">$</span>
                <input
                  className="w-full bg-transparent px-1.5 py-2.5 text-sm font-extralight uppercase text-white placeholder-slate-700 focus:outline-none"
                  value={symbol}
                  maxLength={10}
                  placeholder="UMBRA"
                  onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                />
              </div>
            </div>
          </div>

          <div>
            <FieldLabel hint="from your library, or paste a permanent link">Image</FieldLabel>
            <ImagePicker onChange={setImage} />
            <input
              className="input-base mt-3"
              value={imageUrl}
              placeholder="https://arweave.net/ (permanent link, optional)"
              onChange={(event) => setImageUrl(event.target.value)}
            />
            <p className="mt-2 text-[10px] font-extralight leading-relaxed text-slate-600">
              Upload the image to permanent storage (Arweave, IPFS, ) and paste the link: the
              link, the name, the ticker and the description end up in the launch account on
              chain. The image bytes never do - a Solana account cannot hold a photo.
            </p>
          </div>

          <div>
            <FieldLabel hint={`${description.length}/160`}>Description</FieldLabel>
            <textarea
              className="input-base min-h-[92px] resize-none"
              value={description}
              maxLength={160}
              placeholder="What is this curve funding?"
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div>
            <FieldLabel hint="optional  buys in the same transaction, at the floor price">
              Initial buy
            </FieldLabel>
            <div className="flex items-center gap-2">
              <input
                className="input-base"
                value={devBuy}
                inputMode="decimal"
                onChange={(event) => setDevBuy(event.target.value.replace(/[^0-9.]/g, ''))}
              />
              <span className="text-[11px] font-light uppercase tracking-widest text-slate-500">
                SOL
              </span>
            </div>
            <div className="mt-2 flex gap-2">
              {['0', '0.5', '1', '5'].map((preset) => (
                <Pill key={preset} active={devBuy === preset} onClick={() => setDevBuy(preset)}>
                  {preset} sol
                </Pill>
              ))}
            </div>
          </div>
        </section>

        <section className="card p-6">
          <div className="flex items-baseline justify-between gap-3">
            <span className="label-xs">What launching costs</span>
            <span className="text-[10px] font-extralight text-slate-600">devnet</span>
          </div>
          <div className="mt-4 space-y-2.5">
            {costs.lines.map((line) => (
              <div key={line.label} className="flex items-baseline justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[11px] font-extralight text-slate-300">{line.label}</p>
                  {line.hint ? (
                    <p className="text-[10px] font-extralight text-slate-600">{line.hint}</p>
                  ) : null}
                </div>
                <p className="shrink-0 text-[11px] font-extralight tabular-nums text-slate-400">
                  {fmtSol(line.lamports, 4)} SOL
                </p>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-4 border-t border-white/[0.06] pt-2.5">
              <p className="text-[11px] font-light uppercase tracking-widest text-slate-400">
                Total
              </p>
              <p className="text-sm font-extralight tabular-nums text-white">
                {fmtSol(costs.total, 4)} SOL
                <span className="ml-2 text-[10px] text-slate-600">
                  {fmtUsd(costs.total, SOL_PRICE_USD)}
                </span>
              </p>
            </div>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!valid || busy || !session || !program}
            onClick={submit}
            className="btn-primary"
          >
            <Rocket size={13} />
            {!session ? 'Connect a wallet to launch' : !program ? 'Program not deployed' : 'Launch token'}
          </button>
          <p className="text-[10px] font-extralight leading-relaxed text-slate-600">
            {!program
              ? 'No program is configured for this cluster, so launching is disabled. Deploy it (see docs) and set NEXT_PUBLIC_PROGRAM_ID.'
              : 'The mint authority is revoked inside the same transaction, so the supply can never grow.'}
          </p>
        </div>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <div className="card p-6">
          <p className="label-eyebrow">Preview</p>
          <div className="mt-4 flex items-center gap-3">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 text-[11px] font-light uppercase text-white/80"
              style={{ background: avatarGradient(symbol || name || 'solpad') }}
            >
              {isRenderableImage(imageUrl) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl.trim()} alt="" className="h-full w-full object-cover" />
              ) : image?.preview && isRenderableImage(image.preview) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image.preview} alt="" className="h-full w-full object-cover opacity-60" />
              ) : (
                <span className="text-[11px] font-light uppercase tracking-widest text-white/80">
                  {initials(symbol || name)}
                </span>
              )}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-extralight text-white">
                {name || 'Token name'}
              </p>
              <p className="text-[10px] font-light uppercase tracking-widest text-slate-500">
                ${symbol || 'TICKER'}
              </p>
            </div>
            <span className="ml-auto">
              <Pill tone="accent">
                {mode === 'dividend' ? 'dividend 5%' : `lottery ${LOTTERY_MODE_TAX_BPS / 100}%`}
              </Pill>
            </span>
          </div>
          <p className="mt-3 line-clamp-3 text-[11px] font-extralight leading-relaxed text-slate-500">
            {description || 'Your description appears here.'}
          </p>

          <div className="mt-5 space-y-3 border-t border-white/[0.06] pt-4">
            {taxLines.map((line) => (
              <div key={line.label} className="flex items-center gap-3">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className={cn('h-full rounded-full', line.tone === 'accent' ? 'bg-white/80' : 'bg-white/35')}
                    style={{ width: `${(line.bps / LOTTERY_MODE_TAX_BPS) * 100}%` }}
                  />
                </div>
                <span className="w-[38%] text-[10px] font-extralight uppercase tracking-widest text-slate-500">
                  {line.label}
                </span>
                <span className="w-10 shrink-0 text-right text-[10px] font-extralight tabular-nums text-slate-300">
                  {line.bps / 100}%
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-6">
          <p className="label-eyebrow">Curve parameters</p>
          <div className="mt-4 space-y-3">
            <Stat label="Supply" value={fmtTokens(BigInt(TOTAL_SUPPLY))} />
            <Stat
              label="On the curve"
              value={`${fmtTokens(BigInt(CURVE_SUPPLY))} (79.31%)`}
              sub="sold to the public, none reserved"
            />
            <Stat
              label="Kept for the pool"
              value={`${fmtTokens(BigInt(POOL_RESERVE))} (20.69%)`}
              sub="locked into the pool at graduation, LP never released"
            />
            <Stat
              label="Starting market cap"
              value={`${fmtSol(LAUNCH_MC)} SOL  ${fmtUsd(LAUNCH_MC, SOL_PRICE_USD)}`}
            />
            <Stat
              label="Graduation"
              value={`${fmtSol(GRADUATION_LAMPORTS)} SOL raised when the curve sells out`}
            />
            <Stat
              label="Graduation market cap"
              value={`${fmtSol(GRAD_MC)} SOL  ${fmtUsd(GRAD_MC, SOL_PRICE_USD)}`}
            />
            <Stat
              label="Trade tax"
              value={mode === 'dividend' ? '5% buy and sell' : '10% buy and sell'}
              sub={
                mode === 'dividend'
                  ? `1% vault  ${DIVIDEND_MODE_DIVIDEND_BPS / 100}% dividends`
                  : `1% vault  ${TOP_SHARE_BPS / 100}% top ten  ${DRAW_SHARE_BPS / 100}% draw`
              }
            />
            <Stat label="Creator allocation" value="0%" sub="everyone buys on the same curve" />
            <Stat label="Platform vault slice" value={`${VAULT_BPS / 100}%`} sub="always exactly 1%" />
          </div>
          <div className="mt-5 flex items-start gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <Info size={12} className="mt-0.5 shrink-0 text-slate-500" />
            <p className="text-[10px] font-extralight leading-relaxed text-slate-500">
              Launch fee {fmtSol(BigInt(DEFAULT_CREATION_FEE_LAMPORTS), 3)} SOL plus account
              rent. The curve is the pump.fun curve, unchanged: 30 SOL of virtual reserves,
              1.073B virtual tokens, graduating at ~85 SOL raised.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}






