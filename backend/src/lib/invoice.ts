import { z } from 'zod';
import { keccak256, stringToHex } from 'viem';

const text = (length: number) => z.string().trim().max(length);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, 'Invalid date');
export const billingSchema = z.object({ name: text(160).min(1), email: z.union([z.literal(''), z.string().email().max(254)]).default(''), address: text(800).default('') });
export const businessSchema = billingSchema.extend({ clients: z.array(billingSchema.extend({ id: z.string().uuid() })).max(100).default([]) }).refine(value => new Set(value.clients.map(client => client.id)).size === value.clients.length, 'Client IDs must be unique');
const money = z.string().regex(/^\d{1,7}(?:\.\d{1,6})?$/);
export const invoiceSchema = z.object({
  number: text(60).min(1), client: billingSchema,
  issueDate: date, dueDate: date,
  lines: z.array(z.object({ description: text(500).min(1), quantity: z.string().regex(/^\d{1,5}(?:\.\d{1,3})?$/), rate: money })).min(1).max(50),
  discount: money.default('0'), taxBps: z.number().int().min(0).max(10000).default(0), notes: text(2000).default(''),
}).refine(v => v.dueDate >= v.issueDate, 'Due date must follow issue date');
export type InvoiceInput = z.infer<typeof invoiceSchema>;
function units(value: string, decimals: number) { const [whole, part = ''] = value.split('.'); return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(part.padEnd(decimals, '0')); }
export function invoiceTotals(input: InvoiceInput) {
  const lineTotals = input.lines.map(line => {
    const quantity = units(line.quantity, 3), rate = units(line.rate, 6);
    if (quantity <= 0n || rate <= 0n) throw new Error('Each line needs a positive quantity and rate.');
    return (quantity * rate + 500n) / 1000n;
  });
  const subtotal = lineTotals.reduce((sum, value) => sum + value, 0n);
  const discount = units(input.discount, 6);
  if (discount > subtotal) throw new Error('Discount exceeds the invoice subtotal.');
  const tax = ((subtotal - discount) * BigInt(input.taxBps) + 5000n) / 10000n;
  const total = subtotal - discount + tax;
  if (total < 2n || total > 1_000_000_000_000n) throw new Error('Invoice total must be positive and at most 1,000,000 USDC.');
  return { lineTotals: lineTotals.map(String), subtotal: String(subtotal), discount: String(discount), tax: String(tax), total: String(total) };
}
export function invoiceDetailsHash(details: unknown) { return keccak256(stringToHex(JSON.stringify(details))); }
export const invoicePaymentTypes = { InvoicePayment: [
  { name: 'invoiceId', type: 'bytes32' }, { name: 'issuer', type: 'address' }, { name: 'payer', type: 'address' },
  { name: 'amount', type: 'uint256' }, { name: 'detailsHash', type: 'bytes32' }, { name: 'deadline', type: 'uint256' },
] } as const;
