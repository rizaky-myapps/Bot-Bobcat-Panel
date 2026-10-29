import mongoose from 'mongoose';

const permissionsSchema = new mongoose.Schema(
  {
    patrouille: { type: [String], default: [] },
    atm: { type: [String], default: [] },
    pds: { type: [String], default: [] },
    secu: { type: [String], default: [] },
    convoi: { type: [String], default: [] },
    panel: { type: [String], default: [] },
    agent: { type: [String], default: [] },
  },
  { _id: false },
);

const guildConfigSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, unique: true },
    superUserIds: { type: [String], default: [] },
    superUserRoleIds: { type: [String], default: [] },
    permissions: { type: permissionsSchema, default: () => ({}) },
    settings: {
      patrolIdleMinutes: { type: Number, default: 45 },
      logChannelId: { type: String, default: null },
    },
  },
  { timestamps: true },
);

export const GuildConfig = mongoose.models.GuildConfig || mongoose.model('GuildConfig', guildConfigSchema);
