import { DiscordMember, DiscordGuildCache } from '../models/index.js';

/** Retourne une Map userId → { displayName, avatarUrl, username } depuis le cache synchronisé par le bot. */
export async function getMemberMap(guildId, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;
  const members = await DiscordMember.find({ guildId, userId: { $in: ids } }).lean();
  for (const m of members) map.set(m.userId, m);
  return map;
}

export async function listMembers(guildId) {
  return DiscordMember.find({ guildId, inGuild: true, bot: { $ne: true } })
    .sort({ displayName: 1 })
    .select('userId displayName username avatarUrl roleIds')
    .lean();
}

export async function getGuildCache(guildId) {
  return DiscordGuildCache.findOne({ guildId }).lean();
}

export function displayName(map, userId) {
  const m = map.get(userId);
  return m?.displayName || m?.username || userId;
}
