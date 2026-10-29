import mongoose from 'mongoose';

const placeSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    emoji: { type: String, default: '📍' },
    maxHoursPerWeek: { type: Number, default: 0, min: 0 }, // 0 = illimité
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
placeSchema.index({ guildId: 1, name: 1 }, { unique: true, collation: { locale: 'fr', strength: 2 } });

const visitSchema = new mongoose.Schema({
  placeId: { type: mongoose.Schema.Types.ObjectId, ref: 'PatrolPlace' },
  name: String,
  emoji: String,
  arrivedAt: { type: Date, required: true },
  leftAt: { type: Date, default: null },
  leaveReason: { type: String, default: '' },
  countedMinutes: { type: Number, default: 0 }, // minutes déjà comptées dans PatrolTimeTracking
});

const sessionSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String, default: null },
    authorId: { type: String, required: true },
    version: { type: String, enum: ['v1', 'v2'], default: 'v1' },
    unit: { type: String, required: true },
    agents: { type: [String], default: [] }, // libellés affichés (mentions ou matricules)
    agentIds: { type: [String], default: [] }, // IDs Discord des agents mentionnés
    dateLabel: String,
    startAt: { type: Date, required: true },
    endAt: { type: Date, default: null },
    status: { type: String, enum: ['OPEN', 'FINISHED'], default: 'OPEN', index: true },
    places: { type: [visitSchema], default: [] },
    countedWeek: { year: Number, week: Number },
    lastActivityAt: { type: Date, default: Date.now },
    finishedBy: String,
    inactivityWarning: {
      sentAt: Date,
      viaDm: Boolean,
      channelId: String,
      messageId: String,
    },
  },
  { timestamps: true },
);
sessionSchema.index({ guildId: 1, channelId: 1, status: 1 });
sessionSchema.index({ guildId: 1, startAt: -1 });

const trackingSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    placeId: { type: mongoose.Schema.Types.ObjectId, ref: 'PatrolPlace', required: true },
    placeName: String,
    year: { type: Number, required: true },
    weekNumber: { type: Number, required: true },
    totalMinutes: { type: Number, default: 0 },
  },
  { timestamps: true },
);
trackingSchema.index({ guildId: 1, placeId: 1, year: 1, weekNumber: 1 }, { unique: true });

const boardSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    channelId: { type: String, required: true },
    messageId: { type: String, required: true },
    createdBy: String,
  },
  { timestamps: true },
);
boardSchema.index({ guildId: 1, channelId: 1 }, { unique: true });

export const PatrolPlace = mongoose.models.PatrolPlace || mongoose.model('PatrolPlace', placeSchema);
export const PatrolSession = mongoose.models.PatrolSession || mongoose.model('PatrolSession', sessionSchema);
export const PatrolTimeTracking =
  mongoose.models.PatrolTimeTracking || mongoose.model('PatrolTimeTracking', trackingSchema);
export const PatrolTimeBoard = mongoose.models.PatrolTimeBoard || mongoose.model('PatrolTimeBoard', boardSchema);
