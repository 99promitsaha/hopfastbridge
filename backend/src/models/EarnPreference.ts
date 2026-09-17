import mongoose, { Schema, model } from 'mongoose';

const earnPreferenceSchema = new Schema(
  {
    userAddress:     { type: String, required: true, lowercase: true, unique: true, index: true },
    riskAppetite:    { type: String, enum: ['high', 'safe'], required: true },
    preferredAsset:  { type: String, default: 'any' },
    experienceLevel: { type: String, enum: ['beginner', 'intermediate', 'advanced'], required: true },
  },
  { timestamps: true }
);

export const EarnPreference =
  mongoose.models.EarnPreference || model('EarnPreference', earnPreferenceSchema);
