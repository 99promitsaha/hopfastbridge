import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const folder = mkdtempSync(join(tmpdir(), 'hopfast-payments-'));
process.env.PAYMENT_STORE_PATH = join(folder, 'payments.json');
process.env.ARC_RPC_URL = 'http://127.0.0.1:12345';
process.env.APP_BASE_URL = 'http://localhost:5173';
const store = await import('../dist/lib/paymentStore.js');
const { parseUsdc, formatUsdc } = await import('../dist/lib/arc.js');
const { compareRoutes } = await import('../dist/lib/routeComparison.js');
const payer = '0x' + '1'.repeat(40), recipient = '0x' + '2'.repeat(40);
const txHash = '0x' + 'a'.repeat(64);
const input = { walletAddress: payer, recipient, amount: '1.000000000000000001' };
const quote = (output, fee = '1', minimum = output) => ({ id: 'q1', dstAmount: output, dstAmountMin: minimum, feeUsd: fee, duration: { estimated: '15000' }, userSteps: [{ transaction: { to: recipient, data: '0x1234' } }] });
const create = () => store.createPayment(input);
const fetchOriginal = global.fetch;
let rpc = {};
global.fetch = async (_url, options) => {
  const { method } = JSON.parse(options.body);
  if (rpc[method] instanceof Error) throw rpc[method];
  assert.ok(method in rpc, 'Unexpected RPC method: ' + method);
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: rpc[method] }));
};
after(() => { global.fetch = fetchOriginal; rmSync(folder, { recursive: true, force: true }); });

