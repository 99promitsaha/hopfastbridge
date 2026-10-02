import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import ganache from 'ganache';
import express from '../../backend/node_modules/express/index.js';
import mongoose from '../../backend/node_modules/mongoose/index.js';
import { BrowserProvider, ContractFactory, Contract, Wallet, keccak256, toUtf8Bytes } from 'ethers';
test('invoice API and Mongo verify publish, funding, release, full recovery and cancellation expiry onchain', async () => {
  const chain = ganache.server({ logging: { quiet: true }, chain: { chainId: 5042 } });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hopfast-invoice-e2e-'));
  let mongo, server;
  try {
    await chain.listen(0, '127.0.0.1');
    const provider = new BrowserProvider(chain.provider); provider.pollingInterval = 10;
    const [admin, issuer, payer] = await Promise.all([0, 1, 2].map(i => provider.getSigner(i)));
    const signer = Wallet.createRandom();
    const build = name => JSON.parse(fs.readFileSync(`artifacts/${name}.json`));
    const tb = build('MockUSDC'), eb = build('InvoiceEscrow');
    const mock = await new ContractFactory(tb.abi, tb.evm.bytecode.object, admin).deploy(); await mock.waitForDeployment();
    const tokenAddress = '0x3600000000000000000000000000000000000000';
    await provider.send('evm_setAccountCode', [tokenAddress, await provider.getCode(await mock.getAddress())]);
    const token = new Contract(tokenAddress, tb.abi, admin);
    const escrow = await new ContractFactory(eb.abi, eb.evm.bytecode.object, admin).deploy(tokenAddress, await admin.getAddress(), await admin.getAddress(), signer.address); await escrow.waitForDeployment();
    await (await token.mint(await payer.getAddress(), 1000000000n)).wait(); await (await token.connect(payer).approve(await escrow.getAddress(), 1000000000n)).wait();
    Object.assign(process.env, { NODE_ENV: 'test', APP_BASE_URL: 'https://www.hopfast.xyz', ARC_RPC_URL: `http://127.0.0.1:${chain.address().port}`, ARCHITECT_CHAIN_ID: '5042', INVOICE_ESCROW_ADDRESS: await escrow.getAddress(), INVOICE_SIGNER_KEY: signer.privateKey, INVOICE_ADMIN_ADDRESS: await admin.getAddress(), INVOICE_TREASURY_ADDRESS: await admin.getAddress() });
    const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await new Promise(r => socket.once('listening', r)); const port = socket.address().port; await new Promise(r => socket.close(r));
    mongo = spawn(process.env.TEST_MONGOD || '/opt/homebrew/bin/mongod', ['--dbpath', directory, '--bind_ip', '127.0.0.1', '--port', String(port), '--logpath', path.join(directory, 'mongo.log')], { stdio: 'ignore' });
    let spawnError; mongo.on('error', e => { spawnError = e; });
    let connected = false;
    for (let i = 0; i < 40; i++) { if (spawnError) throw spawnError; try { await mongoose.connect(`mongodb://127.0.0.1:${port}/invoices`, { serverSelectionTimeoutMS: 200 }); connected = true; break; } catch { await new Promise(r => setTimeout(r, 100)); } }
    assert.ok(connected);
    const { Invoice, InvoiceBusiness } = await import('../../backend/dist/models/Invoice.js');
    const { PaymentProfile } = await import('../../backend/dist/models/ArchitectEnvelope.js');
    const { default: routes } = await import('../../backend/dist/routes/invoices.routes.js');
    await Promise.all([Invoice.init(), InvoiceBusiness.init()]);
    await PaymentProfile.create({ wallet: (await issuer.getAddress()).toLowerCase(), handle: 'freelancer', xId: '123456' });
    const app = express(); app.use(express.json()); app.use('/api', routes); server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}/api/invoices`;
    async function request(route, session = '', body, method) { const response = await fetch(base + route, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); const result = await response.json(); assert.ok(response.status < 300, JSON.stringify(result)); return result; }
    async function login(account) { const wallet = new Wallet(chain.provider.getInitialAccounts()[(await account.getAddress()).toLowerCase()].secretKey); const c = await request('/challenge', '', { wallet: wallet.address }); return (await request('/session', '', { nonce: c.nonce, signature: await wallet.signMessage(c.message) })).session; }
    const is = await login(issuer), ps = await login(payer), ads = await login(admin);
    await request('/business', is, { name: 'Freelancer', email: '', address: 'Billing address', clients: [] }, 'PUT');
    const input = { number: 'INV-001', client: { name: 'Client' }, issueDate: '2026-10-02', dueDate: '2026-10-30', lines: [{ description: 'Development', quantity: '1', rate: '100' }] };
    async function publish(number) { const { invoice: d } = await request('', is, { ...input, number }); const { invoice } = await request(`/${d.invoiceId}/publish`, is, {}); assert.match(invoice.url, /^https:\/\/www\.hopfast\.xyz\/\?invoice=/); return invoice; }
    const authorize = invoice => request(`/${invoice.invoiceId}/authorize`, ps, {});
    async function fund(invoice, a) { const tx = await escrow.connect(payer).pay(a.invoiceId, a.issuer, BigInt(a.amount), a.detailsHash, a.deadline, a.signature); await tx.wait(); return (await request(`/${invoice.invoiceId}/confirm`, ps, { txHash: tx.hash })).invoice; }
    const first = await publish('INV-001'); assert.equal((await fund(first, await authorize(first))).state, 'funded'); assert.equal(await token.balanceOf(await admin.getAddress()), 0n);
    const tx = await escrow.connect(issuer).release(first.invoiceId); await tx.wait(); assert.equal((await request(`/${first.invoiceId}/confirm`, is, { txHash: tx.hash })).invoice.state, 'paid'); assert.equal(await token.balanceOf(await issuer.getAddress()), 99500000n); assert.equal(await token.balanceOf(await admin.getAddress()), 500000n);
    const second = await publish('INV-002'); await fund(second, await authorize(second)); const recovery = await escrow.recover(second.invoiceId, await payer.getAddress(), keccak256(toUtf8Bytes('Client refund'))); await recovery.wait(); assert.equal((await request(`/${second.invoiceId}/confirm`, ads, { txHash: recovery.hash })).invoice.state, 'recovered'); assert.equal(await escrow.totalEscrow(), 0n);
    const third = await publish('INV-003'), intent = await authorize(third); assert.equal((await request(`/${third.invoiceId}/cancel`, is, {})).invoice.state, 'cancelling'); assert.equal((await fund(third, intent)).state, 'funded');
    const fourth = await publish('INV-004'); await authorize(fourth); await request(`/${fourth.invoiceId}/cancel`, is, {}); await provider.send('evm_increaseTime', [121]); await provider.send('evm_mine', []); assert.equal((await request(`/${fourth.invoiceId}`)).invoice.state, 'cancelled');
    assert.equal((await request('/mine', is)).invoices.length, 4); assert.equal((await request('/admin', ads)).invoices.length, 4);
  } finally {
    if (server) await new Promise(r => server.close(r)); await mongoose.disconnect();
    if (mongo && mongo.exitCode === null) { const ended = new Promise(r => mongo.once('exit', r)); mongo.kill('SIGTERM'); await ended; }
    await chain.close(); await rm(directory, { recursive: true, force: true });
  }
});
