const dns = require('node:dns');
console.log('default order:', dns.getDefaultResultOrder());
async function probe(name, url) {
  const t = Date.now();
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    const text = await r.text();
    console.log(`${name}: ${r.status} in ${Date.now() - t}ms len=${text.length}`);
  } catch (e) {
    console.log(`${name}: FAIL in ${Date.now() - t}ms -> ${e.cause?.code ?? e.name}: ${e.message}`);
  }
}
(async () => {
  await probe('binance  ', 'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT');
  await probe('gecko    ', 'https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1');
  dns.setDefaultResultOrder('ipv4first');
  console.log('--- after forcing ipv4first ---');
  await probe('binance  ', 'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT');
  await probe('gecko    ', 'https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1');
})();
