import { DiscordMember } from '../../db/models/index.js';

/** Map userId → nom affiché, depuis le cache Discord puis la copie MongoDB. */
export async function getDisplayNames(guild, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const names = new Map();
  if (!ids.length) return names;
  const missing = [];
  for (const id of ids) {
    const m = guild?.members?.cache.get(id);
    if (m) names.set(id, m.displayName);
    else missing.push(id);
  }
  if (missing.length && guild) {
    try {
      const fetched = await guild.members.fetch({ user: missing });
      for (const [id, m] of fetched) names.set(id, m.displayName);
    } catch {
      // Intent membres absent ou membre parti : on retombe sur la copie en base.
    }
  }
  const still = ids.filter((id) => !names.has(id));
  if (still.length) {
    const docs = await DiscordMember.find({ guildId: guild?.id, userId: { $in: still } }).lean();
    for (const d of docs) names.set(d.userId, d.displayName || d.username);
  }
  for (const id of ids) if (!names.has(id)) names.set(id, `Utilisateur ${id.slice(-4)}`);
  return names;
}

export function mention(userId) {
  return `<@${userId}>`;
}
