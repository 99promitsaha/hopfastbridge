import mongoose from 'mongoose';
// Immutable public snapshots are validated before persistence. Private client books stay separate.
const schema = new mongoose.Schema({
  invoiceId: { type: String, unique: true, required: true },
  owner: { type: String, required: true, index: true },
  handle: String,
  state: { type: String, enum: ['draft', 'open', 'cancelling', 'cancelled', 'funded', 'paid', 'recovered'], default: 'draft' },
  input: { type: mongoose.Schema.Types.Mixed, required: true },
  billing: mongoose.Schema.Types.Mixed,
  totals: { type: mongoose.Schema.Types.Mixed, required: true },
  detailsHash: String,
  contract: String,
  authorizationUntil: { type: Number, default: 0 },
  payer: String,
  fundedTx: String,
  settlementTx: String,
}, { timestamps: true, optimisticConcurrency: true });
schema.index({ owner: 1, createdAt: -1 });
export const Invoice = mongoose.model('Invoice', schema);
export const InvoiceBusiness = mongoose.model('InvoiceBusiness', new mongoose.Schema({
  owner: { type: String, unique: true, required: true },
  details: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true }));
