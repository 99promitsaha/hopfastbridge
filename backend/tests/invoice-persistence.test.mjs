import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
const { Invoice, InvoiceBusiness } = await import('../dist/models/Invoice.js');
const { invoiceSchema, invoiceTotals } = await import('../dist/lib/invoice.js');

const executable = process.env.TEST_MONGOD || '/opt/homebrew/bin/mongod';
test('invoice and private client-book persistence survives reconnect; stale writes cannot resurrect cancelled drafts', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hopfast-invoice-db-'));
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await new Promise(resolve => socket.once('listening', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const process = spawn(executable, ['--dbpath', directory, '--bind_ip', '127.0.0.1', '--port', String(port), '--logpath', path.join(directory, 'mongo.log')], { stdio: 'ignore' });
  let spawnError; process.on('error', error => { spawnError = error; });
  const uri = `mongodb://127.0.0.1:${port}/invoice_tests`;
  try {
    let connected = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (spawnError) throw spawnError;
      try { await mongoose.connect(uri, { serverSelectionTimeoutMS: 200 }); connected = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(connected, 'isolated MongoDB started');
    await Promise.all([Invoice.init(), InvoiceBusiness.init()]);
    const owner = '0x' + '11'.repeat(20), invoiceId = '0x' + '22'.repeat(32);
    const input = invoiceSchema.parse({ number: 'INV-001', client: { name: 'Client' }, issueDate: '2026-10-02', dueDate: '2026-10-30', lines: [{ description: 'Design', quantity: '2', rate: '150' }] });
    const details = { name: 'Freelancer', email: 'me@example.com', address: 'Billing address', clients: [{ id: 'd7393f3c-a45c-4ed9-bdc1-d52b9fcd436c', name: 'Client', email: '', address: '' }] };
    await InvoiceBusiness.create({ owner, details });
    await Invoice.create({ owner, invoiceId, input, totals: invoiceTotals(input) });
    await mongoose.disconnect();
    await mongoose.connect(uri);
    assert.equal((await InvoiceBusiness.findOne({ owner })).details.clients[0].name, 'Client');
    assert.equal((await Invoice.findOne({ invoiceId })).totals.total, '300000000');
    await assert.rejects(Invoice.create({ owner, invoiceId, input, totals: invoiceTotals(input) }), /duplicate key/);
    const stale = await Invoice.findOne({ invoiceId });
    await Invoice.findOneAndUpdate({ invoiceId, state: 'draft' }, { $set: { state: 'cancelled' }, $inc: { __v: 1 } });
    stale.state = 'open';
    await assert.rejects(stale.save(), /version/);
    assert.equal((await Invoice.findOne({ invoiceId })).state, 'cancelled');
  } finally {
    await mongoose.disconnect();
    if (process.exitCode === null && !spawnError) { const ended = new Promise(resolve => process.once('exit', resolve)); process.kill('SIGTERM'); await ended; }
    await rm(directory, { recursive: true, force: true });
  }
});
