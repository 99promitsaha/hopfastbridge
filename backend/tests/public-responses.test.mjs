import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import mongoose from 'mongoose';

const folder = mkdtempSync(join(tmpdir(), 'hopfast-public-api-'));
Object.assign(process.env, {
  NODE_ENV: 'test', PAYMENT_STORE_PATH: join(folder, 'payments.json'),
  ARC_RPC_URL: 'https://rpc.example.test/private-rpc-sentinel',
  ARCHITECT_ESCROW_ADDRESS: '', ARCHITECT_SIGNER_KEY: '', X_CLIENT_ID: '', X_BEARER_TOKEN: '',
  ARCHITECT_ADMIN_ADDRESS: '0x' + 'a'.repeat(40), ARCHITECT_TREASURY_ADDRESS: '0x' + 'b'.repeat(40),
  LIFI_FEE: '0', LIFI_INTEGRATOR: 'test', LIFI_API_KEY: 'private-provider-sentinel',
});
const { publicQuoteResponse, publicHistoryRecord, historyQuerySchema } = await import('../dist/lib/publicResponses.js');
const { TransactionHistory } = await import('../dist/models/TransactionHistory.js');
const { SwapRecord } = await import('../dist/models/SwapRecord.js');
const { Wallet } = await import('../dist/models/Wallet.js');
const routers = await Promise.all(['architects', 'architectDeployment', 'transactions', 'swaps', 'wallets', 'quotes', 'status'].map(async name => (await import(`../dist/routes/${name}.routes.js`)).default));
const user = '0x' + '1'.repeat(40), target = '0x' + '2'.repeat(40), txHash = '0x' + '3'.repeat(64);
const transaction = { from: user, to: target, data: '0x12345678' + user.slice(2).padStart(64, '0'), value: '0x0', chainId: 8453 };

test('quote sanitization drops upstream debug blobs without changing transaction or Relay safety data', () => {
  const quote = { id: 'quote', userSteps: [{ transaction }], order: { payer: user }, context: { recipient: user }, raw: { apiKey: 'private-sentinel' } };
  const response = { provider: 'lifi', quotes: [quote], raw: { diagnostic: 'private-sentinel' } };
  const clean = publicQuoteResponse(response);
  assert.equal(JSON.stringify(clean).includes('private-sentinel'), false);
  assert.deepEqual(clean.quotes[0].userSteps, quote.userSteps);
  assert.deepEqual(clean.quotes[0].order, quote.order); assert.deepEqual(clean.quotes[0].context, quote.context);
  const route = { provider: 'lifi', eligible: true, quote };
  const comparison = publicQuoteResponse({ routes: [route], best: route });
  assert.equal(JSON.stringify(comparison).includes('private-sentinel'), false);
  assert.deepEqual(comparison.best.quote.userSteps[0].transaction, transaction);
  assert.ok(response.raw, 'the internal provider object was not mutated');
});

test('history responses exclude database internals and arbitrary metadata; queries cannot become unlimited', () => {
  const clean = publicHistoryRecord({ userAddress: user, txHash, _id: 'internal-id', __v: 1, accessToken: 'private-sentinel',
    metadata: { quoteId: 'q1', requestId: 'r1', client: { email: 'private@example.com' }, apiKey: 'private-sentinel' } });
  assert.deepEqual(clean.metadata, { quoteId: 'q1', requestId: 'r1' });
  for (const text of ['private-sentinel', 'private@example.com', 'internal-id', '__v']) assert.ok(!JSON.stringify(clean).includes(text));
  for (const query of [{}, { userAddress: { $ne: null } }, ...['0', '-1', 'NaN', 'Infinity', '1.5', '101', '10000000'].map(limit => ({ userAddress: user, limit }))]) assert.equal(historyQuerySchema.safeParse(query).success, false);
  assert.equal(historyQuerySchema.parse({ userAddress: user }).limit, 25);
});

