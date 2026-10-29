import { getGuildConfig, hasPermission, isSuperUser } from '../../db/services/permissions.js';
import { replyEphemeral } from './replies.js';

/** Contexte de permissions d'un membre (GuildMember ou membre brut d'interaction). */
export function memberContext(member, guild) {
  if (!member) return { userId: null, roleIds: [], isOwner: false };
  const userId = member.id || member.user?.id;
  const roleIds = member.roles?.cache ? [...member.roles.cache.keys()] : Array.isArray(member.roles) ? member.roles : [];
  const ownerId = guild?.ownerId || member.guild?.ownerId;
  return { userId, roleIds, isOwner: Boolean(ownerId && ownerId === userId) };
}

export async function can(interaction, key) {
  const cfg = await getGuildConfig(interaction.guildId);
  return hasPermission(memberContext(interaction.member, interaction.guild), key, cfg);
}

export async function isSuper(interaction) {
  const cfg = await getGuildConfig(interaction.guildId);
  return isSuperUser(memberContext(interaction.member, interaction.guild), cfg);
}

/** Répond avec une erreur éphémère et retourne false si la permission manque. */
export async function requirePermission(interaction, key, message) {
  if (await can(interaction, key)) return true;
  await replyEphemeral(interaction, message || "⛔ Tu n'as pas la permission d'utiliser cette action.");
  return false;
}

export async function requireSuper(interaction, message) {
  if (await isSuper(interaction)) return true;
  await replyEphemeral(interaction, message || '⛔ Action réservée aux super-users.');
  return false;
}
