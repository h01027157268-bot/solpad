#!/usr/bin/env node
/**
 * Convert a wallet secret into the JSON keypair format the Solana CLI expects.
 *
 *   node scripts/base58-to-keypair.mjs <base58-or-json-array> <output-path>
 *
 * Phantom / Solflare / Backpack export a base58 string; `solana-keygen` and
 * Anchor want a JSON array of 64 bytes. This accepts either, so a secret can be
 * pasted straight out of a wallet into GitHub without any local tooling.
 */

import { writeFileSync } from 'node:fs';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function decodeBase58(value) {
  const bytes = [0];
  for (const char of value) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`not base58: "${char}"`);
    let carry = index;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of value) {
    if (char !== '1') break;
    bytes.push(0);
  }
  return Buffer.from(bytes.reverse());
}

const [secret, out] = process.argv.slice(2);
if (!secret || !out) {
  console.error('usage: node scripts/base58-to-keypair.mjs <base58-or-json-array> <output-path>');
  process.exit(1);
}

let key;
const trimmed = secret.trim();
if (trimmed.startsWith('[')) {
  key = JSON.parse(trimmed);
} else {
  key = Array.from(decodeBase58(trimmed));
}
if (!Array.isArray(key) || (key.length !== 64 && key.length !== 32)) {
  console.error(`expected a 64 byte secret key (or a 32 byte seed), got ${key?.length}`);
  process.exit(1);
}
writeFileSync(out, JSON.stringify(key));
console.log(`wrote ${key.length} byte keypair to ${out}`);