test('native Arc amount conversion is exact at 18 decimals', () => {
  assert.equal(parseUsdc(input.amount), 1000000000000000001n);
  assert.equal(formatUsdc(parseUsdc(input.amount)), input.amount);
  for (const value of ['0', '-1', '1e3', '1.0000000000000000001', 'NaN', '']) assert.throws(() => parseUsdc(value));
});
test('comparison keeps precision beyond Number.MAX_SAFE_INTEGER and tolerates provider failure', async () => {
  const request = async p => ({ provider: p, quotes: [quote(p === 'lifi' ? '9007199254740993' : '9007199254740992')] });
  const ranked = await compareRoutes(request, ['squid', 'lifi'], {});
  assert.equal(ranked.best.provider, 'lifi');
  const partial = await compareRoutes(async p => {
    if (p === 'squid') throw new Error('offline');
    return request(p);
  }, ['squid', 'lifi'], {});
  assert.equal(partial.best.provider, 'lifi'); assert.equal(partial.unavailable[0].provider, 'squid');
});
test('comparison excludes routes violating fee, duration or guaranteed-output constraints', async () => {
  const result = await compareRoutes(async p => ({ provider: p, quotes: [quote('100', '2', '90')] }), ['lifi'], { maxFeeUsd: 1, maxEtaSeconds: 10, minDestinationAmount: '95' });
  assert.equal(result.best, null); assert.equal(result.routes[0].reasons.length, 3);
});
test('comparison rejects missing fee estimates and empty transaction steps', async () => {
  const result = await compareRoutes(async p => ({ provider: p, quotes: [{ ...quote('100'), feeUsd: 'unknown', userSteps: [] }] }), ['lifi'], {});
  assert.equal(result.best, null);
});
test('review link uses a fragment token, hides token hashes, and rejects other tokens', () => {
  const result = create();
  const url = new URL(result.reviewUrl);
  assert.equal(url.hash, '#' + result.accessToken);
  assert.equal(url.searchParams.get('payment'), result.payment.id);
  assert.equal(result.payment.tokenHash, undefined);
  assert.equal(store.getPayment(result.payment.id, '0'.repeat(64)), undefined);
  assert.equal(store.getPayment('__proto__', '0'.repeat(64)), undefined);
});
test('rejects zero recipients', () => assert.throws(() => store.createPayment({ ...input, recipient: '0x' + '0'.repeat(40) })));
test('expired and cancelled requests cannot be signed anew', () => {
  let result = create(); const payment = store.getPayment(result.payment.id, result.accessToken);
  payment.expiresAt = new Date(0).toISOString();
  assert.equal(store.getPayment(payment.id, result.accessToken).status, 'expired');
  result = create(); const cancelled = store.getPayment(result.payment.id, result.accessToken);
  store.cancelPayment(cancelled); assert.equal(cancelled.status, 'cancelled'); assert.throws(() => store.cancelPayment(cancelled));
});
test('payment survives a new API process without plaintext tokens', () => {
  const result = create();
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `const s = await import('./dist/lib/paymentStore.js'); const p = s.getPayment('${result.payment.id}', '${result.accessToken}'); if (!p || p.status !== 'awaiting_approval') process.exit(1);`], { cwd: process.cwd(), env: process.env });
  assert.equal(child.status, 0, child.stderr.toString());
});
test('does not accept a transaction from another payer or on another network', async () => {
  const result = create(), payment = store.getPayment(result.payment.id, result.accessToken);
  rpc = { eth_chainId: '0x13b2', eth_getTransactionByHash: { from: recipient, to: recipient, value: '0x' + BigInt(payment.value).toString(16), input: '0x', chainId: '0x13b2', hash: txHash } };
  await assert.rejects(store.submitPayment(payment, txHash), /does not match/);
  rpc.eth_chainId = '0x1'; await assert.rejects(store.submitPayment(payment, txHash), /not Arc/);
  assert.equal(payment.status, 'awaiting_approval');
});
test('receipt verification completes a matching payment; repeat submission is idempotent', async () => {
  const result = create(), payment = store.getPayment(result.payment.id, result.accessToken);
  rpc = { eth_chainId: '0x13b2', eth_getTransactionByHash: { from: payer, to: recipient, value: '0x' + BigInt(payment.value).toString(16), input: '0x', chainId: '0x13b2', hash: txHash, blockNumber: '0x1' }, eth_getBlockByNumber: { timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16) }, eth_getTransactionReceipt: { status: '0x1', transactionHash: txHash, blockHash: '0x' + 'b'.repeat(64) } };
  await store.submitPayment(payment, txHash); assert.equal(payment.status, 'completed');
  await store.submitPayment(payment, txHash); assert.equal(payment.status, 'completed');
  const duplicate = create();
  const duplicatePayment = store.getPayment(duplicate.payment.id, duplicate.accessToken);
  // Keep the duplicate request within the mocked block's second so this test
  // exercises transaction reuse rather than depending on the wall-clock boundary.
  duplicatePayment.createdAt = payment.createdAt;
  await assert.rejects(store.submitPayment(duplicatePayment, txHash), /already recorded/);
});
test('RPC outages keep submitted payments unknown rather than failed', async () => {
  const result = create(), payment = store.getPayment(result.payment.id, result.accessToken);
  payment.status = 'submitted'; payment.txHash = '0x' + 'c'.repeat(64);
  rpc = { eth_chainId: new Error('offline') };
  await store.refreshPayment(payment); assert.equal(payment.status, 'submitted'); assert.match(payment.trackingMessage, /unknown/);
});
test('a reverted matching payment is reported as failed', async () => {
  const result = create(), payment = store.getPayment(result.payment.id, result.accessToken), hash = '0x' + 'd'.repeat(64);
  rpc = { eth_chainId: '0x13b2', eth_getTransactionByHash: { from: payer, to: recipient, value: '0x' + BigInt(payment.value).toString(16), input: '0x', chainId: '0x13b2', hash }, eth_getTransactionReceipt: { status: '0x0', transactionHash: hash, blockHash: '0x' + 'e'.repeat(64) } };
  await store.submitPayment(payment, hash); assert.equal(payment.status, 'failed');
});


test('rejects malformed transaction steps and blank fee estimates', async () => {
  for (const q of [{ ...quote('100'), userSteps: [{}] }, { ...quote('100'), feeUsd: '' }]) {
    const result = await compareRoutes(async p => ({ provider: p, quotes: [q] }), ['lifi'], {});
    assert.equal(result.best, null);
  }
});
test('rejects historical payments and records an already-broadcast payment after link expiry', async () => {
  const result = create(), payment = store.getPayment(result.payment.id, result.accessToken), hash = '0x' + 'e'.repeat(64);
  rpc = { eth_chainId: '0x13b2', eth_getTransactionByHash: { from: payer, to: recipient, value: '0x' + BigInt(payment.value).toString(16), input: '0x', chainId: '0x13b2', hash, blockNumber: '0x1' }, eth_getBlockByNumber: { timestamp: '0x1' }, eth_getTransactionReceipt: null };
  await assert.rejects(store.submitPayment(payment, hash), /predates/);
  payment.expiresAt = new Date(0).toISOString(); store.getPayment(payment.id, result.accessToken);
  rpc.eth_getBlockByNumber.timestamp = '0x' + Math.floor(Date.now() / 1000).toString(16);
  await store.submitPayment(payment, hash); assert.equal(payment.status, 'submitted');
});
