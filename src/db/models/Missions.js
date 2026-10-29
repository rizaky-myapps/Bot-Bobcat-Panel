import mongoose from 'mongoose';

const availabilitySchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    status: { type: String, enum: ['AVAILABLE', 'UNAVAILABLE'], required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const participantSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    roles: { type: [String], default: [] },
  },
  { _id: false },
);

const commonMission = {
  guildId: { type: String, required: true, index: true },
  channelId: { type: String, required: true },
  messageId: { type: String, default: null },
  createdBy: { type: String, required: true },
  dateStr: String,
  timeStr: String,
  scheduledAt: { type: Date, required: true },
  status: { type: String, enum: ['OPEN', 'FINISHED', 'CANCELLED'], default: 'OPEN', index: true },
  availability: { type: [availabilitySchema], default: [] },
  participants: { type: [participantSchema], default: [] },
  closedAt: Date,
  closedBy: String,
  cancelReason: String,
};

const atmSchema = new mongoose.Schema(
  {
    ...commonMission,
    frequency: { type: String, default: 'S6' },
    mentionRoleId: { type: String, default: null },
  },
  { timestamps: true },
);
atmSchema.index({ guildId: 1, messageId: 1 });

const convoiSchema = new mongoose.Schema(
  {
    ...commonMission,
    notes: { type: String, default: '' },
    reschedules: [
      {
        _id: false,
        from: Date,
        to: Date,
        by: String,
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);
convoiSchema.index({ guildId: 1, messageId: 1 });

const pdsSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String, default: null },
    atmMissionId: { type: mongoose.Schema.Types.ObjectId, ref: 'AtmMission', required: true },
    createdBy: { type: String, required: true },
    plate: { type: String, required: true },
    status: { type: String, enum: ['OPEN', 'FINISHED'], default: 'OPEN', index: true },
    startAt: { type: Date, default: Date.now },
    endAt: Date,
    finishedBy: String,
    participants: { type: [participantSchema], default: [] },
    atms: [
      {
        label: { type: String, required: true },
        note: { type: String, default: '' },
        photos: [{ _id: false, url: String, publicId: String }],
        addedBy: String,
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

const registrationSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    at: { type: Date, default: Date.now },
    by: String,
  },
  { _id: false },
);

const slotSchema = new mongoose.Schema({
  label: String,
  startAt: { type: Date, required: true },
  endAt: { type: Date, required: true },
  capacity: { type: Number, default: 1, min: 1 },
  registrations: { type: [registrationSchema], default: [] },
  reminderSentAt: { type: Date, default: null },
  endedRendered: { type: Boolean, default: false },
});

const daySchema = new mongoose.Schema({
  date: { type: Date, required: true },
  messageId: { type: String, default: null },
  slots: { type: [slotSchema], default: [] },
});

const secuSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    headerMessageId: { type: String, default: null },
    createdBy: { type: String, required: true },
    lieu: { type: String, required: true },
    tenue: { type: String, default: 'TENUE_SECURISATION' },
    vehicule: { type: String, default: 'free' },
    vehiculeCustom: { type: String, default: '' },
    radio: { type: String, default: 'CENTRALE' },
    capacity: { type: Number, default: 2, min: 1 },
    daysSpec: String,
    template: String,
    planning: { type: String, default: '' },
    briefOffset: { type: Number, default: 0 },
    infoChannelId: { type: String, default: null },
    infoMessageId: { type: String, default: null },
    pdsChannelId: { type: String, default: null },
    status: { type: String, enum: ['OPEN', 'FINISHED', 'CANCELLED'], default: 'OPEN', index: true },
    published: { type: Boolean, default: false },
    days: { type: [daySchema], default: [] },
    closedAt: Date,
    closedBy: String,
  },
  { timestamps: true },
);

export const AtmMission = mongoose.models.AtmMission || mongoose.model('AtmMission', atmSchema);
export const ConvoiMission = mongoose.models.ConvoiMission || mongoose.model('ConvoiMission', convoiSchema);
export const PdsSession = mongoose.models.PdsSession || mongoose.model('PdsSession', pdsSchema);
export const SecuMission = mongoose.models.SecuMission || mongoose.model('SecuMission', secuSchema);
