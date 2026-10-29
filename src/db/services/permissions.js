import { GuildConfig } from '../models/index.js';
import { config } from '../../utils/config.js';
import { PERMISSIONS } from '../../utils/constants.js';

const CACHE_TTL = 30_000;
const cache = new Map();

export const PERMISSION_KEYS = Object.keys(PERMISSIONS);

export async function getGuildConfig(guildId) {
  const cached = cache.get(guildId);
  if (cached && cached.expires > Date.now()) return cached.value;
  const value = await GuildConfig.findOneAndUpdate(
    { guildId },
    { $setOnInsert: { guildId } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();
  cache.set(guildId, { value, expires: Date.now() + CACHE_TTL });
  return value;
}

export function invalidateGuildConfig(guildId) {
  cache.delete(guildId);
}

/**
 * @param {{userId:string, roleIds:string[], isOwner?:boolean}} member
 */
export function isSuperUser(member, guildConfig) {
  if (!member?.userId) return false;
  if (member.isOwner) return true;
  if (config.superUserIds.includes(member.userId)) return true;
  if (guildConfig?.superUserIds?.includes(member.userId)) return true;
  const superRoles = [...config.superUserRoleIds, ...(guildConfig?.superUserRoleIds || [])];
  return (member.roleIds || []).some((r) => superRoles.includes(r));
}

/**
 * Vérifie une permission. Une liste de rôles vide signifie "super-users uniquement",
 * sauf pour la clé "agent" où une liste vide signifie "tout le monde".
 */
export function hasPermission(member, key, guildConfig) {
  if (isSuperUser(member, guildConfig)) return true;
  const allowed = guildConfig?.permissions?.[key] || [];
  if (!allowed.length) return key === 'agent';
  return (member.roleIds || []).some((r) => allowed.includes(r));
}

export function computePermissions(member, guildConfig) {
  const superUser = isSuperUser(member, guildConfig);
  const perms = { super: superUser };
  for (const key of PERMISSION_KEYS) perms[key] = superUser || hasPermission(member, key, guildConfig);
  return perms;
}
