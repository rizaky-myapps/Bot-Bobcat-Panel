import { Events } from 'discord.js';
import { markMemberLeft, scheduleGuildCacheSync, syncAllMembers, syncGuildCache, upsertMember } from '../services/guildSync.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('sync');
const safe = (fn) => (...args) => Promise.resolve(fn(...args)).catch((err) => log.warn('Synchronisation :', err.message));

export const events = [
  { name: Events.GuildMemberAdd, execute: safe((member) => upsertMember(member)) },
  { name: Events.GuildMemberUpdate, execute: safe((_old, member) => upsertMember(member)) },
  { name: Events.GuildMemberRemove, execute: safe((member) => markMemberLeft(member)) },
  { name: Events.GuildRoleCreate, execute: (role) => scheduleGuildCacheSync(role.guild) },
  { name: Events.GuildRoleUpdate, execute: (_old, role) => scheduleGuildCacheSync(role.guild) },
  { name: Events.GuildRoleDelete, execute: (role) => scheduleGuildCacheSync(role.guild) },
  { name: Events.ChannelCreate, execute: (channel) => scheduleGuildCacheSync(channel.guild) },
  { name: Events.ChannelUpdate, execute: (_old, channel) => scheduleGuildCacheSync(channel.guild) },
  { name: Events.ChannelDelete, execute: (channel) => scheduleGuildCacheSync(channel.guild) },
  { name: Events.GuildUpdate, execute: (_old, guild) => scheduleGuildCacheSync(guild) },
  {
    name: Events.GuildCreate,
    execute: safe(async (guild) => {
      await syncGuildCache(guild);
      await syncAllMembers(guild);
    }),
  },
];
