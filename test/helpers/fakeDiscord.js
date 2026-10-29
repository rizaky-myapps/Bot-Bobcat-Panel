// Faux client Discord minimal pour tester les flux du bot sans connexion à Discord.
import { Collection, MessageFlags } from 'discord.js';

export const GUILD_ID = '900000000000000001';
let seq = 0n;
const nextId = () => String(950000000000000000n + ++seq);

function discordError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function createMessage(channel, payload) {
  return {
    id: nextId(),
    channelId: channel.id,
    guildId: GUILD_ID,
    payload,
    edits: 0,
    reactionsAdded: [],
    reactions: { resolve: () => null },
    attachments: new Map(),
    async react(emoji) {
      this.reactionsAdded.push(emoji);
    },
  };
}

export function createChannel(id) {
  const messages = new Map();
  const channel = {
    id,
    sent: [],
    messagesMap: messages,
    sendable: true,
    isSendable() {
      return this.sendable;
    },
    async send(payload) {
      if (!this.sendable) throw discordError(50013, 'Missing Permissions');
      const msg = createMessage(channel, payload);
      messages.set(msg.id, msg);
      channel.sent.push(msg);
      return msg;
    },
    messages: {
      async fetch(messageId) {
        if (!messages.has(messageId)) throw discordError(10008, 'Unknown Message');
        return messages.get(messageId);
      },
      async edit(messageId, payload) {
        const msg = messages.get(messageId);
        if (!msg) throw discordError(10008, 'Unknown Message');
        msg.payload = payload;
        msg.edits++;
        return msg;
      },
      async delete(messageId) {
        if (!messages.delete(messageId)) throw discordError(10008, 'Unknown Message');
      },
    },
  };
  return channel;
}

export function createClient() {
  const channels = new Map();
  const dms = new Map();
  const client = {
    user: { id: '900000000000000999', tag: 'Bobcat#0001' },
    guilds: { cache: new Map([[GUILD_ID, { id: GUILD_ID }]]) },
    commands: new Collection(),
    handlers: new Map(),
    dmBlocked: new Set(),
    channels: {
      cache: channels,
      async fetch(id) {
        if (!channels.has(id)) throw discordError(10003, 'Unknown Channel');
        return channels.get(id);
      },
    },
    users: {
      async fetch(id) {
        if (!dms.has(id)) dms.set(id, createChannel(`dm-${id}`));
        const dm = dms.get(id);
        return {
          id,
          bot: false,
          async send(payload) {
            if (client.dmBlocked.has(id)) throw discordError(50007, 'Cannot send messages to this user');
            return dm.send(typeof payload === 'string' ? { content: payload } : payload);
          },
          async createDM() {
            return dm;
          },
        };
      },
    },
    dm(id) {
      return dms.get(id);
    },
    channel(id) {
      if (!channels.has(id)) channels.set(id, createChannel(id));
      return channels.get(id);
    },
  };
  return client;
}

export function member(userId, roles = []) {
  return { id: userId, displayName: `Agent ${userId.slice(-3)}`, roles: { cache: new Map(roles.map((r) => [r, { id: r }])) } };
}

export function guild(ownerId, members = []) {
  const cache = new Map(members.map((m) => [m.id, m]));
  return {
    id: GUILD_ID,
    ownerId,
    members: {
      cache,
      async fetch(arg) {
        if (typeof arg === 'string') {
          if (!cache.has(arg)) throw discordError(10007, 'Unknown Member');
          return cache.get(arg);
        }
        return new Map();
      },
    },
  };
}

/**
 * Crée une interaction factice.
 * type : command | button | select | modal | autocomplete
 */
export function createInteraction(client, opts) {
  const {
    type,
    userId,
    roles = [],
    channelId,
    commandName,
    options = {},
    customId,
    values = [],
    fields = {},
    fromEphemeral = false,
    ownerId = '900000000000000500',
  } = opts;
  const channel = client.channel(channelId);
  const theMember = member(userId, roles);
  const log = { replies: [], updates: [], edits: [], followUps: [], modals: [], deferred: null, choices: null };
  const interaction = {
    type,
    guildId: GUILD_ID,
    channelId,
    channel,
    client,
    commandName,
    customId,
    values,
    users: new Map(values.map((v) => [v, { id: v, bot: false }])),
    user: { id: userId, username: `user${userId.slice(-3)}`, tag: `user${userId.slice(-3)}#0001` },
    member: theMember,
    guild: guild(ownerId, [theMember]),
    deferred: false,
    replied: false,
    message: { flags: { has: (flag) => fromEphemeral && flag === MessageFlags.Ephemeral } },
    log,
    inGuild: () => true,
    isRepliable: () => type !== 'autocomplete',
    isChatInputCommand: () => type === 'command',
    isAutocomplete: () => type === 'autocomplete',
    isMessageComponent: () => type === 'button' || type === 'select',
    isModalSubmit: () => type === 'modal',
    isFromMessage: () => type === 'modal',
    options: {
      getString: (n) => options[n] ?? null,
      getInteger: (n) => options[n] ?? null,
      getNumber: (n) => options[n] ?? null,
      getBoolean: (n) => options[n] ?? null,
      getRole: (n) => options[n] ?? null,
      getChannel: (n) => options[n] ?? null,
      getUser: (n) => options[n] ?? null,
      getSubcommand: () => options._sub,
      getFocused: () => options._focused ?? '',
    },
    fields: {
      getTextInputValue: (id) => fields[id] ?? '',
      getStringSelectValues: (id) => fields[id] ?? [],
      getUploadedFiles: (id) => (fields[id] ? new Map(fields[id].map((f, i) => [String(i), f])) : null),
    },
    async reply(payload) {
      this.replied = true;
      log.replies.push(payload);
      if (!((payload.flags || 0) & MessageFlags.Ephemeral)) this._reply = await channel.send(payload);
    },
    async fetchReply() {
      return this._reply;
    },
    async deferReply(payload) {
      this.deferred = true;
      log.deferred = payload || {};
    },
    async editReply(payload) {
      log.edits.push(payload);
    },
    async followUp(payload) {
      log.followUps.push(payload);
    },
    async update(payload) {
      this.replied = true;
      log.updates.push(payload);
    },
    async showModal(modal) {
      this.replied = true;
      log.modals.push(modal.toJSON());
    },
    async respond(choices) {
      log.choices = choices;
    },
  };
  return interaction;
}

/** Texte complet d'une réponse (contenu, embeds, composants v2) pour les assertions. */
export function textOf(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  const parts = [payload.content || ''];
  for (const e of payload.embeds || []) parts.push(JSON.stringify(e.toJSON ? e.toJSON() : e));
  for (const c of payload.components || []) parts.push(JSON.stringify(c.toJSON ? c.toJSON() : c));
  return parts.join('\n');
}
