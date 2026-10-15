import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import express from 'express';
import mongoose from 'mongoose';
import { build } from '../../frontend/node_modules/esbuild/lib/main.js';

async function freePort() {
  const socket = net.createServer(); socket.listen(0, '127.0.0.1');
  await new Promise(resolve => socket.once('listening', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
}
async function stop(child) {
  if (child && child.exitCode === null && child.signalCode === null) {
    const ended = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await ended;
  }
}

test('production-mode API boots with isolated Mongo; frontend quotes/history, persisted tracking and security middleware work together', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hopfast-release-'));
  let mongo, backend, upstream;
  try {
    const mongoPort = await freePort(), apiPort = await freePort();
    const uri = `mongodb://127.0.0.1:${mongoPort}/release_test`;
    mongo = spawn(process.env.TEST_MONGOD || '/opt/homebrew/bin/mongod', ['--dbpath', directory, '--bind_ip', '127.0.0.1', '--port', String(mongoPort), '--logpath', path.join(directory, 'mongo.log')], { stdio: 'ignore' });
    let spawnError; mongo.on('error', error => { spawnError = error; });
    for (let i = 0; i < 40; i++) {
      if (spawnError) throw spawnError;
      try { await mongoose.connect(uri, { serverSelectionTimeoutMS: 200 }); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.equal(mongoose.connection.readyState, 1);
    const user = '0x' + '1a'.repeat(20), other = '0x' + '2b'.repeat(20);
    const txHash = '0x' + '3c'.repeat(32), receivingHash = '0x' + '4d'.repeat(32);
    const transaction = { from: user, to: other, data: '0x12345678' + user.slice(2).padStart(64, '0'), value: '0x0', chainId: 8453 };
    const provider = express(); provider.use(express.json());
    let receiptStatus = '0x1', alteredTransaction = null;
    const knownHashes = [txHash, '0x' + '5e'.repeat(32), '0x' + '6f'.repeat(32)];
    provider.post('/rpc', (req, res) => {
      const { method, params, id } = req.body;
      const hash = params[0];
      const result = method === 'eth_chainId' ? '0x2105'
        : method === 'eth_getTransactionByHash' ? knownHashes.includes(hash) ? { hash, from: user, to: other, value: '0x0', input: transaction.data, blockNumber: receiptStatus ? '0x1' : null, chainId: '0x2105', ...alteredTransaction } : null
        : method === 'eth_getTransactionReceipt' ? receiptStatus ? { transactionHash: hash, status: receiptStatus, blockHash: '0x' + 'a'.repeat(64) } : null
        : method === 'eth_getBlockByNumber' ? { timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16) } : null;
      res.json({ jsonrpc: '2.0', id, result });
    });
    provider.get('/quote', (_req, res) => res.json({ id: 'local-lifi-quote', tool: 'test-route', estimate: { toAmount: '995000', toAmountMin: '990000', feeCosts: [], gasCosts: [], fromAmountUSD: '1' }, transactionRequest: transaction, diagnostic: 'private-debug-sentinel' }));
    provider.get('/status', (req, res) => {
      assert.equal(req.query.fromChain, '8453'); assert.equal(req.query.toChain, '5042');
      res.json({ status: 'DONE', substatus: 'COMPLETED', sending: { txHash: req.query.txHash }, receiving: { txHash: receivingHash } });
    });
    provider.get('/v2/status', (_req, res) => res.json({ squidTransactionStatus: 'success', toChain: { transactionId: receivingHash } }));
    upstream = provider.listen(0, '127.0.0.1'); await new Promise(resolve => upstream.once('listening', resolve));
    const providerBase = `http://127.0.0.1:${upstream.address().port}`;
    backend = spawn(process.execPath, ['dist/index.js'], { cwd: process.cwd(), stdio: 'ignore', env: {
      ...process.env, NODE_ENV: 'production', PORT: String(apiPort), MONGODB_URI: uri,
      CORS_ORIGIN: 'https://www.hopfast.xyz', APP_BASE_URL: 'https://www.hopfast.xyz',
      PAYMENT_STORE_PATH: path.join(directory, 'payments.json'), ARC_RPC_URL: providerBase,
      SWAP_RPC_URLS: JSON.stringify({ base: providerBase + '/rpc' }),
      LIFI_API_BASE_URL: providerBase, SQUID_API_BASE_URL: providerBase, LIFI_API_KEY: '', LIFI_INTEGRATOR: 'test', LIFI_FEE: '0',
      SQUID_INTEGRATOR_ID: '', RELAY_API_KEY: '', X_CLIENT_ID: '', X_CLIENT_SECRET: '', X_BEARER_TOKEN: '',
      INVOICE_ESCROW_ADDRESS: '', INVOICE_SIGNER_KEY: '', ARCHITECT_ESCROW_ADDRESS: '', ARCHITECT_SIGNER_KEY: '',
    } });
    const base = `http://127.0.0.1:${apiPort}/api`;
    let healthy = false;
    for (let i = 0; i < 60; i++) {
      try { const response = await fetch(base + '/health'); const data = await response.json(); if (data.ok && data.db === 'connected') { healthy = true; break; } } catch {}
      if (backend.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(healthy, 'the real production entry point boots against the temporary database');
    const file = path.join(directory, 'frontend-services.mjs');
    await build({ stdin: { contents: "export * from './src/services/transactionHistoryService.ts'; export * from './src/services/quoteService.ts';", resolveDir: path.resolve('../frontend'), loader: 'ts' }, outfile: file, bundle: true, platform: 'node', format: 'esm', define: { 'import.meta.env': JSON.stringify({ VITE_HOPFAST_API_BASE_URL: base }) } });
    const frontend = await import(file);
    async function request(route, body, headers = {}) {
      const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await response.text(); return { status: response.status, headers: response.headers, text, data: text ? JSON.parse(text) : null };
    }
    let quote;
    await t.test('frontend quote normalization retains destination amounts, executable calldata and issued proof', async () => {
      quote = await frontend.getSwapQuote({ fromChain: 'base', toChain: 'arc', fromTokenSymbol: 'USDC', toTokenSymbol: 'USDC', amount: '1', walletAddress: user }, 'lifi');
      assert.equal(quote.destinationAmount, '0.995'); assert.equal(quote.destinationAmountMin, '0.99');
      assert.equal(quote.transactionRequest.to, other); assert.equal(quote.transactionRequest.data, transaction.data);
      assert.equal(JSON.stringify(quote).includes('private-debug-sentinel'), false);
      assert.ok(quote.historyProof);
    });
    await t.test('recording, provider tracking and reload from Mongo preserve wallet-scoped activity', async () => {
      assert.deepEqual((await request('/wallets', { address: user.toUpperCase().replace('0X', '0x') })).data, { address: user });
      const payload = { userAddress: user, txHash, historyProof: quote.historyProof, quoteId: 'forged-quote', provider: 'squid', fromChain: 'ethereum', toChain: 'base', fromTokenSymbol: 'ETH', toTokenSymbol: 'ETH', amount: '999999', volumeUsd: 999999999, status: 'completed', metadata: { quoteId: 'forged-quote', requestId: 'forged-request', privateNote: 'private-sentinel' } };
      assert.equal((await request('/transactions', { txHash })).status, 400, 'unsigned telemetry cannot write history');
      assert.equal((await request('/swaps', { ...payload, historyProof: payload.historyProof.slice(0, -1) + (payload.historyProof.endsWith('0') ? '1' : '0') })).status, 400);
      assert.equal((await request('/swaps', { ...payload, userAddress: other })).status, 409);
      assert.equal((await request('/swaps', payload)).status, 201);
      const initial = (await frontend.fetchUserTransactionHistory(user))[0];
      assert.equal(initial.txHash, txHash); assert.equal(initial.amount, '1'); assert.equal(initial.provider, 'lifi');
      assert.equal(initial.status, 'submitted'); assert.equal(initial.fromChain, 'base');
      assert.equal((await request('/stats?period=all')).data.swapCount, 0, 'source confirmation alone is not a completed swap');
      const status = await request(`/status?provider=lifi&fromChain=base&toChain=arc&txHash=${txHash}`);
      assert.equal(status.data.status, 'completed'); assert.equal(status.data.receivingTxHash, receivingHash);
      const saved = await mongoose.connection.collection('transactionhistories').findOne({ txHash });
      assert.equal(saved.metadata.statusTracking.receivingTxHash, receivingHash, 'server reconciliation remains stored');
      const records = await frontend.fetchUserTransactionHistory(user);
      assert.equal(records[0].status, 'completed'); assert.equal(records[0]._id, undefined);
      assert.equal(records[0].metadata.quoteId, 'local-lifi-quote'); assert.equal(records[0].metadata.requestId, undefined); assert.equal(records[0].metadata.privateNote, undefined);
      assert.equal(records[0].verification, undefined); assert.equal(records[0].verificationKey, undefined);
      assert.deepEqual(await frontend.fetchUserTransactionHistory(other), []);
      const swaps = await request('/swaps?userAddress=' + user);
      assert.equal(swaps.data.records[0].status, 'completed'); assert.equal(swaps.headers.get('cache-control'), 'no-store');
      const squid = await request(`/status?provider=squid&fromChain=base&toChain=arc&txHash=${txHash}&requestId=local-request`);
      assert.equal(squid.data.status, 'completed');
      const stats = await request('/stats?period=all'); assert.equal(stats.data.swapCount, 1); assert.equal(stats.data.swapVolumeUsd, 1);
      const duplicate = await request('/transactions', payload); assert.equal(duplicate.status, 201); assert.equal(duplicate.data.status, 'completed');
      assert.equal((await request('/stats?period=all')).data.swapCount, 1, 'replay cannot double count or regress status');
      const concurrent = await Promise.all(Array.from({ length: 6 }, () => request('/transactions', { ...payload, txHash: '0x' + '5e'.repeat(32) })));
      assert.ok(concurrent.every(response => response.status === 201), 'concurrent retries return one canonical record');
      assert.equal((await frontend.fetchUserTransactionHistory(user)).length, 2);
      await mongoose.connection.collection('transactionhistories').insertOne({ userAddress: user, txHash: '0x' + '9'.repeat(64), amount: '999999', volumeUsd: 1e12, status: 'completed', fromChain: 'base', createdAt: new Date() });
      assert.equal((await frontend.fetchUserTransactionHistory(user)).length, 2, 'legacy unverified rows are quarantined, not trusted');
      assert.equal((await request('/stats?period=all')).data.swapVolumeUsd, 1, 'legacy forged volumes cannot inflate totals');
    });
    await t.test('source mismatches and fabricated hashes are rejected; pending receipts cannot become settled', async () => {
      const pendingHash = '0x' + '6f'.repeat(32), payload = { userAddress: user, historyProof: quote.historyProof, txHash: pendingHash };
      for (const change of [{ from: other }, { to: user }, { input: transaction.data + 'ff' }, { value: '0x1' }, { chainId: '0x1' }]) {
        alteredTransaction = change;
        assert.equal((await request('/swaps', payload)).status, 409);
      }
      alteredTransaction = null;
      assert.equal((await request('/swaps', { ...payload, txHash: '0x' + '7'.repeat(64) })).status, 425);
      receiptStatus = null;
      assert.equal((await request('/swaps', payload)).status, 201);
      const status = await request(`/status?provider=squid&fromChain=base&toChain=ethereum&txHash=${pendingHash}&requestId=attacker`);
      assert.equal(status.data.status, 'confirming', 'provider success cannot bypass a missing source receipt');
      assert.equal((await request('/stats?period=all')).data.swapCount, 1);
      receiptStatus = '0x1';
      assert.equal((await request(`/status?provider=lifi&fromChain=base&toChain=arc&txHash=${pendingHash}`)).data.status, 'completed');
      assert.equal((await request('/stats?period=all')).data.swapCount, 2);
      assert.equal((await request('/stats?period=all')).data.swapVolumeUsd, 2);
    });
    await t.test('production headers, input bounds, private-tool gating and rate limits remain active', async () => {
      const config = await request('/architects/config', undefined, { Origin: 'https://www.hopfast.xyz' });
      assert.equal(config.headers.get('access-control-allow-origin'), 'https://www.hopfast.xyz');
      assert.equal(config.headers.get('x-content-type-options'), 'nosniff'); assert.equal(config.headers.get('x-powered-by'), null);
      assert.equal(config.data.admin, undefined); assert.equal(config.data.treasury, undefined);
      assert.equal((await request('/architect-deployment')).status, 404);
      assert.equal((await request('/transactions')).status, 400);
      assert.equal((await request('/swaps?userAddress=' + user + '&limit=0')).status, 400);
      assert.equal((await request('/status?txHash=invalid&provider=lifi')).status, 400);
      for (let i = 0; i < 181; i++) {
        const response = await fetch(base + '/unavailable', { headers: { 'X-Forwarded-For': '198.51.100.20' } });
        await response.text(); assert.equal(response.status, i < 180 ? 404 : 429);
      }
      assert.equal((await request('/health', undefined, { 'X-Forwarded-For': '198.51.100.20' })).status, 200, 'health remains reachable when the client is rate-limited');
    });
  } finally {
    await stop(backend); await mongoose.disconnect();
    if (upstream) await new Promise(resolve => upstream.close(resolve));
    await stop(mongo); await rm(directory, { recursive: true, force: true });
  }
});
