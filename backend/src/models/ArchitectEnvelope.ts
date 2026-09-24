import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    envelopeId: { type: String, required: true, unique: true },
    funder: { type: String, required: true },
    xId: { type: String, required: true },
    handle: { type: String, required: true },
    xIdentity: { type: String, required: true },
    gross: { type: String, required: true },
    message: { type: String, required: true },
    accessHash: { type: String, required: true },
    fundedTx: String,
  },
  { timestamps: true },
);
export const ArchitectEnvelope = mongoose.model("ArchitectEnvelope", schema);
const authSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  kind: { type: String, required: true },
  wallet: String,
  envelopeId: String,
  message: String,
  verifier: String,
  browserHash: String,
  xId: String,
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
});
export const ArchitectAuth = mongoose.model("ArchitectAuth", authSchema);

const paymentProfileSchema = new mongoose.Schema(
  {
    xId: { type: String, required: true, unique: true, index: true },
    handle: { type: String, required: true, unique: true, lowercase: true, index: true },
    wallet: { type: String, required: true, unique: true, lowercase: true, index: true },
  },
  { timestamps: true },
);
export const PaymentProfile = mongoose.model("PaymentProfile", paymentProfileSchema);
