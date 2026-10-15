import type { Billing, Business, InvoiceInput } from '../services/invoiceService';

export const emptyBilling: Billing = { name: '', email: '', address: '' };
export const billingOnly = ({ name, email, address }: Billing): Billing => ({ name, email, address });
export function normalizeBusiness(details: Business | null): Business {
  return { ...emptyBilling, ...details, clients: details?.clients ?? [] };
}
export function invoiceToday(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function blankInvoice(number = ''): InvoiceInput {
  return { number, client: { ...emptyBilling }, issueDate: invoiceToday(), dueDate: invoiceToday(), lines: [{ description: '', quantity: '1', rate: '' }], discount: '0', taxBps: 0, notes: '' };
}

/** Mirrors checkout arithmetic in integer units; never uses float money maths. */
export function invoicePreview(input: InvoiceInput) {
  const money = /^\d{1,7}(?:\.\d{1,6})?$/;
  const quantity = /^\d{1,5}(?:\.\d{1,3})?$/;
  const units = (value: string, decimals: number) => {
    const [whole, part = ''] = value.split('.');
    return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(part.padEnd(decimals, '0'));
  };
  if (!input.lines.length || input.lines.length > 50 || !money.test(input.discount) || !Number.isInteger(input.taxBps) || input.taxBps < 0 || input.taxBps > 10000) return null;
  let subtotal = 0n;
  for (const line of input.lines) {
    if (!quantity.test(line.quantity) || !money.test(line.rate)) return null;
    const q = units(line.quantity, 3), rate = units(line.rate, 6);
    if (q <= 0n || rate <= 0n) return null;
    subtotal += (q * rate + 500n) / 1000n;
  }
  const discount = units(input.discount, 6);
  if (discount > subtotal) return null;
  const tax = ((subtotal - discount) * BigInt(input.taxBps) + 5000n) / 10000n;
  const total = subtotal - discount + tax;
  if (total < 2n || total > 1000000000000n) return null;
  return { subtotal, discount, tax, total };
}
