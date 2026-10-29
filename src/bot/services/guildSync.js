import { DiscordGuildCache, DiscordMember } from '../../db/models/index.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('sync');

/** Copie les rôles et salons du serveur en base pour le panel. */
export async function syncGuildCache(guild) {
  const roles = guild.roles.cache
    .filter((r) => r.id !== guild.id)
    .map((r) => ({ id: r.id, name: r.name, color: r.color, position: r.position, managed: r.managed }))
    .sort((a, b) => b.position - a.position);
  const channels = guild.channels.cache
    .map((c) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId, position: c.rawPosition ?? c.position ?? 0 }))
    .sort((a, b) => a.position - b.position);
  await DiscordGuildCache.findOneAndUpdate(
    { guildId: guild.id },
    { name: guild.name, iconUrl: guild.iconURL() || null, ownerId: guild.ownerId, roles, channels, syncedAt: new Date() },
    { upsert: true },
  );
}

function memberDoc(member) {
  return {
    guildId: member.guild.id,
    userId: member.id,
    username: member.user.username,
    displayName: member.displayName,
    avatarUrl: member.displayAvatarURL({ size: 64 }),
    roleIds: [...member.roles.cache.keys()].filter((id) => id !== member.guild.id),
    bot: member.user.bot,
    inGuild: true,
    syncedAt: new Date(),
  };
}

export async function upsertMember(member) {
  if (!member?.guild) return;
  const doc = memberDoc(member);
  await DiscordMember.updateOne({ guildId: doc.guildId, userId: doc.userId }, { $set: doc }, { upsert: true });
}

export async function markMemberLeft(member) {
  await DiscordMember.updateOne({ guildId: member.guild.id, userId: member.id }, { $set: { inGuild: false, syncedAt: new Date() } });
}

/** Synchronise tous les membres (nécessite l'intent privilégié « Server Members »). */
export async function syncAllMembers(guild) {
  try {
    const members = await guild.members.fetch();
    const ops = members.map((m) => {
      const doc = memberDoc(m);
      return { updateOne: { filter: { guildId: doc.guildId, userId: doc.userId }, update: { $set: doc }, upsert: true } };
    });
    for (let i = 0; i < ops.length; i += 500) await DiscordMember.bulkWrite(ops.slice(i, i + 500));
    await DiscordMember.updateMany({ guildId: guild.id, userId: { $nin: [...members.keys()] } }, { $set: { inGuild: false } });
    log.info(`${members.size} membre(s) synchronisé(s) pour ${guild.name}.`);
  } catch (err) {
    log.warn(`Synchronisation des membres impossible pour ${guild.name} (intent « Server Members » activé ?) :`, err.message);
  }
}

const pending = new Map();

/** Resynchronise le cache d'un serveur après un changement de rôle/salon (regroupé sur 5 s). */
export function scheduleGuildCacheSync(guild) {
  if (!guild) return;
  clearTimeout(pending.get(guild.id));
  pending.set(
    guild.id,
    setTimeout(() => {
      pending.delete(guild.id);
      syncGuildCache(guild).catch((err) => log.warn('Synchronisation du serveur impossible :', err.message));
    }, 5000),
  );
}
