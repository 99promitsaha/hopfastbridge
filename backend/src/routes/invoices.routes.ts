import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { createPublicClient, decodeEventLog, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { env } from '../config/env.js';
import { isDatabaseReady } from '../config/db.js';
import { authenticate } from './architects.routes.js';
import { ArchitectAuth, PaymentProfile } from '../models/ArchitectEnvelope.js';
import { Invoice, InvoiceBusiness } from '../models/Invoice.js';
import { businessSchema, invoiceSchema, invoiceTotals, invoiceDetailsHash, invoicePaymentTypes } from '../lib/invoice.js';
import artifact from '../contracts/InvoiceEscrow.json' with { type: 'json' };

const router = Router();
const client = createPublicClient({ transport: http(env.ARC_RPC_URL, { timeout: 10000, retryCount: 1 }) });
const token = '0x3600000000000000000000000000000000000000';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const idSchema = z.string().regex(/^0x[0-9a-f]{64}$/);
const txSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const wrap = (handler: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response, _next: NextFunction) => {
  try { await handler(req, res); } catch (error) {
    const message = error instanceof z.ZodError ? 'Check the invoice fields and try again.' : error instanceof Error ? error.message : 'Invoice action failed.';
    res.status(error instanceof z.ZodError ? 400 : 409).json({ error: message.length < 180 && !/rpc|http|mongo|private|key|signature=/i.test(message) ? message : 'This invoice action is temporarily unavailable. Please retry.' });
  }
};
router.use('/invoices', rateLimit({ windowMs: 60000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many invoice requests. Please wait a minute.' } }), (_req, res, next) => {
  if (!isDatabaseReady()) return res.status(503).json({ error: 'Invoices are temporarily unavailable.' });
  next();
});
async function owner(req: Request) {
  const bearer = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!bearer) throw new Error('Unlock invoices with your wallet.');
  const session = await ArchitectAuth.findOne({ kind: 'invoice_session', tokenHash: digest(bearer), expiresAt: { $gt: new Date() } });
  if (!session?.wallet) throw new Error('Your invoice session expired. Unlock it again.');
  return session.wallet;
}
let checkedUntil = 0;
async function escrow() {
  if (!env.INVOICE_ESCROW_ADDRESS || !env.INVOICE_SIGNER_KEY) throw new Error('Invoice checkout is awaiting contract configuration.');
  if (Date.now() >= checkedUntil) {
    const read = (name: string) => client.readContract({ address: env.INVOICE_ESCROW_ADDRESS as Address, abi: artifact.abi, functionName: name });
    const [chain, actualToken, treasury, signer, admin, bps, paused] = await Promise.all([client.getChainId(), read('usdc'), read('treasury'), read('authorizationSigner'), read('owner'), read('FEE_BPS'), read('paused')]);
    if (chain !== env.ARCHITECT_CHAIN_ID || String(actualToken).toLowerCase() !== token.toLowerCase() || String(treasury).toLowerCase() !== env.INVOICE_TREASURY_ADDRESS.toLowerCase() || String(admin).toLowerCase() !== env.INVOICE_ADMIN_ADDRESS.toLowerCase() || String(signer).toLowerCase() !== privateKeyToAccount(env.INVOICE_SIGNER_KEY as Hex).address.toLowerCase() || bps !== 50n || paused) throw new Error('Invoice checkout configuration does not match the deployed contract.');
    checkedUntil = Date.now() + 15000;
  }
  return env.INVOICE_ESCROW_ADDRESS as Address;
}
function output(doc: any) {
  return { invoiceId: doc.invoiceId, owner: doc.owner, handle: doc.handle, state: doc.state, input: doc.input, billing: doc.billing, totals: doc.totals, detailsHash: doc.detailsHash, contract: doc.contract, payer: doc.payer, fundedTx: doc.fundedTx, settlementTx: doc.settlementTx,
    url: doc.handle ? `${env.APP_BASE_URL.replace(/\/$/, '')}/?invoice=${doc.invoiceId}&issuer=${encodeURIComponent(doc.handle)}` : undefined };
}
async function sync(doc: any) {
  if (!doc.contract || ['draft', 'paid', 'recovered'].includes(doc.state)) return doc;
  if (await client.getChainId() !== env.ARCHITECT_CHAIN_ID) throw new Error('Invoice network mismatch.');
  const value = await client.readContract({ address: doc.contract as Address, abi: artifact.abi, functionName: 'invoices', args: [doc.invoiceId] }) as readonly [Address, Address, bigint, Hex, number];
  if (value[4] > 0) {
    if (value[0].toLowerCase() !== doc.owner || value[2].toString() !== doc.totals.total || value[3] !== doc.detailsHash) throw new Error('Invoice settlement does not match the published details.');
    const state = ({ 1: 'funded', 2: 'paid', 3: 'recovered' } as Record<number, string>)[value[4]];
    // Never regress a terminal state when two RPC reads finish out of order.
    await Invoice.updateOne({ _id: doc._id, state: { $nin: ['paid', 'recovered'] } }, { $set: { state, payer: value[1].toLowerCase() } });
  } else if (doc.state === 'cancelling' && Number((await client.getBlock()).timestamp) > doc.authorizationUntil) {
    await Invoice.updateOne({ _id: doc._id, state: 'cancelling' }, { $set: { state: 'cancelled' } });
  }
  return await Invoice.findById(doc._id);
}
router.get('/invoices/config', wrap(async (_req, res) => { res.json({ configured: Boolean(env.INVOICE_ESCROW_ADDRESS && env.INVOICE_SIGNER_KEY), contract: env.INVOICE_ESCROW_ADDRESS, admin: env.INVOICE_ADMIN_ADDRESS, chainId: env.ARCHITECT_CHAIN_ID, rpcUrl: env.ARC_RPC_URL }); }));
router.post('/invoices/challenge', wrap(async (req, res) => {
  const wallet = z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine(v => !/^0x0{40}$/i.test(v)).parse(req.body.wallet).toLowerCase();
  const nonce = randomBytes(32).toString('hex');
  const message = `Hopfast Invoices\nOrigin: ${env.APP_BASE_URL}\nChain: ${env.ARCHITECT_CHAIN_ID}\nWallet: ${wallet}\nNonce: ${nonce}\nExpires: ${new Date(Date.now() + 300000).toISOString()}\nUnlock invoice management. No funds are transferred.`;
  await ArchitectAuth.create({ kind: 'invoice_challenge', wallet, message, tokenHash: digest(nonce), expiresAt: new Date(Date.now() + 300000) });
  res.json({ nonce, message });
}));
router.post('/invoices/session', wrap(async (req, res) => {
  const wallet = await authenticate(req.body, 'invoice_challenge'); const session = randomBytes(32).toString('hex');
  await ArchitectAuth.create({ kind: 'invoice_session', wallet, tokenHash: digest(session), expiresAt: new Date(Date.now() + 3600000) });
  res.json({ session });
}));
router.get('/invoices/business', wrap(async (req, res) => { const wallet = await owner(req); res.json({ details: (await InvoiceBusiness.findOne({ owner: wallet }))?.details ?? null }); }));
router.put('/invoices/business', wrap(async (req, res) => { const wallet = await owner(req), details = businessSchema.parse(req.body); await InvoiceBusiness.findOneAndUpdate({ owner: wallet }, { details }, { upsert: true }); res.json({ details }); }));
router.get('/invoices/mine', wrap(async (req, res) => {
  const wallet = await owner(req);
  const page = z.coerce.number().int().min(0).max(10000).parse(req.query.page ?? 0);
  const docs = await Invoice.find({ owner: wallet }).sort({ createdAt: -1 }).skip(page * 20).limit(20);
  const invoices = []; for (const doc of docs) invoices.push(output(await sync(doc)));
  res.json({ invoices, page, hasMore: docs.length === 20 });
}));
router.get('/invoices/admin', wrap(async (req, res) => {
  if ((await owner(req)) !== env.INVOICE_ADMIN_ADDRESS.toLowerCase()) return res.status(403).json({ error: 'Administrator access required.' });
  const page = z.coerce.number().int().min(0).max(10000).parse(req.query.page ?? 0);
  const docs = await Invoice.find({ handle: { $exists: true }, state: { $in: ['open', 'cancelling', 'cancelled', 'funded', 'paid', 'recovered'] } }).sort({ createdAt: -1 }).skip(page * 20).limit(20);
  const invoices = []; for (const doc of docs) invoices.push(output(await sync(doc)));
  res.json({ invoices, page, hasMore: docs.length === 20 });
}));
router.post('/invoices', wrap(async (req, res) => {
  const wallet = await owner(req), input = invoiceSchema.parse(req.body), totals = invoiceTotals(input);
  const business = await InvoiceBusiness.findOne({ owner: wallet });
  const billing = business ? { name: business.details.name, email: business.details.email, address: business.details.address } : undefined;
  const doc = await Invoice.create({ owner: wallet, invoiceId: `0x${randomBytes(32).toString('hex')}`, input, totals, billing });
  res.status(201).json({ invoice: output(doc) });
}));
router.put('/invoices/:id', wrap(async (req, res) => {
  const wallet = await owner(req), input = invoiceSchema.parse(req.body), totals = invoiceTotals(input);
  const doc = await Invoice.findOneAndUpdate({ invoiceId: idSchema.parse(req.params.id), owner: wallet, state: 'draft' }, { $set: { input, totals }, $inc: { __v: 1 } }, { new: true });
  if (!doc) throw new Error('Only your unpublished drafts can be edited.');
  res.json({ invoice: output(doc) });
}));
router.get('/invoices/:id', wrap(async (req, res) => {
  let doc = await Invoice.findOne({ invoiceId: idSchema.parse(req.params.id) });
  if (!doc || !doc.handle || doc.state === 'draft') return res.status(404).json({ error: 'Invoice not found.' });
  doc = await sync(doc); res.json({ invoice: output(doc) });
}));
router.post('/invoices/:id/publish', wrap(async (req, res) => {
  const wallet = await owner(req), doc = await Invoice.findOne({ invoiceId: idSchema.parse(req.params.id), owner: wallet, state: 'draft' });
  if (!doc) throw new Error('This draft is unavailable.');
  const profile = await PaymentProfile.findOne({ wallet });
  if (!profile) throw new Error('Create your Hopfast ID in Receive before sharing an invoice.');
  const business = await InvoiceBusiness.findOne({ owner: wallet });
  if (!business) throw new Error('Save your billing details first.');
  doc.handle = profile.handle; doc.billing = { name: business.details.name, email: business.details.email, address: business.details.address };
  doc.contract = env.INVOICE_ESCROW_ADDRESS?.toLowerCase();
  if (!doc.contract) throw new Error('Publishing is awaiting invoice contract configuration. Your draft is saved.');
  await escrow();
  doc.detailsHash = invoiceDetailsHash({ invoiceId: doc.invoiceId, issuer: wallet, handle: doc.handle, billing: doc.billing, input: doc.input, totals: doc.totals });
  doc.state = 'open'; await doc.save(); res.json({ invoice: output(doc) });
}));
router.post('/invoices/:id/cancel', wrap(async (req, res) => {
  const wallet = await owner(req), doc = await Invoice.findOneAndUpdate({ invoiceId: idSchema.parse(req.params.id), owner: wallet, state: { $in: ['draft', 'open'] } }, { $set: { state: 'cancelling' }, $inc: { __v: 1 } }, { new: true });
  if (!doc) throw new Error('Only unpaid invoices can be cancelled.');
  if (!doc.contract) { doc.state = 'cancelled'; await doc.save(); }
  res.json({ invoice: output(await sync(doc)) });
}));
router.delete('/invoices/:id', wrap(async (req, res) => {
  const wallet = await owner(req);
  let doc = await Invoice.findOne({ invoiceId: idSchema.parse(req.params.id), owner: wallet, state: 'cancelled' });
  if (!doc) throw new Error('Only your cancelled invoices can be permanently deleted.');
  if (doc.contract) {
    // Cancellation must be final, with no escrowed funds or live payment intents.
    doc = await sync(doc);
    if (!doc) throw new Error('Invoice unavailable. Refresh and try again.');
    if (doc.state !== 'cancelled' || Number((await client.getBlock()).timestamp) <= doc.authorizationUntil) throw new Error('This invoice is not safe to delete yet. Refresh its status and retry.');
  }
  const deleted = await Invoice.findOneAndDelete({ _id: doc._id, owner: wallet, state: 'cancelled' });
  if (!deleted) throw new Error('Invoice status changed. Refresh and try again.');
  res.json({ deleted: true });
}));
router.post('/invoices/:id/authorize', wrap(async (req, res) => {
  const payer = await owner(req), contract = await escrow();
  const deadline = Number((await client.getBlock()).timestamp) + 120;
  const doc = await Invoice.findOneAndUpdate({ invoiceId: idSchema.parse(req.params.id), state: 'open', contract: contract.toLowerCase() }, { $max: { authorizationUntil: deadline } }, { new: true });
  if (!doc || (await sync(doc)).state !== 'open') throw new Error('This invoice is no longer available to pay.');
  const args = { invoiceId: doc.invoiceId as Hex, issuer: doc.owner as Address, payer: payer as Address, amount: BigInt(doc.totals.total), detailsHash: doc.detailsHash as Hex, deadline: BigInt(deadline) };
  const signature = await privateKeyToAccount(env.INVOICE_SIGNER_KEY as Hex).signTypedData({ domain: { name: 'HopfastInvoiceEscrow', version: '1', chainId: env.ARCHITECT_CHAIN_ID, verifyingContract: contract }, types: invoicePaymentTypes, primaryType: 'InvoicePayment', message: args });
  res.json({ ...args, amount: args.amount.toString(), deadline, signature, contract, token });
}));
router.post('/invoices/:id/confirm', wrap(async (req, res) => {
  const wallet = await owner(req), id = idSchema.parse(req.params.id), hash = txSchema.parse(req.body.txHash) as Hex;
  const doc = await Invoice.findOne({ invoiceId: id }); if (!doc?.contract) throw new Error('Invoice unavailable.');
  if (await client.getChainId() !== env.ARCHITECT_CHAIN_ID) throw new Error('Invoice network mismatch.');
  const tx = await client.getTransaction({ hash }), receipt = await client.getTransactionReceipt({ hash });
  if (receipt.status !== 'success' || tx.from.toLowerCase() !== wallet || tx.to?.toLowerCase() !== doc.contract) throw new Error('Transaction does not match this invoice.');
  const event = receipt.logs.filter(log => log.address.toLowerCase() === doc.contract).map(log => {
    try { return decodeEventLog({ abi: artifact.abi, data: log.data, topics: log.topics }) as { eventName: string; args: Record<string, any> }; } catch { return null; }
  }).find(log => log && ['Funded', 'Settled', 'Recovered'].includes(log.eventName) && log.args.invoiceId === id);
  if (!event) throw new Error('Transaction does not contain an invoice payment event.');
  if (event.eventName === 'Funded' && (event.args.issuer.toLowerCase() !== doc.owner || event.args.payer.toLowerCase() !== wallet || event.args.amount.toString() !== doc.totals.total || event.args.detailsHash !== doc.detailsHash)) throw new Error('Payment details mismatch.');
  if (event.eventName === 'Settled' && wallet !== doc.owner) throw new Error('Only the invoicer can confirm release.');
  if (event.eventName === 'Recovered' && wallet !== env.INVOICE_ADMIN_ADDRESS.toLowerCase()) throw new Error('Only the administrator can confirm recovery.');
  const updated = await sync(doc);
  if (event.eventName === 'Funded' && ['funded', 'paid', 'recovered'].includes(updated.state)) { if (updated.payer !== wallet) throw new Error('Payment wallet mismatch.'); await Invoice.updateOne({ _id: doc._id }, { $set: { fundedTx: hash } }); }
  else if (['paid', 'recovered'].includes(updated.state)) await Invoice.updateOne({ _id: doc._id }, { $set: { settlementTx: hash } });
  else throw new Error('Payment has not settled onchain.');
  res.json({ invoice: output(await Invoice.findById(doc._id)) });
}));
export default router;