test('public HTTP responses minimize exposure, preserve app history, and contain provider/database failures', async t => {
  const changes = [];
  const stub = (object, key, value) => { changes.push([object, key, object[key]]); object[key] = value; };
  const descriptor = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, get: () => 1 });
  let databaseError = false, calls = [], upstreamFailure = false, upstreamCalls = 0;
  const record = { userAddress: user, txHash, quoteId: 'q1', provider: 'lifi', fromChain: 'base', toChain: 'arc', fromTokenSymbol: 'USDC', toTokenSymbol: 'USDC', amount: '1', status: 'submitted', _id: 'internal-id', __v: 2,
    metadata: { quoteId: 'q1', requestId: 'r1', privateNote: 'private-sentinel' } };
  const find = query => {
    if (databaseError) throw new Error('mongodb://user:private-sentinel@db.example');
    const call = { query }; calls.push(call);
    const chain = { select: projection => { call.projection = projection; return chain; }, sort: () => chain, limit: async limit => { call.limit = limit; return [record]; } }; return chain;
  };
  for (const model of [TransactionHistory, SwapRecord]) {
    stub(model, 'find', find);
    stub(model, 'findOneAndUpdate', async (_query, update) => ({ ...record, ...update.$set }));
  }
  stub(TransactionHistory, 'findOne', () => ({ select: async () => null }));
  stub(SwapRecord, 'create', async input => ({ ...record, ...input }));
  stub(Wallet, 'findOneAndUpdate', async () => ({ address: user, _id: 'private-sentinel', lastSeenAt: new Date(), __v: 1 }));
  const originalFetch = global.fetch, originalError = console.error;
  global.fetch = async () => {
    upstreamCalls++;
    if (upstreamFailure) return new Response('invalid API key private-provider-sentinel; https://rpc.example.test/private-rpc-sentinel', { status: 401 });
    return new Response(JSON.stringify({ id: 'quote', estimate: { toAmount: '100', toAmountMin: '99', feeCosts: [], gasCosts: [], fromAmountUSD: '1' }, transactionRequest: transaction, diagnostic: 'private-upstream-sentinel' }));
  };
  console.error = () => {};
  const app = express(); app.use(express.json()); for (const router of routers) app.use('/api', router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(path, body) {
    const response = await originalFetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const raw = await response.text(); return { status: response.status, body: raw ? JSON.parse(raw) : null, headers: response.headers };
  }
  try {
    await t.test('payment config excludes operational wallets; deployment helper stays unavailable outside development', async () => {
      const result = await request('/architects/config'); assert.equal(result.status, 200);
      assert.equal(result.body.rpcUrl, 'https://rpc.mainnet.arc.io');
      for (const field of ['admin', 'treasury', 'signer', 'authorizationSigner']) assert.equal(result.body[field], undefined);
      assert.equal(JSON.stringify(result.body).includes('sentinel'), false);
      assert.equal((await request('/architect-deployment')).status, 404);
      assert.equal((await request('/architect-deployment/confirm', {})).status, 404);
    });
    await t.test('global history dumps and invalid result caps are rejected before the database', async () => {
      for (const route of ['/transactions', '/swaps']) {
        for (const query of ['', '?userAddress=' + user + '&limit=0', '?userAddress=' + user + '&limit=-10000', '?userAddress=' + user + '&limit=NaN', '?userAddress[$ne]=x']) {
          assert.equal((await request(route + query)).status, 400);
        }
      }
      assert.equal(calls.length, 0);
      for (const route of ['/transactions', '/swaps']) {
        const response = await request(route + '?userAddress=' + user + '&limit=50'); assert.equal(response.status, 200);
        assert.equal(response.body.records[0].txHash, txHash); assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.ok(!JSON.stringify(response.body).includes('private-sentinel')); assert.equal(response.body.records[0]._id, undefined);
        assert.deepEqual(calls.at(-1).query, { userAddress: user, proofVersion: 1 }); assert.equal(calls.at(-1).limit, 50);
      }
    });
    await t.test('unsigned recording is rejected and wallet registration returns no database internals', async () => {
      const result = await request('/swaps', { ...record, metadata: { ...record.metadata, apiKey: 'private-sentinel' } });
      assert.equal(result.status, 400);
      const transaction = await request('/transactions', record); assert.equal(transaction.status, 400);
      assert.ok(!JSON.stringify(transaction.body).includes('private-sentinel'));
      assert.deepEqual((await request('/wallets', { address: user })).body, { address: user });
    });
    const quoteInput = { srcChainKey: 'base', dstChainKey: 'arc', srcTokenAddress: user, dstTokenAddress: target, srcWalletAddress: user, dstWalletAddress: user, amount: '1000000' };
    await t.test('single/comparison quote responses keep executable transactions without upstream debug data', async () => {
      const single = await request('/quotes?provider=lifi', quoteInput); assert.equal(single.status, 200, JSON.stringify(single.body));
      assert.equal(JSON.stringify(single.body).includes('private-upstream-sentinel'), false);
      assert.deepEqual(single.body.quotes[0].userSteps[0].transaction, transaction);
      const comparison = await request('/quotes/compare', { ...quoteInput, providers: ['lifi'] });
      assert.equal(comparison.status, 200); assert.ok(comparison.body.best);
      assert.equal(JSON.stringify(comparison.body).includes('private-upstream-sentinel'), false);
      assert.deepEqual(comparison.body.best.quote.userSteps[0].transaction, transaction);
    });
    await t.test('provider and database failures never disclose raw bodies, URLs or connection strings', async () => {
      upstreamFailure = true;
      const previousMode = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      const quote = await request('/quotes?provider=lifi', quoteInput); assert.equal(quote.status, 400);
      process.env.NODE_ENV = previousMode;
      const status = await request('/status?provider=lifi&txHash=' + txHash + '&fromChain=base&toChain=arc'); assert.equal(status.status, 502);
      for (const response of [quote, status]) { assert.ok(!JSON.stringify(response.body).includes('sentinel')); assert.equal(response.body.detail, undefined); }
      databaseError = true;
      const failed = await request('/transactions?userAddress=' + user); assert.equal(failed.status, 503);
      assert.ok(!JSON.stringify(failed.body).includes('mongodb'));
      databaseError = false;
      const previous = upstreamCalls;
      for (const query of ['txHash=bad&provider=lifi', 'txHash=' + txHash + '&provider=lifi&fromChain=toString']) assert.equal((await request('/status?' + query)).status, 400);
      assert.equal(upstreamCalls, previous, 'invalid status queries do not hit providers');
    });
  } finally {
    await new Promise(resolve => server.close(resolve)); global.fetch = originalFetch; console.error = originalError;
    for (const [object, key, value] of changes) object[key] = value;
    if (descriptor) Object.defineProperty(mongoose.connection, 'readyState', descriptor); else delete mongoose.connection.readyState;
    rmSync(folder, { recursive: true, force: true });
  }
});
