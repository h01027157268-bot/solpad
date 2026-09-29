'use client';

import { Bar, Pill, Stat } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { SOL_PRICE_USD, explorerAddress } from '@/lib/const';
import { useStore } from '@/lib/data/store';
import type { LaunchState } from '@/lib/data/types';
import {
  CURVE_SUPPLY,
  DRAW_SHARE_BPS,
  DRAW_WINNERS,
  GRADUATION_LAMPORTS,
  POOL_RESERVE,
  ROUND_VOLUME_TARGET_LAMPORTS,
  TOP_SEATS,
  TOP_SHARE_BPS,
  TOTAL_SUPPLY,
  VIRTUAL_SOL_RESERVES,
  VIRTUAL_TOKEN_RESERVES,
  graduationProgressBps,
  priceE6,
  seatShare,
} from '@/lib/engine';
import { fmtSol, fmtTokens, fmtUsd, shortAddress } from '@/lib/format';
import { Coins, Dices, Flame, Lock, Sparkles, Ticket, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';

function Panel({
  title,
  icon,
  hint,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md border border-white/10 text-slate-400">
          {icon}
        </span>
        <span className="label-xs">{title}</span>
        {hint ? (
          <span className="ml-auto text-[10px] font-extralight uppercase tracking-widest text-slate-600">
            {hint}
          </span>
        ) : null}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// position
// ---------------------------------------------------------------------------

export function PositionPanel({ launch }: { launch: LaunchState }) {
  const session = useStore((s) => s.session);
  const market = useStore((s) => s.market);
  const claim = useStore((s) => s.claim);

  if (!session) return null;
  const position = market.position(launch.mint, session.address);
  const value = (position.balance * launch.virtualSol) / (launch.virtualTokens || 1n);
  const seatBonus4 = seatShare(1_000_000_000n, Math.max(1, launch.board.seats.length));

  if (position.balance === 0n && position.pendingDividends === 0n && position.winnings === 0n) {
    return (
      <Panel title="Your position" icon={<Coins size={12} />} hint="empty">
        <p className="text-[11px] font-extralight leading-relaxed text-slate-500">
          You do not hold {launch.symbol} yet. Buying on the curve makes you a holder -
          and in lottery mode it puts you in the draw pool immediately.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Your position"
      icon={<Coins size={12} />}
      hint={`${(position.shareBps / 100).toFixed(3)}% of supply`}
    >
      <div className="grid grid-cols-2 gap-4">
        <Stat label={`${launch.symbol} held`} value={fmtTokens(position.balance)} />
        <Stat label="Value" value={`${fmtSol(value)} SOL`} sub={fmtUsd(value, SOL_PRICE_USD)} />
        <Stat label="Traded volume" value={`${fmtSol(position.volumeLamports)} SOL`} />
        {launch.mode === 'lottery' ? (
          <Stat
            label="Top-ten seat"
            value={position.seatRank ? `#${position.seatRank}` : 'not seated'}
            sub={
              position.seatRank
                ? `earns ~${fmtSol(seatBonus4, 5)} SOL per 1 SOL traded`
                : 'grow your position to enter'
            }
          />
        ) : (
          <Stat label="Claimed so far" value={`${fmtSol(position.dividendsClaimed, 5)} SOL`} />
        )}
      </div>

      {launch.mode === 'lottery' ? (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <p className="label-xs">Seat payouts</p>
            <p className="mt-1 text-sm font-extralight tabular-nums text-white">
              {fmtSol(position.seatEarnings, 5)} SOL
            </p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <p className="label-xs">Draw winnings</p>
            <p className="mt-1 text-sm font-extralight tabular-nums text-white">
              {fmtSol(position.winnings, 5)} SOL
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <div>
            <p className="label-xs">Claimable dividends</p>
            <p className="mt-1 text-sm font-extralight tabular-nums text-white">
              {fmtSol(position.pendingDividends, 5)} SOL
            </p>
          </div>
          <button
            type="button"
            disabled={position.pendingDividends <= 0n}
            onClick={() => claim(launch.mint)}
            className="btn-ghost"
          >
            Claim
          </button>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// the 3% board and the 6% round
// ---------------------------------------------------------------------------

export function LotteryPanel({ launch }: { launch: LaunchState }) {
  const session = useStore((s) => s.session);
  const version = useStore((s) => s.version);
  const market = useStore((s) => s.market);
  const draw = useStore((s) => s.draw);
  const closeRound = useStore((s) => s.closeRound);

  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1e3)), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const round = launch.round;
  const seats = launch.board.seats;
  const seatSharePerSol = seatShare(1_000_000_000n, Math.max(1, seats.length));
  const progress = Number((round.volumeLamports * 10_000n) / ROUND_VOLUME_TARGET_LAMPORTS) / 100;
  const slotReady = round.closedAtSlot !== 0 && market.slot >= round.targetSlot;
  const myWinnings = session ? launch.winnings[session.address] ?? 0n : 0n;
  void now;
  void version;

  return (
    <Panel
      title="The 10% split"
      icon={<Dices size={12} />}
      hint={`round ${round.index}`}
    >
      <div className="grid grid-cols-2 gap-4">
        <Stat
          label={`Top ${TOP_SEATS} share`}
          value={`${TOP_SHARE_BPS / 100}%`}
          sub={`${fmtSol(seatSharePerSol, 5)} SOL per seat per 1 SOL traded`}
        />
        <Stat
          label={`${DRAW_WINNERS} random winners`}
          value={`${DRAW_SHARE_BPS / 100}%`}
          sub={`${fmtSol(launch.round.prize || 0n, 4)} SOL paid out last round`}
        />
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-[10px] font-light uppercase tracking-widest text-slate-500">
          <span>round {round.index} pot  {fmtSol(round.pot, 4)} SOL</span>
          <span className="tabular-nums">
            {fmtSol(round.volumeLamports)} / {fmtSol(ROUND_VOLUME_TARGET_LAMPORTS)} SOL volume
          </span>
        </div>
        <Bar value={progress} />
        <p className="text-[10px] font-extralight leading-relaxed text-slate-600">
          The round closes when it has seen {fmtSol(ROUND_VOLUME_TARGET_LAMPORTS)} SOL of volume,
          or when anyone closes it because it went quiet. Nobody can steer the draw while it is
          still trading: it is bound to entropy that does not exist yet.
        </p>
      </div>

      <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
        <p className="text-[10px] font-light uppercase tracking-widest text-slate-500">
          Round state
        </p>
        <p className="mt-1.5 text-[11px] font-extralight leading-relaxed text-slate-400">
          {round.closedAtSlot === 0
            ? `Open - ${fmtSol(ROUND_VOLUME_TARGET_LAMPORTS - round.volumeLamports)} SOL of volume to go.`
            : round.resolved
              ? `Drawn. ${round.winners.length} wallets each took ${fmtSol(round.prize, 4)} SOL.`
              : `Closed at slot ${round.closedAtSlot}, bound to slot ${round.targetSlot}${
                  slotReady ? ' - ready to draw.' : `, ${round.targetSlot - market.slot} slots away.`
                }`}
        </p>
        {myWinnings > 0n ? (
          <p className="mt-2 text-[10px] font-extralight text-[#c8f7d4]">
            You have won {fmtSol(myWinnings, 4)} SOL across {launch.winners.length} draws.
          </p>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {round.closedAtSlot === 0 ? (
          <button
            type="button"
            disabled={round.volumeLamports === 0n}
            onClick={() => closeRound(launch.mint)}
            className="btn-quiet"
          >
            <Flame size={12} /> Close round early
          </button>
        ) : null}
        {round.closedAtSlot !== 0 && !round.resolved ? (
          <>
            <button
              type="button"
              disabled={!slotReady}
              onClick={() => draw(launch.mint)}
              className="btn-ghost"
            >
              <Ticket size={12} />
              {slotReady ? `Draw ${DRAW_WINNERS} winners` : `waiting ${round.targetSlot - market.slot} slots`}
            </button>

          </>
        ) : null}
      </div>

      <div className="mt-5 border-t border-white/[0.06] pt-4">
        <div className="flex items-center justify-between">
          <span className="label-xs">Top {TOP_SEATS} board</span>
          <span className="text-[10px] font-extralight uppercase tracking-widest text-slate-600">
            {seats.length} seated
          </span>
        </div>
        {seats.length === 0 ? (
          <p className="mt-2 text-[11px] font-extralight text-slate-500">
            Nobody holds anything yet - the 3% waits for the first buyer.
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {seats.map((seat, index) => (
              <li key={seat} className="flex items-center gap-2 text-[11px] font-extralight">
                <span className="w-5 text-right text-slate-600">{index + 1}</span>
                <a
                  href={explorerAddress(seat)}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    'font-mono text-[10px]',
                    seat === session?.address ? 'text-white' : 'text-slate-400 hover:text-white',
                  )}
                >
                  {shortAddress(seat, 5)}
                </a>
                <span className="ml-auto tabular-nums text-slate-500">
                  {fmtTokens(launch.board.balances[index])}
                </span>
                <Trophy size={10} className="text-slate-600" />
              </li>
            ))}
          </ul>
        )}
      </div>

      {launch.winners.length > 0 ? (
        <div className="mt-4 border-t border-white/[0.06] pt-4">
          <span className="label-xs">Recent draws</span>
          <ul className="mt-2 space-y-2">
            {launch.winners.slice(0, 3).map((entry) => (
              <li key={entry.round} className="text-[10px] font-extralight leading-relaxed text-slate-500">
                <span className="text-slate-400">round {entry.round}</span> {' '}
                {entry.winners.slice(0, 3).map((winner) => shortAddress(winner, 4)).join(', ')}
                {entry.winners.length > 3 ? ` +${entry.winners.length - 3} more` : ''} {' '}
                {fmtSol(entry.prize, 4)} SOL each
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// the 4% dividend panel (dividend mode only)
// ---------------------------------------------------------------------------

export function DividendPanel({ launch }: { launch: LaunchState }) {
  const distributed = launch.dividendDistributed;
  const rateBps = launch.volumeLamports > 0n ? Number((distributed * 10_000n) / launch.volumeLamports) : 0;

  return (
    <Panel title="Holder dividends" icon={<Sparkles size={12} />} hint="4% of every trade">
      <div className="grid grid-cols-2 gap-4">
        <Stat label="Distributed" value={`${fmtSol(distributed, 5)} SOL`} sub={fmtUsd(distributed, SOL_PRICE_USD)} />
        <Stat label="Pulled from volume" value={`${(rateBps / 100).toFixed(2)}%`} sub="1e18 scaled accumulator" />
        <Stat label="Accumulator" value={(Number(launch.dividendAcc) / 1e18).toExponential(3)} sub="lamports per token" />
        <Stat label="Claimed" value={`${fmtSol(launch.dividendClaimed, 5)} SOL`} />
      </div>
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-[10px] font-light uppercase tracking-widest text-slate-500">
          <span>paid out</span>
          <span className="tabular-nums">
            {distributed > 0n ? `${((Number(launch.dividendClaimed) / Number(distributed)) * 100).toFixed(1)}%` : '0%'}
          </span>
        </div>
        <Bar value={distributed > 0n ? (Number(launch.dividendClaimed) / Number(distributed)) * 100 : 0} />
      </div>
      <p className="mt-4 text-[10px] font-extralight leading-relaxed text-slate-600">
        The accumulator is spread over the supply that is not locked in a program vault, so the sum
        of every pending claim always equals the lamports that went in. Wallets that receive tokens
        through a plain transfer start earning from the moment they are first seen, never from
        history.
      </p>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// graduation + economics
// ---------------------------------------------------------------------------

export function GraduationPanel({ launch }: { launch: LaunchState }) {
  const market = useStore((s) => s.market);
  const migrate = useStore((s) => s.migrate);
  const progress = graduationProgressBps(launch.realSol, launch.graduationLamports);
  const ready = launch.status === 'bonding' && market.canMigrate(launch.mint);
  const remaining = launch.graduationLamports - launch.realSol;

  return (
    <Panel
      title="Graduation"
      icon={<Lock size={12} />}
      hint={launch.status === 'migrated' ? 'pool live' : `${(progress / 100).toFixed(1)}%`}
    >
      <div className="space-y-2">
        <Bar value={progress / 100} />
        <div className="flex items-center justify-between text-[10px] font-extralight uppercase tracking-widest text-slate-500">
          <span className="tabular-nums">
            {fmtSol(launch.realSol)} / {fmtSol(GRADUATION_LAMPORTS)} SOL raised
          </span>
          <span className="tabular-nums">{fmtTokens(launch.realTokens)} left</span>
        </div>
      </div>

      {launch.status === 'migrated' ? (
        <div className="mt-4 space-y-3">
          <Stat
            label="Pool liquidity"
            value={`${fmtSol(launch.pool?.solReserves ?? 0n)} SOL`}
            sub={`${fmtTokens(launch.pool?.tokenReserves ?? 0n)} ${launch.symbol} paired`}
          />
          <Stat
            label="LP tokens"
            value={fmtTokens(launch.pool?.lpSupply ?? 0n)}
            sub="held by the launch PDA, never released"
          />
          <p className="text-[10px] font-extralight leading-relaxed text-slate-600">
            The raise and the {fmtTokens(POOL_RESERVE)} reserved tokens were moved into a constant
            product pool. LP is locked forever, and because the pool is the only venue the same tax
            keeps applying to every swap.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <Stat
            label="Still to raise"
            value={`${fmtSol(remaining > 0n ? remaining : 0n)} SOL`}
            sub="anyone can crank the migration"
          />
          <button
            type="button"
            disabled={!ready}
            onClick={() => migrate(launch.mint)}
            className="btn-ghost w-full"
          >
            {ready ? 'Graduate into the locked pool' : 'Curve is still selling'}
          </button>
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/[0.05] pt-3">
        <Stat label="Total supply" value={fmtTokens(BigInt(TOTAL_SUPPLY))} />
        <Stat label="Curve supply" value={fmtTokens(BigInt(CURVE_SUPPLY))} />
        <Stat label="Virtual SOL" value={`${fmtSol(BigInt(VIRTUAL_SOL_RESERVES))} SOL`} />
        <Stat label="Virtual tokens" value={fmtTokens(BigInt(VIRTUAL_TOKEN_RESERVES))} />
      </div>
    </Panel>
  );
}

export function EconomicsPanel({ launch }: { launch: LaunchState }) {
  const rows =
    launch.mode === 'dividend'
      ? [
          { label: 'Platform vault', bps: launch.vaultBps, tone: 'muted' as const },
          { label: 'Holder dividends, pro-rata', bps: launch.dividendBps, tone: 'accent' as const },
        ]
      : [
          { label: 'Platform vault', bps: launch.vaultBps, tone: 'muted' as const },
          { label: `Top ${TOP_SEATS} holders, split evenly`, bps: launch.topBps, tone: 'accent' as const },
          { label: `${DRAW_WINNERS} random holders, split evenly`, bps: launch.drawBps, tone: 'accent' as const },
        ];

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-3">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className={cn('h-full rounded-full', row.tone === 'accent' ? 'bg-white/80' : 'bg-white/30')}
              style={{ width: `${(row.bps / 1_000) * 100}%` }}
            />
          </div>
          <span className="w-[46%] text-[10px] font-extralight uppercase tracking-widest text-slate-500">
            {row.label}
          </span>
          <span className="w-9 shrink-0 text-right text-[10px] font-extralight tabular-nums text-slate-300">
            {row.bps / 100}%
          </span>
        </div>
      ))}
      <div className="flex items-center justify-between border-t border-white/[0.06] pt-3 text-[10px] font-extralight uppercase tracking-widest text-slate-500">
        <span>total taken per trade</span>
        <span className="tabular-nums text-white">
          {(launch.vaultBps + launch.topBps + launch.drawBps + launch.dividendBps) / 100}%
        </span>
      </div>
      <p className="text-[10px] font-extralight leading-relaxed text-slate-600">
        Every slice is enforced by the program in the same instruction that fills your order: the
        vault slice goes to the platform, the top-ten slice is pushed to the seated wallets, and the
        draw slice waits in the round pot for the next draw.
      </p>
    </div>
  );
}

export function pricePerToken(launch: LaunchState): number {
  return Number(priceE6(launch.virtualSol, launch.virtualTokens)) / 1e6;
}

