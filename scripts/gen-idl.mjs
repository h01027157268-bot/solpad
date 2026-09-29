#!/usr/bin/env node
/**
 * Generates app/src/lib/solana/idl.json from the account layouts of
 * programs/launchpad/src/state.rs and the instruction surface of
 * programs/launchpad/src/lib.rs.
 *
 * `anchor build` produces the same file (target/idl/launchpad.json)  this
 * script exists so the checked-in IDL can be regenerated and, more importantly,
 * *verified* without the Solana toolchain. It parses the Rust source and fails
 * loudly if a field was added, removed or reordered, which is exactly the drift
 * that silently breaks a client.
 *
 *   node scripts/gen-idl.mjs [--check]
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(ROOT, 'programs/launchpad/src/state.rs');
const BOARD = path.join(ROOT, 'programs/launchpad/src/board.rs');
const LIB = path.join(ROOT, 'programs/launchpad/src/lib.rs');
const OUT = path.join(ROOT, 'app/src/lib/solana/idl.json');
const PROGRAM_ID = '8Fg3GzGg2pDHHRy4uMZ1Jv1HQ7cadifNbWKmVW1rwAzL';

const check = process.argv.includes('--check');

const discriminator = (prefix, name) =>
  [...createHash('sha256').update(`${prefix}:${name}`).digest().subarray(0, 8)];

const enumType = (name, variants) => ({
  name,
  type: { kind: 'enum', variants: variants.map((v) => ({ name: v })) },
});

const struct = (name, fields) => ({
  name,
  type: { kind: 'struct', fields: fields.map(([field, type]) => ({ name: field, type })) },
});

// ---------------------------------------------------------------------------
// account layouts - parsed out of state.rs and checked below
// ---------------------------------------------------------------------------

const ARRAY_LENGTHS = { DRAW_WINNERS: 10, TOP_SEATS: 10, MAX_HOLDERS: 64 };

const RUST_TYPES = {
  Pubkey: 'publicKey',
  u8: 'u8',
  u16: 'u16',
  u64: 'u64',
  i64: 'i64',
  u128: 'u128',
  i128: 'i128',
  bool: 'bool',
};

function parseStateFile(source) {
  const out = {};
  const structRe = /pub struct (\w+) \{([\s\S]*?)\n\}/g;
  for (const match of source.matchAll(structRe)) {
    const [, name, body] = match;
    const fields = [];
    const lines = body.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const field = line.match(/^pub (\w+):\s*(.+?),?$/);
      if (!field) continue;
      const [, fieldName, rawType] = field;
      let type = rawType.trim().replace(/,$/, '');
      if (type === 'String') {
        const hint = body.slice(0, body.indexOf(line)).match(/#\[max_len\((\w+)\)\]\s*$/);
        type = `string@${hint ? hint[1] : ''}`;
      }
      const maxLen = lines[i - 1]?.match(/#\[max_len\((\w+)\)\]/);
      if (maxLen) type = `Vec:${type}:${maxLen[1]}`;
      if (type.startsWith('Vec:')) {
        fields.push([fieldName, { vec: type.split(':')[1] === 'Pubkey' ? 'publicKey' : 'u64' }]);
        continue;
      }
      if (type.startsWith('string@')) {
        fields.push([fieldName, 'string']);
        continue;
      }
      if (type === 'Vec<Pubkey>') {
        fields.push([fieldName, { vec: 'publicKey' }]);
        continue;
      }
      if (type === 'Vec<u64>') {
        fields.push([fieldName, { vec: 'u64' }]);
        continue;
      }
      const fixed = type.match(/^\[(\w+);\s*(\w+)\]$/);
      if (fixed) {
        const inner = RUST_TYPES[fixed[1]];
        const length = /^\d+$/.test(fixed[2]) ? Number(fixed[2]) : ARRAY_LENGTHS[fixed[2]];
        if (!inner || !length) {
          throw new Error("gen-idl: unmapped array " + type + " for " + name + "." + fieldName);
        }
        fields.push([fieldName, { array: [inner, length] }]);
        continue;
      }
      const mapped = RUST_TYPES[type];
      if (mapped) {
        fields.push([fieldName, mapped]);
        continue;
      }
      // enums and other program-defined types are referenced by name
      if (/^[A-Z]\w*$/.test(type)) {
        fields.push([fieldName, { defined: type }]);
        continue;
      }
      throw new Error(`gen-idl: unmapped Rust type "${type}" for ${name}.${fieldName}`);
    }
    out[name] = fields;
  }
  return out;
}

const camel = (value) => value.replace(/_(\w)/g, (_, c) => c.toUpperCase());

// the bounded membership sets live in their own module
const layouts = {
  ...parseStateFile(readFileSync(STATE, 'utf8')),
  ...parseStateFile(readFileSync(BOARD, 'utf8')),
};

// Definitions the client needs to decode accounts and encode arguments.
const DEFINITIONS = {
  Config: layouts.Config,
  Launch: layouts.Launch,
  Position: layouts.Position,
  Round: layouts.Round,
  TopBoard: layouts.TopBoard,
  HolderRegistry: layouts.HolderRegistry,
  Pool: layouts.Pool,
};

const ARG_TYPES = {
  InitConfigArgs: struct('InitConfigArgs', [
    ['treasury', 'publicKey'],
    ['creationFeeLamports', 'u64'],
    ['defaultEntropySource', { defined: 'EntropySource' }],
  ]),
  UpdateConfigArgs: struct('UpdateConfigArgs', [
    ['treasury', { option: 'publicKey' }],
    ['creationFeeLamports', { option: 'u64' }],
    ['defaultEntropySource', { option: { defined: 'EntropySource' } }],
    ['paused', { option: 'bool' }],
    ['newAuthority', { option: 'publicKey' }],
  ]),
  MetadataArgs: struct('MetadataArgs', [
    ['name', 'string'],
    ['symbol', 'string'],
    ['uri', 'string'],
    ['sellerFeeBasisPoints', 'u16'],
  ]),
  CreateLaunchArgs: struct('CreateLaunchArgs', [
    ['mode', { defined: 'LaunchMode' }],
    ['name', 'string'],
    ['symbol', 'string'],
    ['uri', 'string'],
    ['seed', { array: ['u8', 32] }],
  ]),
};

const ENUMS = [
  enumType('LaunchMode', ['dividend', 'lottery']),
  enumType('LaunchStatus', ['bonding', 'migrated']),
  enumType('SwapDirection', ['buy', 'sell']),
  // SlotHashes is the dependency-free default; Switchboard consumes an
  // On-Demand randomness account per round.
  enumType('EntropySource', ['slotHashes', 'switchboard']),
];

const MPL_TOKEN_METADATA = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';

// ---------------------------------------------------------------------------
// instruction surface - mirrors the `#[program]` module in lib.rs
// ---------------------------------------------------------------------------

const account = (name, flags = {}) => ({ name, ...flags });

const seatAccounts = () =>
  Array.from({ length: 10 }, (_, i) => account(`seat${i}`, { writable: true, optional: true }));
const winnerAccounts = () =>
  Array.from({ length: 10 }, (_, i) => account(`winner${i}`, { writable: true, optional: true }));

const INSTRUCTIONS = [
  {
    name: 'initializeConfig',
    accounts: [
      account('authority', { writable: true, signer: true }),
      account('config', { writable: true }),
      account('treasury', { writable: true }),
      account('systemProgram', { address: '11111111111111111111111111111111' }),
    ],
    args: [{ name: 'args', type: { defined: 'InitConfigArgs' } }],
  },
  {
    name: 'updateConfig',
    accounts: [account('authority', { signer: true }), account('config', { writable: true })],
    args: [{ name: 'args', type: { defined: 'UpdateConfigArgs' } }],
  },
  {
    name: 'acceptAuthority',
    accounts: [account('pendingAuthority', { signer: true }), account('config', { writable: true })],
    args: [],
  },
  {
    name: 'createLaunch',
    accounts: [
      account('creator', { writable: true, signer: true }),
      account('config', { writable: true }),
      account('treasury', { writable: true }),
      account('launch', { writable: true }),
      account('mint', { writable: true }),
      account('curveVault', { writable: true }),
      account('poolReserve', { writable: true }),
      account('topBoard', { writable: true }),
      account('registry', { writable: true }),
      account('round', { writable: true }),
      account('solVault', { writable: true }),
      account('dividendVault', { writable: true }),
      account('drawVault', { writable: true }),
      account('randomnessAccount', { writable: true }),
      account('tokenProgram', { address: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }),
      account('systemProgram', { address: '11111111111111111111111111111111' }),
    ],
    args: [{ name: 'args', type: { defined: 'CreateLaunchArgs' } }],
  },
  {
    name: 'buy',
    accounts: [
      account('buyer', { writable: true, signer: true }),
      account('config'),
      account('launch', { writable: true }),
      account('mint'),
      account('buyerToken', { writable: true }),
      account('curveVault', { writable: true }),
      account('solVault', { writable: true }),
      account('dividendVault', { writable: true }),
      account('drawVault', { writable: true }),
      account('treasury', { writable: true }),
      account('topBoard', { writable: true }),
      account('registry', { writable: true }),
      account('round', { writable: true }),
      account('position', { writable: true }),
      account('tokenProgram', { address: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }),
      account('associatedTokenProgram', {
        address: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
      }),
      account('systemProgram', { address: '11111111111111111111111111111111' }),
      ...seatAccounts(),
    ],
    args: [
      { name: 'amountIn', type: 'u64' },
      { name: 'minTokensOut', type: 'u64' },
    ],
  },
  {
    name: 'sell',
    accounts: [
      account('seller', { writable: true, signer: true }),
      account('config'),
      account('launch', { writable: true }),
      account('mint'),
      account('sellerToken', { writable: true }),
      account('curveVault', { writable: true }),
      account('solVault', { writable: true }),
      account('dividendVault', { writable: true }),
      account('drawVault', { writable: true }),
      account('treasury', { writable: true }),
      account('topBoard', { writable: true }),
      account('registry', { writable: true }),
      account('round', { writable: true }),
      account('position', { writable: true }),
      account('tokenProgram', { address: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }),
      account('systemProgram', { address: '11111111111111111111111111111111' }),
      ...seatAccounts(),
    ],
    args: [
      { name: 'tokensIn', type: 'u64' },
      { name: 'minSolOut', type: 'u64' },
    ],
  },
  {
    name: 'claimDividends',
    accounts: [
      account('owner', { writable: true, signer: true }),
      account('launch', { writable: true }),
      account('mint'),
      account('ownerToken', { writable: true }),
      account('position', { writable: true }),
      account('dividendVault', { writable: true }),
      account('systemProgram', { address: '11111111111111111111111111111111' }),
    ],
    args: [],
  },
  {
    name: 'sweepDividendVault',
    accounts: [
      account('authority', { writable: true, signer: true }),
      account('config'),
      account('launch'),
      account('mint'),
      account('treasury', { writable: true }),
      account('dividendVault', { writable: true }),
      account('systemProgram', { address: '11111111111111111111111111111111' }),
    ],
    args: [{ name: 'amount', type: 'u64' }],
  },
  {
    name: 'closeRound',
    accounts: [
      account('cranker', { writable: true, signer: true }),
      account('config'),
      account('launch', { writable: true }),
      account('mint'),
      account('round', { writable: true }),
    ],
    args: [],
  },
  {
    name: 'resolveRound',
    accounts: [
      account('cranker', { writable: true, signer: true }),
      account('config'),
      account('launch', { writable: true }),
      account('mint'),
      account('round', { writable: true }),
      account('registry', { writable: true }),
      account('drawVault', { writable: true }),
      account('treasury', { writable: true }),
      account('slotHashes', { address: 'SysvarS1otHashes111111111111111111111111111' }),
      account('randomnessAccount', { writable: true }),
      ...winnerAccounts(),
      account('systemProgram', { address: '11111111111111111111111111111111' }),
    ],
    args: [],
  },
  {
    name: 'migrate',
    accounts: [
      account('cranker', { writable: true, signer: true }),
      account('config'),
      account('launch', { writable: true }),
      account('mint'),
      account('curveVault', { writable: true }),
      account('poolReserve', { writable: true }),
      account('solVault', { writable: true }),
      account('pool', { writable: true }),
      account('poolSol', { writable: true }),
      account('poolTokens', { writable: true }),
      account('lpMint', { writable: true }),
      account('lpLock', { writable: true }),
      account('tokenProgram', { address: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }),
      account('systemProgram', { address: '11111111111111111111111111111111' }),
    ],
    args: [],
  },
  {
    name: 'attachMetadata',
    accounts: [
      account('payer', { writable: true, signer: true }),
      account('launch', { writable: true }),
      account('mint', { writable: true }),
      account('metadata', { writable: true }),
      account('tokenMetadataProgram', { address: 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s' }),
      account('systemProgram', { address: '11111111111111111111111111111111' }),
      account('rent', { address: 'SysvarRent111111111111111111111111111111111' }),
    ],
    args: [{ name: 'args', type: { defined: 'MetadataArgs' } }],
  },
  {
    name: 'swap',
    accounts: [
      account('trader', { writable: true, signer: true }),
      account('config'),
      account('launch', { writable: true }),
      account('mint'),
      account('pool', { writable: true }),
      account('poolSol', { writable: true }),
      account('poolTokens', { writable: true }),
      account('traderToken', { writable: true }),
      account('dividendVault', { writable: true }),
      account('drawVault', { writable: true }),
      account('treasury', { writable: true }),
      account('topBoard', { writable: true }),
      account('registry', { writable: true }),
      account('round', { writable: true }),
      account('position', { writable: true }),
      account('tokenProgram', { address: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }),
      account('associatedTokenProgram', {
        address: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
      }),
      account('systemProgram', { address: '11111111111111111111111111111111' }),
      ...seatAccounts(),
    ],
    args: [
      { name: 'direction', type: { defined: 'SwapDirection' } },
      { name: 'amountIn', type: 'u64' },
      { name: 'minAmountOut', type: 'u64' },
    ],
  },
];

// every instruction in lib.rs must be covered
const libSource = readFileSync(LIB, 'utf8');
const programBody = libSource.slice(libSource.indexOf('#[program]'));
const declared = [...programBody.matchAll(/pub fn (\w+)\(/g)].map((m) =>
  camel(m[1].replace(/^_/, '')),
);
const covered = new Set(INSTRUCTIONS.map((ix) => ix.name));
const missing = declared.filter((name) => !covered.has(name));
if (missing.length > 0) {
  console.error(`gen-idl: lib.rs declares instructions missing from the IDL: ${missing.join(', ')}`);
  process.exit(1);
}

const idl = {
  address: PROGRAM_ID,
  metadata: { name: 'launchpad', version: '0.1.0', spec: '0.1.0' },
  instructions: INSTRUCTIONS.map((ix) => ({
    name: ix.name,
    discriminator: discriminator('global', ix.name),
    accounts: ix.accounts,
    args: ix.args,
  })),
  accounts: Object.keys(DEFINITIONS).map((name) => ({
    name,
    discriminator: discriminator('account', name),
  })),
  events: [
    ['LaunchCreated'],
    ['Trade'],
    ['DividendsDistributed'],
    ['DividendsClaimed'],
    ['LotteryTickets'],
    ['LotteryRoundClosed'],
    ['LotteryResolved'],
    ['LotteryPrizeClaimed'],
    ['LotteryRoundOpened'],
    ['Migrated'],
    ['Swapped'],
    ['ConfigInitialized'],
    ['ConfigUpdated'],
    ['AuthorityTransferStarted'],
    ['AuthorityTransferred'],
    ['DividendsSwept'],
    ['PrizeRolledOver'],
  ].map(([name]) => ({ name, discriminator: discriminator('event', name) })),
  types: [
    ...ENUMS,
    ...Object.values(ARG_TYPES),
    ...Object.entries(DEFINITIONS).map(([name, fields]) => struct(name, fields.map(([f, t]) => [camel(f), t]))),
  ],
};

const json = `${JSON.stringify(idl, null, 2)}\n`;

if (check) {
  const current = readFileSync(OUT, 'utf8');
  if (current !== json) {
    console.error('gen-idl: idl.json is out of date with the program source');
    process.exit(1);
  }
  console.log('gen-idl: idl.json matches the program source');
} else {
  writeFileSync(OUT, json);
  console.log(`gen-idl: wrote ${path.relative(ROOT, OUT)}`);
}

console.log(
  `gen-idl: ${INSTRUCTIONS.length} instructions, ${Object.keys(DEFINITIONS).length} accounts, ` +
    `${ENUMS.length + Object.keys(ARG_TYPES).length + Object.keys(DEFINITIONS).length} types`,
);
console.log(
  'gen-idl: account layouts parsed from state.rs:',
  Object.entries(DEFINITIONS)
    .map(([name, fields]) => `${name}(${fields.length})`)
    .join(' '),
);







