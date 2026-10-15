import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import express from 'express';
import mongoose from 'mongoose';
import { privateKeyToAccount } from 'viem/accounts';

process.env.NODE_ENV = 'test';
process.env.ARC_RPC_URL = 'http://127.0.0.1:12345';
process.env.INVOICE_ESCROW_ADDRESS = '';
process.env.INVOICE_SIGNER_KEY = '';
const { Invoice, InvoiceBusiness, InvoiceSequence } = await import('../dist/models/Invoice.js');
const { ArchitectAuth } = await import('../dist/models/ArchitectEnvelope.js');
const { invoiceTotals, invoiceSchema } = await import('../dist/lib/invoice.js');
const { default: routes } = await import('../dist/routes/invoices.routes.js');

const input = { number: 'INV-001', client: { name: 'Original client', email: 'client@example.com', address: 'Original address' }, issueDate: '2026-10-15', dueDate: '2026-10-30', lines: [{ description: 'Consulting', quantity: '2.5', rate: '100' }], discount: '0', taxBps: 0, notes: '' };

test('invoice workspace persists clients independently, preserves snapshots and allocates owner-scoped numbers', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hopfast-workflow-db-'));
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await new Promise(resolve => socket.once('listening', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const mongo = spawn(process.env.TEST_MONGOD || '/opt/homebrew/bin/mongod', ['--dbpath', directory, '--bind_ip', '127.0.0.1', '--port', String(port), '--logpath', path.join(directory, 'mongo.log')], { stdio: 'ignore' });
  let spawnError, server;
  mongo.on('error', error => { spawnError = error; });
  const a = privateKeyToAccount('0x' + '33'.repeat(32)), b = privateKeyToAccount('0x' + '44'.repeat(32));
  const ownerA = a.address.toLowerCase(), ownerB = b.address.toLowerCase();
  try {
    let connected = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (spawnError) throw spawnError;
      try { await mongoose.connect(`mongodb://127.0.0.1:${port}/workflow_tests`, { serverSelectionTimeoutMS: 200 }); connected = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(connected, 'isolated MongoDB started');
    await Promise.all([Invoice.init(), InvoiceBusiness.init(), InvoiceSequence.init(), ArchitectAuth.init()]);
    // Separate test cases use distinct simulated clients; each still exercises
    // the production 60/minute limiter, including an explicit throttling case.
    let requestGroup = 1;
    const app = express(); app.set('trust proxy', 'loopback'); app.use(express.json({ limit: '64kb' })); app.use('/api', routes);
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/invoices`;
    async function request(route, session = '', body, method) {
      const response = await fetch(base + route, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `192.0.2.${requestGroup}`, ...(session ? { Authorization: `Bearer ${session}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json(), headers: response.headers };
    }
    async function login(account) {
      const { body: challenge } = await request('/challenge', '', { wallet: account.address });
      const signature = await account.signMessage({ message: challenge.message });
      const result = await request('/session', '', { nonce: challenge.nonce, signature });
      assert.equal(result.status, 200); return result.body.session;
    }
    const sessionA = await login(a), sessionB = await login(b);
    const client = { id: randomUUID(), name: 'Original client', email: 'client@example.com', address: 'Original address' };

    await t.test('clients save before business setup, reload immediately and remain private', async () => {
      assert.notEqual((await request('/clients', '', client)).status, 201);
      const saved = await request('/clients', sessionA, client);
      assert.equal(saved.status, 201, JSON.stringify(saved.body));
      assert.equal(saved.body.details.clients[0].id, client.id);
      assert.equal(saved.body.details.name, '');
      const workspace = await request('/workspace', sessionA);
      assert.equal(workspace.status, 200); assert.equal(workspace.body.details.clients[0].email, client.email);
      assert.equal(workspace.body.handle, null);
      assert.equal((await request('/workspace', sessionB)).body.details, null);
      assert.equal((await request('/clients/' + client.id, sessionB, { name: 'Hijacked' }, 'PUT')).status, 404);
      assert.equal((await request('/clients/' + client.id, sessionB, undefined, 'DELETE')).status, 404);
      assert.equal((await request('/clients', sessionA, client)).status, 409);
      assert.equal((await request('/clients', sessionA, { name: 'Invalid', email: 'not-an-email' })).status, 400);
    });
    let invoiceId;
    await t.test('business edits preserve clients and saved invoices retain client snapshots', async () => {
      const results = await Promise.all([
        request('/business', sessionA, { name: 'Freelancer', email: 'me@example.com', address: 'Business address' }, 'PUT'),
        request('/clients', sessionA, { id: randomUUID(), name: 'Second client', email: '', address: '' }),
      ]);
      assert.ok(results.every(result => result.status === 200 || result.status === 201), JSON.stringify(results));
      const workspace = await request('/workspace', sessionA);
      assert.equal(workspace.body.details.name, 'Freelancer'); assert.equal(workspace.body.details.clients.length, 2);
      const created = await request('', sessionA, { ...input, autoNumber: true });
      assert.equal(created.status, 201, JSON.stringify(created.body)); invoiceId = created.body.invoice.invoiceId;
      assert.equal(created.body.invoice.input.number, 'INV-001');
      assert.equal((await request('/clients/' + client.id, sessionA, { name: 'Renamed client', email: 'new@example.com', address: 'New address' }, 'PUT')).status, 200);
      assert.equal((await request('/clients/' + client.id, sessionA, undefined, 'DELETE')).status, 200);
      const reloaded = await Invoice.findOne({ invoiceId });
      assert.deepEqual(reloaded.input.client, input.client);
      assert.equal(reloaded.billing.name, 'Freelancer');
      assert.equal((await request('/business', sessionA)).body.details.clients.some(c => c.id === client.id), false);
    });
    requestGroup++;
    await t.test('older full-profile saves cannot erase current clients or resurrect deleted ones', async () => {
      const stale = (await request('/business', sessionA)).body.details;
      const added = await request('/clients', sessionA, { name: 'Keep this client' });
      assert.equal(added.status, 201);
      const overwrite = await request('/business', sessionA, { ...stale, name: 'Stale profile' }, 'PUT');
      assert.equal(overwrite.status, 409);
      assert.equal((await request('/business', sessionA)).body.details.clients.length, added.body.details.clients.length);
      const current = (await request('/business', sessionA)).body.details;
      assert.equal((await request('/business', sessionA, current, 'PUT')).status, 200, 'unchanged legacy client lists remain compatible');
      assert.equal((await request('/clients/' + added.body.client.id, sessionA, undefined, 'DELETE')).status, 200);
      assert.equal((await request('/business', sessionA, current, 'PUT')).status, 409);
      assert.ok(!(await request('/business', sessionA)).body.details.clients.some(c => c.id === added.body.client.id));
    });
    requestGroup++;
    await t.test('business-only saves work without an existing record or clients array', async () => {
      const result = await request('/business', sessionB, { name: 'Other freelancer', email: '', address: '' }, 'PUT');
      assert.equal(result.status, 200, JSON.stringify(result.body)); assert.deepEqual(result.body.details.clients, []);
      assert.equal((await request('/clients', sessionB, { name: 'New contact', email: '', address: '' })).status, 201);
      assert.equal((await request('/workspace', sessionB)).body.details.clients.length, 1);
    });
    await t.test('number suggestions use full history, concurrent saves are distinct and wallets are isolated', async () => {
      const parsed = invoiceSchema.parse(input);
      await Invoice.insertMany(Array.from({ length: 23 }, (_, i) => ({ owner: ownerA, invoiceId: '0x' + randomBytes(32).toString('hex'), input: { ...parsed, number: `INV-${String(i + 20).padStart(3, '0')}` }, totals: invoiceTotals(parsed) })));
      assert.equal((await request('/workspace', sessionA)).body.nextNumber, 'INV-043');
      const results = await Promise.all(Array.from({ length: 3 }, () => request('', sessionA, { ...input, number: 'INV-043', autoNumber: true })));
      assert.ok(results.every(result => result.status === 201), JSON.stringify(results));
      const numbers = results.map(result => result.body.invoice.input.number).sort();
      assert.deepEqual(numbers, ['INV-043', 'INV-044', 'INV-045']);
      assert.equal((await request('/workspace', sessionB)).body.nextNumber, 'INV-001');
      assert.equal((await request('', sessionA, { ...input, number: 'INV-045' })).status, 409);
      const manual = await request('', sessionA, { ...input, number: 'INV-080' });
      assert.equal(manual.status, 201);
      await Invoice.deleteOne({ invoiceId: manual.body.invoice.invoiceId });
      assert.equal((await request('/workspace', sessionA)).body.nextNumber, 'INV-081');
    });
    requestGroup++;
    await t.test('simultaneous custom-number creates and edits cannot produce duplicate references', async () => {
      const same = await Promise.all([request('', sessionA, { ...input, number: 'CUSTOM-01' }), request('', sessionA, { ...input, number: 'CUSTOM-01' })]);
      assert.deepEqual(same.map(r => r.status).sort(), [201, 409]);
      assert.equal(await Invoice.countDocuments({ owner: ownerA, 'input.number': 'CUSTOM-01' }), 1);
      assert.equal((await request('', sessionA, { ...input, number: 'custom-01' })).status, 409);
      assert.equal((await request('', sessionB, { ...input, number: 'CUSTOM-01' })).status, 201, 'other wallets may use the same number');
      const drafts = await Promise.all(['EDIT-A', 'EDIT-B'].map(number => request('', sessionA, { ...input, number })));
      assert.ok(drafts.every(r => r.status === 201));
      const edits = await Promise.all(drafts.map(r => request('/' + r.body.invoice.invoiceId, sessionA, { ...input, number: 'SHARED-EDIT' }, 'PUT')));
      assert.deepEqual(edits.map(r => r.status).sort(), [200, 409]);
      assert.equal(await Invoice.countDocuments({ owner: ownerA, 'input.number': 'SHARED-EDIT' }), 1);
      assert.equal((await request('/' + invoiceId, sessionA, { ...input, number: 'INV-020' }, 'PUT')).status, 409, 'legacy numbers also remain protected');
      const editId = drafts[0].body.invoice.invoiceId;
      assert.equal((await request('/' + editId, sessionA, { ...input, number: 'INV-200' }, 'PUT')).status, 200);
      assert.equal((await request('/workspace', sessionA)).body.nextNumber, 'INV-201');
      const mixed = await Promise.all([
        request('', sessionA, { ...input, number: 'INV-201' }),
        request('', sessionA, { ...input, number: 'INV-201', autoNumber: true }),
      ]);
      assert.ok(mixed.every(r => r.status === 201 || r.status === 409), JSON.stringify(mixed));
      assert.equal(mixed[1].status, 201, 'automatic numbering retries a conflict');
      const duplicates = await Invoice.aggregate([{ $match: { owner: ownerA } }, { $group: { _id: '$input.number', count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }]);
      assert.deepEqual(duplicates, []);
      const literal = 'CUSTOM-[a-z]+($)';
      assert.equal((await request('', sessionA, { ...input, number: literal })).status, 201);
      assert.equal((await request('', sessionA, { ...input, number: literal })).status, 409, 'regex characters are literal');
    });
    requestGroup++;
    await t.test('new management endpoints require live signed sessions and isolate both reads and writes by wallet', async () => {
      const expired = 'ee'.repeat(32);
      await ArchitectAuth.create({ kind: 'invoice_session', wallet: ownerA, tokenHash: (await import('node:crypto')).createHash('sha256').update(expired).digest('hex'), expiresAt: new Date(0) });
      const before = (await request('/business', sessionA)).body.details;
      for (const session of ['', 'ff'.repeat(32), expired]) {
        for (const [route, body, method] of [
          ['/workspace'], ['/business'], ['/business', { name: 'Attack' }, 'PUT'], ['/clients', { name: 'Attack' }],
          ['/clients/' + before.clients[0].id, { name: 'Attack' }, 'PUT'], ['/clients/' + before.clients[0].id, undefined, 'DELETE'],
        ]) assert.equal((await request(route, session, body, method)).status, 409);
      }
      assert.deepEqual((await request('/business', sessionA)).body.details, before);
      assert.equal((await request('/' + invoiceId, sessionB, { ...input, number: 'HIJACKED' }, 'PUT')).status, 409);
      assert.notEqual((await request('/' + invoiceId + '/cancel', sessionB, {})).status, 200);
      assert.equal((await request('/admin', sessionB)).status, 403);
      assert.equal((await request('/' + invoiceId)).status, 404, 'drafts are never public');
      for (const route of ['/workspace', '/business', '/mine']) assert.equal((await request(route, sessionA)).headers.get('cache-control'), 'no-store');
    });
    requestGroup++;
    await t.test('injected operators, invalid IDs, oversized fields and overposted ownership never cross the validation boundary', async () => {
      const before = (await request('/business', sessionA)).body.details;
      for (const body of [{ name: { $ne: null } }, { name: 'x'.repeat(161) }, { name: 'Client', email: 'bad' }, { name: 'Client', address: 'x'.repeat(801) }, { id: { $ne: null }, name: 'Client' }, { id: 'not-a-uuid', name: 'Client' }, []]) {
        assert.equal((await request('/clients', sessionA, body)).status, 400, JSON.stringify(body));
      }
      assert.equal((await request('/clients/not-a-uuid', sessionA, { name: 'Attack' }, 'PUT')).status, 400);
      assert.equal((await request('/clients/not-a-uuid', sessionA, undefined, 'DELETE')).status, 400);
      assert.equal((await request('/business', sessionA, { name: { $ne: null } }, 'PUT')).status, 400);
      assert.deepEqual((await request('/business', sessionA)).body.details, before);
      const created = await request('/clients', sessionA, { name: '<img src=x onerror=alert(1)>', email: '  trimmed@example.com  ', owner: ownerB, '$set': { 'details.name': 'Injected' }, clients: [] });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal(created.body.client.email, 'trimmed@example.com');
      assert.equal(created.body.client.owner, undefined); assert.equal(created.body.client.$set, undefined);
      assert.equal(created.body.details.name, before.name);
      assert.equal((await request('/business', sessionB)).body.details.clients.some(c => c.id === created.body.client.id), false);
      for (const body of [{ ...input, autoNumber: 'true' }, { ...input, number: { $ne: null } }, { ...input, lines: [{ description: 'Bad', quantity: '-1', rate: '1' }] }]) assert.equal((await request('', sessionA, body)).status, 400);
      const forged = await request('', sessionA, { ...input, number: 'OVERPOST', owner: ownerB, state: 'paid', totals: { total: '1' }, contract: ownerB, billing: { name: 'Attack' } });
      assert.equal(forged.status, 201); assert.equal(forged.body.invoice.owner, ownerA); assert.equal(forged.body.invoice.state, 'draft');
      assert.equal(forged.body.invoice.totals.total, '250000000'); assert.equal(forged.body.invoice.contract, undefined); assert.equal(forged.body.invoice.billing.name, before.name);
      const immutableId = forged.body.invoice.invoiceId;
      await Invoice.updateOne({ invoiceId: immutableId }, { $set: { state: 'paid' } });
      assert.equal((await request('/' + immutableId, sessionA, { ...input, number: 'TAMPERED' }, 'PUT')).status, 409);
      assert.equal((await Invoice.findOne({ invoiceId: immutableId })).input.number, 'OVERPOST');
    });
    requestGroup++;
    await t.test('client count is capped atomically, and deleting one frees a slot', async () => {
      const clients = Array.from({ length: 100 }, (_, i) => ({ id: randomUUID(), name: `Client ${i}`, email: '', address: '' }));
      await InvoiceBusiness.updateOne({ owner: ownerB }, { $set: { 'details.clients': clients } });
      assert.equal((await request('/clients', sessionB, { name: 'Overflow' })).status, 409);
      assert.equal((await request('/clients/' + clients[0].id, sessionB, undefined, 'DELETE')).status, 200);
      const results = await Promise.all([request('/clients', sessionB, { name: 'Final slot A' }), request('/clients', sessionB, { name: 'Final slot B' })]);
      assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
      assert.equal((await InvoiceBusiness.findOne({ owner: ownerB })).details.clients.length, 100);
    });
    requestGroup++;
    await t.test('repeated requests are throttled without exposing data', async () => {
      for (let i = 0; i < 60; i++) assert.equal((await request('/workspace', sessionA)).status, 200);
      const blocked = await request('/workspace', sessionA);
      assert.equal(blocked.status, 429); assert.match(blocked.body.error, /Too many/); assert.equal(blocked.body.details, undefined);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
    if (mongo.exitCode === null && !spawnError) { const ended = new Promise(resolve => mongo.once('exit', resolve)); mongo.kill('SIGTERM'); await ended; }
    await rm(directory, { recursive: true, force: true });
  }
});
