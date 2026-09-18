import mongoose, { Schema, model } from 'mongoose';
const schema = new Schema(
  {
    title: { type: String, required: true },
    handle: { type: String, required: true },
    projectUrl: { type: String, required: true },
    description: { type: String, required: true },
    milestone: { type: String, required: true },
    targetUsdc: { type: String, required: true },
  },
  { timestamps: true }
);
export const MicroGrant =
  mongoose.models.MicroGrant || model('MicroGrant', schema);
