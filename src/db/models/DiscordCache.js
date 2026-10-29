import mongoose from 'mongoose';

// Copie des rôles, salons et membres du serveur, synchronisée par le bot.
// Le panel lit ces données sans avoir besoin du token du bot.

const guildCacheSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, unique: true },
    name: String,
    iconUrl: String,
    ownerId: String,
    roles: [{ _id: false, id: String, name: String, color: Number, position: Number, managed: Boolean }],
    channels: [{ _id: false, id: String, name: String, type: { type: Number }, parentId: String, position: Number }],
    syncedAt: Date,
  },
  { timestamps: true },
);

const memberSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    username: String,
    displayName: String,
    avatarUrl: String,
    roleIds: { type: [String], default: [] },
    bot: { type: Boolean, default: false },
    inGuild: { type: Boolean, default: true },
    syncedAt: Date,
  },
  { timestamps: true },
);
memberSchema.index({ guildId: 1, userId: 1 }, { unique: true });
memberSchema.index({ guildId: 1, displayName: 1 });

export const DiscordGuildCache =
  mongoose.models.DiscordGuildCache || mongoose.model('DiscordGuildCache', guildCacheSchema);
export const DiscordMember = mongoose.models.DiscordMember || mongoose.model('DiscordMember', memberSchema);
