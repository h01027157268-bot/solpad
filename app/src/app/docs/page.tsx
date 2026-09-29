import { Eyebrow } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { CURVE_SUPPLY, GRADUATION_LAMPORTS, POOL_RESERVE, TOTAL_SUPPLY, VIRTUAL_SOL_RESERVES, VIRTUAL_TOKEN_RESERVES } from '@/lib/engine';
import { fmtSol, fmtTokens } from '@/lib/format';

const SECTIONS = [
  {
    id: 'curve',
    title: 'The curve',
    body: [
      `Every launch mints ${fmtTokens(BigInt(TOTAL_SUPPLY))} tokens in the create transaction: ${fmtTokens(
        BigInt(CURVE_SUPPLY),
      )} (79.31%) onto the bonding curve and ${fmtTokens(BigInt(POOL_RESERVE))} (20.69%) locked for the migration pool. The creator gets nothing - if they want tokens they buy on the same curve, in the same block, at the floor price.`,
      `The curve is the pump.fun / Raydium LaunchLab constant product: ${fmtSol(
        BigInt(VIRTUAL_SOL_RESERVES),
      )} SOL of virtual reserves against ${fmtTokens(
        BigInt(VIRTUAL_TOKEN_RESERVES),
      )} virtual tokens. That puts the opening market cap at ~27.96 SOL, and selling the curve out raises about ${fmtSol(
        BigInt(GRADUATION_LAMPORTS),
      )} SOL and finishes around a 411 SOL market cap.`,
      'Graduation is permissionless: once the raise target is hit anyone can crank the migration, which moves the whole raise plus the reserved tokens into a constant product pool. The LP tokens are minted into a vault owned by the launch PDA and there is no instruction anywhere that can release them, so liquidity is locked permanently.',
    ],
  },
  {
    id: 'dividend',
    title: 'Dividend mode - 5%',
    body: [
      'Every buy and every sell pays 5%. One point goes to the platform vault, four points are spread pro-rata across every wallet holding the token at that moment.',
      'The program keeps a lamports-per-token accumulator scaled by 1e18. Each distribution adds dividend_lamports x 1e18 / eligible_supply to it, and a position can claim balance x accumulator / 1e18 minus whatever it has already been marked as paid. Eligible supply is the total supply minus whatever is locked in program vaults, so the sum of every pending claim always equals the lamports that were paid in - the dividend vault can never be over-subscribed.',
      'The paid marker is signed. That matters when a holder sells their whole bag: their accrued claim survives the sale because the marker goes negative instead of being clamped, which is what keeps the vault exactly solvent.',
      'Claims are pull-based. The SOL sits in the dividend vault until the holder claims it; nothing is ever pushed to a wallet that did not ask for it, and nothing is ever locked behind a lock-up or a vesting schedule.',
    ],
  },
  {
    id: 'lottery',
    title: 'Lottery mode - 10%',
    body: [
      'Every buy and every sell pays 10%. One point goes to the platform vault. The lottery takes 6 points during the first ten trades of the launch and 3 points afterwards, and the creator picks where the unallocated slice goes: holders, the pot, the platform or themselves.',
      'Tickets are volume weighted: 0.01 SOL of trade volume is one ticket. A round closes the moment it reaches 1,000 tickets or seats 64 wallets, and it can be closed early once it goes quiet - a trade that lands while a round is being drawn keeps its volume parked and converts it into tickets as soon as the next round opens.',
      'The draw is a lazy VRF. When a round closes the program publishes commitment = sha256(seed || round || target_slot) and only accepts a draw after that slot has passed. The winning ticket is sha256(commitment || slot_hash(target_slot)) modulo the ticket count, then the program walks the board cumulative distribution to find the seat. Nobody - the house included - can know or steer the outcome while tickets are still being sold.',
      'Every part of this is verifiable after the fact from the launch account, the lottery board account and the slot hashes sysvar. Swap in Switchboard VRF by replacing the entropy source; the selection logic stays the same.',
    ],
  },
  {
    id: 'taxes',
    title: 'Where every point goes',
    body: [
      'The tax is taken inside the same instruction that fills the order, before the curve or the pool is touched. Buys pay on top of the curve inflow, sells pay out of the proceeds, and the slices are transferred straight into the platform vault, the dividend vault and the lottery vault in that transaction.',
      'Rounding dust always stays with the trader or the seller - the program floors every split, so the tax can never round up in the platforms favour.',
      'The same tax keeps applying after graduation because the pool is the only venue: the LP tokens are held by the launch PDA and never released, so there is no way to migrate the liquidity elsewhere and start trading tax-free.',
    ],
  },
  {
    id: 'program',
    title: 'Program',
    body: [
      'create_launch mints the supply, creates the curve, the vaults and the lottery board; buy and sell trade the curve; claim_dividends pays the holder slice; close_lottery_round, resolve_lottery, claim_lottery_prize and open_lottery_round run the rounds; migrate graduates the launch; swap trades the locked pool; update_config, accept_authority and sweep_dividend_vault are the platform admin surface.',
      'The mint authority is revoked inside create_launch, so the supply can never grow. The lottery board is a fixed 64-seat account reused by every round, which bounds the draw to a single instruction.',
      'Everything the app shows can be re-derived from the accounts: reserves, the accumulator, the board, the pot and the trade log all live on-chain.',
    ],
  },
] as const;

export default function DocsPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-24 pt-8 md:px-6">
      <Eyebrow>Docs</Eyebrow>
      <h1 className="mt-2 text-3xl font-thin uppercase tracking-tight text-white md:text-4xl">
        How the launchpad works
      </h1>
      <p className="mt-3 text-sm font-extralight leading-relaxed text-slate-500">
        Two economics, one curve, every rule enforced by the program. This page is the
        version of the contract that a trader can read in five minutes.
      </p>

      <nav className="mt-6 flex flex-wrap gap-2">
        {SECTIONS.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="pill border-white/[0.08] text-slate-500 hover:text-slate-200"
          >
            {section.title}
          </a>
        ))}
      </nav>

      <div className="mt-8 space-y-8">
        {SECTIONS.map((section, index) => (
          <section key={section.id} id={section.id} className="card scroll-mt-24 p-6">
            <div className="flex items-baseline gap-3">
              <span className="text-[10px] font-light tabular-nums text-slate-600">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h2 className="text-lg font-thin uppercase tracking-widest text-white">
                {section.title}
              </h2>
            </div>
            <div className="mt-4 space-y-3">
              {section.body.map((paragraph) => (
                <p
                  key={paragraph.slice(0, 24)}
                  className={cn('text-[12px] font-extralight leading-relaxed text-slate-400')}
                >
                  {paragraph}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-8 card p-6">
        <p className="label-eyebrow">Reference</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            { label: 'Solana docs', href: 'https://solana.com/docs' },
            { label: 'Anchor book', href: 'https://www.anchor-lang.com/' },
            { label: 'SPL Token', href: 'https://spl.solana.com/token' },
            { label: 'Solana Explorer', href: 'https://explorer.solana.com' },
            { label: 'Solscan', href: 'https://solscan.io' },
            { label: 'pump.fun curve', href: 'https://pump.fun' },
          ].map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-3 text-[11px] font-extralight text-slate-300 transition-colors hover:border-white/20 hover:text-white"
            >
              {link.label}
              <span className="text-slate-600"></span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
