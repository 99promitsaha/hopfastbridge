import mongoose, { Schema, model } from 'mongoose';

const earnPositionSchema = new Schema(
  {
    userAddress:   { type: String, required: true, lowercase: true, index: true },
    vaultAddress:  { type: String, required: true, lowercase: true },
    vaultName:     { type: String, default: '' },
    chainId:       { type: Number, required: true },
    network:       { type: String, default: '' },
    protocolName:  { type: String, default: '' },
    protocolUrl:   { type: String, default: '' },
    tokenSymbol:   { type: String, default: '' },
    tokenAddress:  { type: String, default: '', lowercase: true },
    tokenDecimals: { type: Number, default: 18 },
    amount:        { type: String, default: '0' },   // human-readable
    amountRaw:     { type: String, default: '0' },   // wei string
    txHash:        { type: String, required: true, lowercase: true },
    action:        { type: String, default: 'deposit' }, // deposit | withdraw
    note:          { type: String, default: '' },
  },
  { timestamps: true },
);

export const EarnPosition =
  mongoose.models.EarnPosition || model('EarnPosition', earnPositionSchema);
