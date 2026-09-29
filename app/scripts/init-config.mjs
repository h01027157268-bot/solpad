#!/usr/bin/env node
/**
 * Initialise the platform config on a deployed program.
 *
 *   npm run init-config -- <programId> [treasury] [feeSol] [rolloverBps]
 *
 * Reads the keypair from ANCHOR_WALLET (default ~/.config/solana/id.json) and the
 * RPC from ANCHOR_PROVIDER_URL (default devnet). The treasury defaults to
 * NEXT_PUBLIC_TREASURY, i.e. the platform vault every trade pays 1% into.
 */

import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import anchor from '@coral-xyz/anchor';
import web3 from '@solana/web3.js';

const { AnchorProvider, Program, BN, Wallet } = anchor;
const { Connection, Keypair, PublicKey } = web3;

const here = path.dirname(fileURLToPath(import.meta.url));
const idlPath = path.join(here, '..', 'src', 'lib', 'solana', 'idl.json');

const [
  programId,
  treasury = process.env.NEXT_PUBLIC_TREASURY,
  feeSol = '0.02',
  rolloverBps = '0',
] = process.argv.slice(2);

if (!programId || !treasury) {
  console.error(
    `usage: npm run init-config -- <programId> [treasury=${process.env.NEXT_PUBLIC_TREASURY ?? 'none'}] [feeSol] [rolloverBps]`,
  );
  process.exit(1);
}

const rpc =
  process.env.ANCHOR_PROVIDER_URL ??
  process.env.NEXT_PUBLIC_RPC_URL ??
  'https://api.devnet.solana.com';
const keypairPath =
  process.env.ANCHOR_WALLET ?? path.join(os.homedir(), '.config', 'solana', 'id.json');

const idl = JSON.parse(readFileSync(idlPath, 'utf8'));
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, 'utf8'))));
const connection = new Connection(rpc, 'confirmed');
const provider = new AnchorProvider(connection, new Wallet(payer), { commitment: 'confirmed' });
const program = new Program({ ...idl, address: programId }, provider);

const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId);
const treasuryKey = new PublicKey(treasury);

const existing = await connection.getAccountInfo(config);
if (existing) {
  const decoded = program.coder.accounts.decode('config', existing.data);
  console.log('config already initialised:');
  console.log('  authority:', decoded.authority.toBase58());
  console.log('  treasury :', decoded.treasury.toBase58());
  console.log('  launches :', decoded.totalLaunches.toString());
  process.exit(0);
}

const treasuryBalance = await connection.getBalance(treasuryKey);
if (treasuryBalance < 1_000_000) {
  console.error(
    `the treasury (${treasury}) holds ${treasuryBalance} lamports; it needs at least 0.001 SOL to be rent exempt.\n` +
      `fund it first, e.g.  solana airdrop 1 ${treasury}   (devnet)`,
  );
  process.exit(1);
}

const signature = await program.methods
  .initializeConfig({
    treasury: treasuryKey,
    creationFeeLamports: new BN(Math.round(Number(feeSol) * 1e9)),
    defaultEntropySource: { slotHashes: {} },
  })
  .accounts({
    authority: payer.publicKey,
    config,
    treasury: treasuryKey,
    systemProgram: web3.SystemProgram.programId,
  })
  .rpc();

console.log('config  :', config.toBase58());
console.log('treasury:', treasury);
console.log('launch fee:', feeSol, 'SOL   rollover:', rolloverBps, 'bps');
console.log('tx      :', signature);
console.log(`\nexplorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
