/**
 * Bundles the launchpad test suites with esbuild and runs them on node.
 *
 *   npm test               # everything
 *   npm run test:economics # tax engine, curve, dividends, lottery maths
 *   npm run test:market    # full market engine integration
 */

import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const SUITES = {
  economics: 'scripts/economics.test.ts',
  market: 'scripts/market.test.ts',
};

const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const names = requested.length > 0 ? requested : Object.keys(SUITES);

mkdirSync('.tmp-test', { recursive: true });

let failed = 0;
for (const name of names) {
  const entry = SUITES[name];
  if (!entry) {
    console.error(`unknown suite: ${name} (expected one of ${Object.keys(SUITES).join(', ')})`);
    failed++;
    continue;
  }
  const outfile = path.join('.tmp-test', `${name}.cjs`);
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    logLevel: 'error',
  });
  console.log(`\n=== ${name} ===`);
  const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit' });
  if (result.status !== 0) failed++;
}

process.exit(failed === 0 ? 0 : 1);
