import mongoose from 'mongoose';

const { Schema } = mongoose;

const meetingSchema = new Schema(
  { start: String, durationMinutes: Number, optionId: Schema.Types.ObjectId, finalizedAt: Date },
  { _id: false },
);

const boardSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true },
    title: { type: String, required: true, maxlength: 80 },
    timezone: { type: String, required: true },
    startDate: { type: String, required: true },
    days: { type: Number, required: true, min: 1, max: 14 },
    dayStartHour: { type: Number, required: true, min: 0, max: 23 },
    dayEndHour: { type: Number, required: true, min: 1, max: 24 },
    slotMinutes: { type: Number, required: true, enum: [30, 60] },
    slots: { type: [String], required: true },
    adminTokenHash: { type: String, required: true },
    meeting: { type: meetingSchema, default: undefined },
  },
  { timestamps: true },
);

const memberSchema = new Schema(
  {
    boardId: { type: Schema.Types.ObjectId, required: true, ref: 'Board' },
    name: { type: String, required: true, maxlength: 40 },
    nameKey: { type: String, required: true },
    timezone: { type: String, required: true },
    tokenHash: { type: String, required: true },
    availability: { type: [String], default: [] },
  },
  { timestamps: true },
);
memberSchema.index({ boardId: 1, nameKey: 1 }, { unique: true });
memberSchema.index({ boardId: 1, tokenHash: 1 });

const optionSchema = new Schema(
  {
    boardId: { type: Schema.Types.ObjectId, required: true, ref: 'Board', index: true },
    start: { type: String, required: true },
    durationMinutes: { type: Number, required: true },
    proposedBy: { type: Schema.Types.ObjectId, ref: 'Member' },
    votes: { type: [Schema.Types.ObjectId], default: [] },
  },
  { timestamps: true },
);
optionSchema.index({ boardId: 1, start: 1, durationMinutes: 1 }, { unique: true });

export const Board = mongoose.models.Board || mongoose.model('Board', boardSchema);
export const Member = mongoose.models.Member || mongoose.model('Member', memberSchema);
export const Option = mongoose.models.Option || mongoose.model('Option', optionSchema);

export const isDuplicateKey = (err) => err?.code === 11000;

export async function ensureIndexes() {
  await Promise.all([Board.init(), Member.init(), Option.init()]);
}
