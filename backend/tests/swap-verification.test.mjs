import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../frontend/node_modules/esbuild/lib/main.js';
process.env.NODE_ENV = 'test';
process.env.HISTORY_SIGNING_SECRET = '1'.repeat(64);
const { issueHistoryProof, readHistoryProof, verifySource, swapChains } = await import('../dist/lib/swapVerification.js');
const payer = '0x' + '1'.repeat(40), recipient = '0x' + '2'.repeat(40), hash = '0x' + '3'.repeat(64);
const payload = { srcChainKey: 'base', dstChainKey: 'arc', srcTokenAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', dstTokenAddress: '0x3600000000000000000000000000000000000000', srcWalletAddress: payer, amount: '1000000' };
const tx = { to: recipient, data: '0x12345678', value: '0' };
const quote = { id: 'quote-1', raw: { estimate: { fromAmountUSD: '1' } }, userSteps: [{ type: 'TRANSACTION', transaction: tx }] };
test('backend history asset decimals and symbols exactly match every frontend chain/token', async () => {
  const bundle = await build({ entryPoints: ['../frontend/src/lib/chains.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
  const { CHAINS } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  assert.deepEqual(Object.values(swapChains), CHAINS.map(({ key, chainId, tokens }) => ({ key, chainId, tokens: tokens.map(({ address, symbol, decimals }) => ({ address: address.toLowerCase(), symbol, decimals })) })));
});
test('issued proofs preserve canonical wallet, route, exact units and upstream valuation without exposing signing material', () => {
  const encoded = issueHistoryProof('lifi', payload, quote), proof = readHistoryProof(encoded);
  assert.equal(proof.amount, '1'); assert.equal(proof.volumeUsd, 1); assert.equal(proof.fromTokenSymbol, 'USDC'); assert.equal(proof.userAddress, payer);
  assert.equal(encoded.includes(process.env.HISTORY_SIGNING_SECRET), false);
  assert.equal(readHistoryProof(issueHistoryProof('lifi', { ...payload, amount: '1' }, quote)).amount, '0.000001');
  assert.equal(issueHistoryProof('lifi', { ...payload, srcTokenAddress: recipient }, quote), undefined);
  assert.equal(readHistoryProof(issueHistoryProof('lifi', payload, { ...quote, raw: {} })).volumeUsd, null, 'missing price never falls back to browser volume');
});
test('proof mutation, forged signatures, oversized and malformed proofs fail closed', () => {
  const token = issueHistoryProof('lifi', payload, quote), [body, signature] = token.split('.');
  const fields = JSON.parse(Buffer.from(body, 'base64url'));
  for (const change of [{ userAddress: recipient }, { volumeUsd: 1e12 }, { amount: '9999' }, { provider: 'relay' }, { expiresAt: Date.now() + 1e12 }]) {
    const forged = Buffer.from(JSON.stringify({ ...fields, ...change })).toString('base64url') + '.' + signature;
    assert.throws(() => readHistoryProof(forged));
  }
  for (const forged of ['', 'x'.repeat(4097), token + '.x', body + '.' + '0'.repeat(64)]) assert.throws(() => readHistoryProof(forged));
  const now = Date.now;
  try { Date.now = () => now() + 8 * 86400000; assert.throws(() => readHistoryProof(token), /expired/); }
  finally { Date.now = now; }
});
test('source proof requires the real wallet/target/input/value/hash/network and accepts only the exact Base attribution suffix', async () => {
  const original = global.fetch;
  let actual = { hash, from: payer, to: recipient, input: tx.data, value: '0x0', chainId: '0x2105' }, receipt = null, chain = '0x2105';
  global.fetch = async (_url, options) => {
    const { method } = JSON.parse(options.body);
    const result = method === 'eth_chainId' ? chain : method === 'eth_getTransactionByHash' ? actual : receipt;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
  };
  const proof = readHistoryProof(issueHistoryProof('lifi', payload, quote));
  try {
    assert.equal((await verifySource(proof, hash)).sourceConfirmed, false);
    const correct = { ...actual };
    for (const change of [{ from: recipient }, { to: payer }, { input: '0x1234567899' }, { value: '0x1' }, { hash: '0x' + '4'.repeat(64) }, { chainId: '0x1' }]) {
      actual = { ...correct, ...change }; await assert.rejects(verifySource(proof, hash));
    }
    actual = { ...correct, input: tx.data + Buffer.from('bc_52mjdvpq').toString('hex') + '0b00' + '80218021802180218021802180218021' };
    assert.equal((await verifySource(proof, hash)).sourceConfirmed, false);
    receipt = { status: '0x1', transactionHash: hash, blockHash: '0x' + 'a'.repeat(64) };
    assert.equal((await verifySource(proof, hash)).sourceConfirmed, true);
    receipt.transactionHash = '0x' + 'b'.repeat(64); await assert.rejects(verifySource(proof, hash));
    chain = '0x1'; await assert.rejects(verifySource(proof, hash));
  } finally { global.fetch = original; }
});
test('source RPC verification has a global concurrency bound and releases capacity after completion', async () => {
  const original = global.fetch;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  global.fetch = async (_url, options) => {
    await gate;
    const { method } = JSON.parse(options.body);
    const result = method === 'eth_chainId' ? '0x2105' : method === 'eth_getTransactionByHash' ? { hash, from: payer, to: recipient, input: tx.data, value: '0x0' } : null;
    return new Response(JSON.stringify({ result }));
  };
  const proof = readHistoryProof(issueHistoryProof('lifi', payload, quote));
  try {
    const waiting = Array.from({ length: 32 }, () => verifySource(proof, hash));
    await assert.rejects(verifySource(proof, hash), error => error.status === 503);
    release(); await Promise.all(waiting);
    await verifySource(proof, hash);
  } finally { release(); global.fetch = original; }
});
