import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function scenario(source, limits = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'hopfast-payment-bounds-'));
  try {
    const child = spawnSync(process.execPath, ['--input-type=module', '-'], {
      cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'test', PAYMENT_STORE_PATH: join(directory, 'payments.json'),
        PAYMENT_MAX_RECORDS: '10000', PAYMENT_MAX_STORE_BYTES: '8388608', PAYMENT_MAX_ACTIVE: '500', PAYMENT_MAX_ACTIVE_PER_WALLET: '20', PAYMENT_CREATION_PER_MINUTE: '60', PAYMENT_CREATION_PER_HOUR: '300', ...limits },
      input: `import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
const store = await import('./dist/lib/paymentStore.js');
const payer = '0x' + '1'.repeat(40), other = '0x' + '2'.repeat(40), recipient = '0x' + '3'.repeat(40);
const input = { walletAddress: payer, recipient, amount: '1' };
${source}`,
    });
    assert.equal(child.status, 0, child.stderr.toString());
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
test('unpaid requests have per-wallet and global active caps; expiration frees active capacity without deleting requests', () => scenario(`
const first = store.createPayment(input), second = store.createPayment(input);
assert.throws(() => store.createPayment(input), error => error.status === 429);
const third = store.createPayment({ ...input, walletAddress: other });
assert.throws(() => store.createPayment({ ...input, walletAddress: recipient }), error => error.status === 429);
store.getPayment(first.payment.id, first.accessToken).expiresAt = new Date(0).toISOString();
store.createPayment(input);
assert.ok(store.getPayment(first.payment.id, first.accessToken));
assert.ok(store.getPayment(second.payment.id, second.accessToken));
assert.ok(store.getPayment(third.payment.id, third.accessToken));
`, { PAYMENT_MAX_ACTIVE_PER_WALLET: '2', PAYMENT_MAX_ACTIVE: '3' }));
test('global minute/hour creation quotas survive a process restart and cannot be bypassed with new wallet addresses', () => {
  for (const limits of [{ PAYMENT_CREATION_PER_MINUTE: '2' }, { PAYMENT_CREATION_PER_HOUR: '2' }]) scenario(`
store.createPayment(input); store.createPayment({ ...input, walletAddress: other });
const child = spawnSync(process.execPath, ['--input-type=module', '-e', "const s=await import('./dist/lib/paymentStore.js');try{s.createPayment({walletAddress:'${'0x' + '4'.repeat(40)}',recipient:'${'0x' + '3'.repeat(40)}',amount:'1'});process.exit(1)}catch(e){if(e.status!==429)process.exit(2)}"], { env: process.env });
assert.equal(child.status, 0, child.stderr.toString());
`, limits);
});
test('record/byte capacity stops only new creation; existing requests remain readable and cancellable', () => {
  for (const limits of [{ PAYMENT_MAX_RECORDS: '1' }, { PAYMENT_MAX_STORE_BYTES: '2000' }]) scenario(`
const first = store.createPayment(input);
const before = readFileSync(process.env.PAYMENT_STORE_PATH, 'utf8');
assert.throws(() => store.createPayment(input), error => error.status === 503);
assert.equal(readFileSync(process.env.PAYMENT_STORE_PATH, 'utf8'), before);
const saved = store.getPayment(first.payment.id, first.accessToken);
store.cancelPayment(saved);
assert.equal(store.getPayment(first.payment.id, first.accessToken).status, 'cancelled');
assert.equal(store.paymentsBySender(payer).length, 1);
`, limits);
});
test('failed persistence does not consume quota or leave phantom requests and does not disclose disk paths', () => scenario(`
mkdirSync(process.env.PAYMENT_STORE_PATH + '.tmp');
assert.throws(() => store.createPayment(input), error => error.status === 503 && !error.message.includes(process.env.PAYMENT_STORE_PATH));
assert.equal(store.paymentsBySender(payer).length, 0);
rmSync(process.env.PAYMENT_STORE_PATH + '.tmp', { recursive: true });
store.createPayment(input);
assert.equal(store.paymentsBySender(payer).length, 1);
`, { PAYMENT_CREATION_PER_MINUTE: '1' }));
test('a payment broadcast before capacity is reached can still be recorded and reconciled at capacity', () => scenario(`
const first = store.createPayment(input), payment = store.getPayment(first.payment.id, first.accessToken);
assert.throws(() => store.createPayment(input), error => error.status === 503);
const txHash = '0x' + 'a'.repeat(64);
global.fetch = async (_url, options) => {
  const { method } = JSON.parse(options.body);
  const result = method === 'eth_chainId' ? '0x13b2'
    : method === 'eth_getTransactionByHash' ? { hash: txHash, from: payer, to: recipient, input: '0x', value: '0xde0b6b3a7640000', chainId: '0x13b2' }
    : { status: '0x1', transactionHash: txHash, blockHash: '0x' + 'b'.repeat(64) };
  return new Response(JSON.stringify({ result }));
};
await store.submitPayment(payment, txHash);
assert.equal(store.getPayment(first.payment.id, first.accessToken).status, 'completed');
assert.deepEqual(store.settledPaymentStats(), { count: 1, volumeUsd: 1 });
`, { PAYMENT_MAX_RECORDS: '1' }));
