import { createLogger } from '../../utils/logger.js';

const log = createLogger('messages');

// Codes Discord : salon inconnu, message inconnu, accès manquant.
const GONE_CODES = new Set([10003, 10008, 50001]);

export function isGoneError(err) {
  return GONE_CODES.has(err?.code);
}

export async function fetchChannel(client, channelId) {
  if (!channelId) return null;
  try {
    return client.channels.cache.get(channelId) || (await client.channels.fetch(channelId));
  } catch (err) {
    if (!isGoneError(err)) log.warn(`Salon ${channelId} inaccessible :`, err.message);
    return null;
  }
}

export async function fetchMessage(client, channelId, messageId) {
  if (!channelId || !messageId) return null;
  const channel = await fetchChannel(client, channelId);
  if (!channel?.messages) return null;
  try {
    return await channel.messages.fetch(messageId);
  } catch (err) {
    if (!isGoneError(err)) log.warn(`Message ${messageId} inaccessible :`, err.message);
    return null;
  }
}

/** Modifie un message. Retourne 'ok', 'gone' (supprimé) ou 'error'. */
export async function editMessage(client, channelId, messageId, payload) {
  const channel = await fetchChannel(client, channelId);
  if (!channel?.messages) return 'gone';
  try {
    await channel.messages.edit(messageId, payload);
    return 'ok';
  } catch (err) {
    if (isGoneError(err)) return 'gone';
    log.error(`Échec de modification du message ${messageId} :`, err);
    return 'error';
  }
}

export async function deleteMessage(client, channelId, messageId) {
  const channel = await fetchChannel(client, channelId);
  if (!channel?.messages || !messageId) return false;
  try {
    await channel.messages.delete(messageId);
    return true;
  } catch (err) {
    if (!isGoneError(err)) log.warn(`Suppression du message ${messageId} impossible :`, err.message);
    return false;
  }
}

export function messageLink(guildId, channelId, messageId) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

/** Tronque un texte pour respecter les limites Discord. */
export function truncate(text, max) {
  if (!text) return text;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
