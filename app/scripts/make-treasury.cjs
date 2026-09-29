const { Keypair } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');
// writes the same JSON keypair format solana-keygen and Anchor expect
const out = process.argv[2] || path.join('..', 'keys', 'treasury.json');
const kp = Keypair.generate();
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(Array.from(kp.secretKey)));
console.log('TREASURY_PUBKEY=' + kp.publicKey.toBase58());
console.log('keypair file   =' + path.resolve(out));
