#!/usr/bin/env node
/**
 * Point the app at a deployed program.
 *
 *   npm run connect -- <programId> [path/to/launchpad.json]
 *
 * 1. checks (or installs) the IDL next to the client
 * 2. writes NEXT_PUBLIC_PROGRAM_ID into .env.local
 * 3. verifies the IDL still matches the program source
 *
 * After this, `npm run dev` reads the chain: real curves, real volume, real
 * top-ten board, real round pot, and the 1% landing in the treasury.
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, '..');
const root = path.join(appDir, '..');
const idlTarget = path.join(appDir, 'src', 'lib', 'solana', 'idl.json');
const envPath = path.join(appDir, '.env.local');

const [programId, idlSourceArg] = process.argv.slice(2);
if (!programId || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(programId)) {
  console.error('usage: npm run connect -- <programId> [path/to/launchpad.json]');
  process.exit(1);
}

// 1. the IDL
const candidates = [
  idlSourceArg,
  path.join(root, 'target', 'idl', 'launchpad.json'),
  path.join(appDir, 'launchpad.json'),
].filter(Boolean);

let idlFrom = candidates.find((candidate) => candidate && existsSync(candidate));
if (idlFrom) {
  const idl = JSON.parse(readFileSync(idlFrom, 'utf8'));
  idl.address = programId; // a redeploy keeps the same layout, only the address moves
  writeFileSync(idlTarget, `${JSON.stringify(idl, null, 2)}\n`);
  console.log(`idl   : copied ${path.relative(root, idlFrom)} -> src/lib/solana/idl.json`);
} else {
  const current = JSON.parse(readFileSync(idlTarget, 'utf8'));
  current.address = programId;
  writeFileSync(idlTarget, `${JSON.stringify(current, null, 2)}\n`);
  console.log('idl   : no build artifact found, keeping the checked-in IDL');
  console.log('        (download launchpad.json from the Actions run if the program changed)');
  console.log(`        looked in: ${candidates.map((c) => path.relative(root, c)).join(', ')}`);
}

// 2. the env
const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
const lines = existing
  .split(/\r?\n/)
  .filter((line) => line.trim().length > 0 && !line.startsWith('NEXT_PUBLIC_PROGRAM_ID='));
lines.push(`NEXT_PUBLIC_PROGRAM_ID=${programId}`);
if (!lines.some((line) => line.startsWith('NEXT_PUBLIC_TREASURY='))) {
  lines.push('NEXT_PUBLIC_TREASURY=EYB8XKsysDpSkK4PdBg4Rx3EMqY5NJ1LGfmvUdiKkqaQ');
}
writeFileSync(envPath, `${lines.join('\n')}\n`);
console.log('env   : wrote .env.local');

// 3. the IDL must still describe the program source
try {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'gen-idl.mjs'), '--check'], {
    stdio: 'inherit',
  });
} catch {
  console.warn('warning: the checked-in IDL no longer matches programs/launchpad/src');
  console.warn('         run `node scripts/gen-idl.mjs` (or copy target/idl/launchpad.json)');
}

console.log(`\nprogram id: ${programId}`);
console.log('next      : cd app && npm run dev');
console.log(`explorer  : https://explorer.solana.com/address/${programId}?cluster=devnet`);
