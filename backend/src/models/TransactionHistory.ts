import mongoose, { Schema, model } from 'mongoose';

const transactionHistorySchema = new Schema(
  {
    userAddress: { type: String, required: true, lowercase: true, index: true },
    txHash: { type: String, required: true, lowercase: true },
    quoteId: { type: String },
    provider: { type: String },
    fromChain: { type: String, required: true },
    toChain: { type: String, required: true },
    fromTokenSymbol: { type: String, required: true },
    toTokenSymbol: { type: String, required: true },
    amount: { type: String, required: true },
    volumeUsd: { type: Number },
    status: { type: String, default: 'submitted' },
    metadata: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);

transactionHistorySchema.index({ userAddress: 1, createdAt: -1 });
transactionHistorySchema.index({ userAddress: 1, txHash: 1 }, { unique: true });

export const TransactionHistory =
  mongoose.models.TransactionHistory || model('TransactionHistory', transactionHistorySchema);
