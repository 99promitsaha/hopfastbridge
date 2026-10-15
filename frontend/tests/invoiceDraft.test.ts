import test from 'node:test';
import assert from 'node:assert/strict';
import { billingOnly, blankInvoice, invoicePreview, invoiceToday, normalizeBusiness } from '../src/lib/invoiceDraft';
import { invoiceSchema, invoiceTotals } from '../../backend/dist/lib/invoice.js';

test('new invoices use a supplied number and local calendar dates; clients can exist without business setup', () => {
  const date = new Date(2026, 9, 15, 0, 1);
  assert.equal(invoiceToday(date), '2026-10-15');
  assert.equal(blankInvoice('INV-042').number, 'INV-042');
  assert.deepEqual(normalizeBusiness(null).clients, []);
  assert.deepEqual(billingOnly({ name: 'Client', email: 'client@example.com', address: 'Address', id: 'private-id' } as any), { name: 'Client', email: 'client@example.com', address: 'Address' });
});
test('live totals use the same integer rounding, discounts and taxes as saved invoices', () => {
  const draft = { ...blankInvoice(), lines: [{ description: 'Design', quantity: '2.5', rate: '200' }], discount: '10', taxBps: 1800 };
  const result = invoicePreview(draft)!;
  assert.equal(result.subtotal, 500000000n); assert.equal(result.tax, 88200000n); assert.equal(result.total, 578200000n);
  assert.equal(invoicePreview({ ...draft, lines: [{ description: 'Fractional', quantity: '0.001', rate: '0.0005' }], discount: '0', taxBps: 0 }), null);
});
test('incomplete amounts, excessive discounts and scientific notation cannot produce a payable preview', () => {
  const draft = { ...blankInvoice(), lines: [{ description: 'Design', quantity: '1', rate: '100' }] };
  for (const change of [{ lines: [] }, { discount: '101' }, { taxBps: NaN }, { taxBps: -1 }, { taxBps: 10001 }, { lines: [{ description: 'Bad', quantity: '1e3', rate: '1' }] }, { lines: [{ description: 'Bad', quantity: '1', rate: '-1' }] }]) assert.equal(invoicePreview({ ...draft, ...change }), null);
});

test('amount previews agree with server validation across 500 fractional, discount and tax combinations', () => {
  let seed = 15312;
  const next = (maximum: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % maximum; };
  for (let index = 0; index < 500; index++) {
    const draft = { ...blankInvoice('INV-001'), client: { name: 'Client', email: '', address: '' },
      lines: Array.from({ length: next(6) + 1 }, () => ({ description: 'Work', quantity: `${next(100)}.${next(1000).toString().padStart(3, '0')}`, rate: `${next(10000)}.${next(1000000).toString().padStart(6, '0')}` })),
      discount: `${next(500)}.${next(1000000).toString().padStart(6, '0')}`, taxBps: next(10001),
    };
    let saved;
    try { saved = invoiceTotals(invoiceSchema.parse(draft)); } catch { assert.equal(invoicePreview(draft), null); continue; }
    const preview = invoicePreview(draft)!;
    for (const key of ['subtotal', 'discount', 'tax', 'total'] as const) assert.equal(preview[key].toString(), saved[key]);
  }
});
