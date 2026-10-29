import mongoose from 'mongoose';

// File d'actions envoyées par le panel au bot (mise à jour des messages Discord).
const panelActionSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    entity: { type: String, required: true }, // patrol | patrolTime | atm | pds | convoi | secu
    type: { type: String, required: true }, // refresh | publish | delete
    entityId: { type: String, default: null },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['PENDING', 'PROCESSING', 'DONE', 'ERROR'], default: 'PENDING' },
    attempts: { type: Number, default: 0 },
    error: String,
    createdBy: String,
    processedAt: Date,
    expireAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 3600 * 1000) },
  },
  { timestamps: true },
);
panelActionSchema.index({ status: 1, createdAt: 1 });
panelActionSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

const auditSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    actorId: String,
    actorName: String,
    source: { type: String, enum: ['bot', 'panel', 'system'], default: 'bot' },
    action: { type: String, required: true },
    targetType: String,
    targetId: String,
    summary: String,
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditSchema.index({ guildId: 1, createdAt: -1 });

// Signal de vie du bot, affiché dans le panel.
const heartbeatSchema = new mongoose.Schema({
  _id: { type: String, default: 'bot' },
  tag: String,
  guildIds: [String],
  startedAt: Date,
  updatedAt: Date,
});

export const PanelAction = mongoose.models.PanelAction || mongoose.model('PanelAction', panelActionSchema);
export const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditSchema);
export const BotHeartbeat = mongoose.models.BotHeartbeat || mongoose.model('BotHeartbeat', heartbeatSchema);
