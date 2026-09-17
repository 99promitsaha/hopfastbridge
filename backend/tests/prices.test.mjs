import test from 'node:test';
import assert from 'node:assert/strict';
process.env.COINGECKO_API_KEY = 'test-server-price-key';
process.env.CMC_API_KEY = '';
const { getTokenPrices } = await import('../dist/lib/tokenPrices.js');
test('price proxy uses a server header, filters invalid prices and caches concurrent requests', async () => {
  const original = global.fetch;
  let calls = 0;
  global.fetch = async (url, options) => {
    calls++;
    assert.ok(!url.includes('test-server-price-key'));
    assert.equal(options.headers['x-cg-demo-api-key'], 'test-server-price-key');
    return new Response(JSON.stringify({ ethereum: { usd: 3000 }, weth: { usd: 'bad' } }));
  };
  try {
    const [a, b] = await Promise.all([getTokenPrices(), getTokenPrices()]);
    assert.equal(a.ETH, 3000); assert.equal(a.WETH, undefined); assert.deepEqual(a, b);
    await getTokenPrices(); assert.equal(calls, 1);
  } finally { global.fetch = original; }
});
