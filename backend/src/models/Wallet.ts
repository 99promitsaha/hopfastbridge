import mongoose, { Schema, model } from 'mongoose';

const walletSchema = new Schema(
  {
    address: { type: String, required: true, unique: true, lowercase: true },
    lastSeenAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

export const Wallet = mongoose.models.Wallet || model('Wallet', walletSchema);
