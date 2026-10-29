import { AtmMission, ConvoiMission, PdsSession } from '../../db/models/index.js';
import { getGuildConfig, hasPermission } from '../../db/services/permissions.js';
import { renderAtm, renderConvoi, renderPds } from '../renderers/missions.js';
import { editMessage, fetchChannel } from '../utils/messages.js';
import { memberContext } from '../utils/auth.js';
import { createLogger } from '../../utils/logger.js';
import { EMOJIS } from '../../utils/constants.js';

const log = createLogger('missions');

export async function refreshAtmMessage(client, mission) {
  if (!mission.messageId) return 'gone';
  return editMessage(client, mission.channelId, mission.messageId, renderAtm(mission));
}

export async function refreshConvoiMessage(client, mission) {
  if (!mission.messageId) return 'gone';
  return editMessage(client, mission.channelId, mission.messageId, renderConvoi(mission));
}

export async function refreshPdsMessage(client, pds, mission) {
  if (!pds.messageId) return 'gone';
  const atm = mission === undefined ? await AtmMission.findById(pds.atmMissionId).lean() : mission;
  return editMessage(client, pds.channelId, pds.messageId, renderPds(pds, atm));
}

/** Met à jour les PDS ouvertes rattachées à une mission ATM (équipage affiché). */
export async function refreshPdsForMission(client, mission) {
  const sessions = await PdsSession.find({ atmMissionId: mission._id, status: 'OPEN' });
  for (const pds of sessions) await refreshPdsMessage(client, pds, mission);
}

/** IDs à prévenir : agents disponibles et dispatchés. */
export function missionAudience(mission) {
  const ids = new Set(mission.participants.map((p) => p.userId));
  for (const a of mission.availability) if (a.status === 'AVAILABLE') ids.add(a.userId);
  return [...ids];
}

/** Publie une notification en réponse au message de la mission, avec mention des agents concernés. */
export async function notifyMission(client, mission, text) {
  const channel = await fetchChannel(client, mission.channelId);
  if (!channel?.isSendable?.()) return;
  const users = missionAudience(mission);
  const mentions = users.length ? `\n${users.map((id) => `<@${id}>`).join(' ')}` : '';
  try {
    await channel.send({
      content: `${text}${mentions}`.slice(0, 2000),
      allowedMentions: { users },
      reply: mission.messageId ? { messageReference: mission.messageId, failIfNotExists: false } : undefined,
    });
  } catch (err) {
    log.warn('Notification impossible :', err.message);
  }
}

// --- Réactions de disponibilité (✅ / ❌) -----------------------------------

const pendingRefresh = new Map();

function scheduleRefresh(client, kind, missionId) {
  const key = `${kind}:${missionId}`;
  clearTimeout(pendingRefresh.get(key));
  pendingRefresh.set(
    key,
    setTimeout(async () => {
      pendingRefresh.delete(key);
      try {
        if (kind === 'atm') {
          const mission = await AtmMission.findById(missionId);
          if (mission) await refreshAtmMessage(client, mission);
        } else {
          const mission = await ConvoiMission.findById(missionId);
          if (mission) await refreshConvoiMessage(client, mission);
        }
      } catch (err) {
        log.error('Rafraîchissement après réaction impossible :', err);
      }
    }, 1500),
  );
}

const REACTION_STATUS = { [EMOJIS.available]: 'AVAILABLE', [EMOJIS.unavailable]: 'UNAVAILABLE' };

async function findMissionByMessage(messageId) {
  const atm = await AtmMission.findOne({ messageId });
  if (atm) return { kind: 'atm', model: AtmMission, mission: atm };
  const convoi = await ConvoiMission.findOne({ messageId });
  if (convoi) return { kind: 'convoi', model: ConvoiMission, mission: convoi };
  return null;
}

export async function handleAvailabilityReaction(reaction, user, added) {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
  } catch {
    return;
  }
  const status = REACTION_STATUS[reaction.emoji.name];
  const message = reaction.message;
  if (!status || !message.guildId) return;
  const found = await findMissionByMessage(message.id);
  if (!found) return;
  const { kind, model, mission } = found;

  if (mission.status !== 'OPEN') {
    if (added) await reaction.users.remove(user.id).catch(() => {});
    return;
  }

  if (added) {
    const cfg = await getGuildConfig(message.guildId);
    const member = await message.guild.members.fetch(user.id).catch(() => null);
    if (!member || !hasPermission(memberContext(member, message.guild), 'agent', cfg)) {
      await reaction.users.remove(user.id).catch(() => {});
      return;
    }
    await model.updateOne({ _id: mission._id }, { $pull: { availability: { userId: user.id } } });
    await model.updateOne({ _id: mission._id }, { $push: { availability: { userId: user.id, status, at: new Date() } } });
    const opposite = status === 'AVAILABLE' ? EMOJIS.unavailable : EMOJIS.available;
    await message.reactions.resolve(opposite)?.users.remove(user.id).catch(() => {});
  } else {
    await model.updateOne({ _id: mission._id }, { $pull: { availability: { userId: user.id, status } } });
  }
  scheduleRefresh(message.client, kind, mission._id);
}

/** Resynchronise les disponibilités depuis les réactions (au démarrage du bot). */
export async function syncAvailabilityFromReactions(client, model, mission) {
  const channel = await fetchChannel(client, mission.channelId);
  if (!channel?.messages || !mission.messageId) return false;
  let message;
  try {
    message = await channel.messages.fetch(mission.messageId);
  } catch {
    return false;
  }
  const byUser = new Map();
  for (const [emoji, status] of Object.entries(REACTION_STATUS)) {
    const reaction = message.reactions.resolve(emoji);
    if (!reaction) continue;
    const users = await reaction.users.fetch({ limit: 100 }).catch(() => null);
    if (!users) continue;
    for (const [id, u] of users) if (!u.bot) byUser.set(id, byUser.has(id) ? byUser.get(id) : status);
  }
  const previous = new Map(mission.availability.map((a) => [a.userId, a]));
  mission.availability = [...byUser.entries()].map(([userId, status]) => ({
    userId,
    status,
    at: previous.get(userId)?.status === status ? previous.get(userId).at : new Date(),
  }));
  await model.updateOne({ _id: mission._id }, { $set: { availability: mission.availability } });
  return true;
}

export async function addAvailabilityReactions(message) {
  try {
    await message.react(EMOJIS.available);
    await message.react(EMOJIS.unavailable);
  } catch (err) {
    log.warn('Impossible d’ajouter les réactions :', err.message);
  }
}
