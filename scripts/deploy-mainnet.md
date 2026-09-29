# Mainnet deployment

Everything here has to run on a machine with the Solana toolchain: `cargo build-sbf`
does **not** run natively on Windows, so use Linux, macOS, or WSL.

## 0. Do not skip the checklist

`SECURITY.md` section 5 is the gate. In particular: an `anchor test` run against
a local validator, an independent review, and a Squads multisig for the platform
authority.

## 1. Reproducible build

```bash
solana-verify build --library-name launchpad
solana-verify get-executable-hash target/deploy/launchpad.so
```

Write the hash down. Everything you deploy from here on must produce the same
hash, otherwise the verification on the explorers will not match.

## 2. Deploy

```bash
solana config set --url https://api.mainnet-beta.solana.com --keypair ~/.config/solana/id.json
solana balance                     # needs ~3 SOL for program rent + fees
anchor build
anchor deploy --provider.cluster mainnet
solana address -k target/deploy/launchpad-keypair.json   # the program id
```

## 3. Publish the source as verified

```bash
solana-verify verify-from-repo \
  --url https://api.mainnet-beta.solana.com \
  --program-id <PROGRAM_ID> \
  --commit-hash "$(git rev-parse HEAD)" \
  --library-name launchpad
```

Once the transaction lands, Solscan, explorer.solana.com and SolanaFM show the
program as **verified build** with a link back to the repository and commit - that
is the "open source" badge on all of them. The GitHub workflow in
`.github/workflows/verify.yml` does the same thing without a local toolchain.

## 4. Initialise the platform

```bash
node scripts/init-config.mjs <PROGRAM_ID> <TREASURY_PUBKEY> 0.02 0
```

`0.02` is the launch fee in SOL and `0` the lottery rollover (the winner takes
the whole pot). The treasury must already exist and be rent exempt.

## 5. Point the app at it

```bash
cd app
cp ../target/idl/launchpad.json src/lib/solana/idl.json   # regenerate the IDL
NEXT_PUBLIC_PROGRAM_ID=<PROGRAM_ID> \
NEXT_PUBLIC_RPC_URL=https://api.mainnet-beta.solana.com \
NEXT_PUBLIC_SOL_PRICE=<price> \
npm run build && npm run start
```

`node ../scripts/gen-idl.mjs --check` fails if the checked-in IDL drifts from the
program source, so run it after every program change.
