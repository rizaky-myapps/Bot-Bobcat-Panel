import { SecuMission } from '../../db/models/index.js';
import { renderSecuDay, renderSecuHeader, renderSecuInfo, secuSummary } from '../renderers/secu.js';
import { deleteMessage, editMessage, fetchChannel, messageLink } from '../utils/messages.js';
import { createLogger } from '../../utils/logger.js';
import { addMinutes, formatHM } from '../../utils/times.js';

const log = createLogger('secu');

async function sendOrEdit(client, channel, channelId, messageId, payload) {
  if (messageId) {
    const result = await editMessage(client, channelId, messageId, payload);
    if (result !== 'gone') return messageId;
  }
  if (!channel?.isSendable?.()) return null;
  const message = await channel.send(payload);
  return message.id;
}

/**
 * Publie ou met à jour tous les messages d'une sécurisation : en-tête, un message par jour,
 * et l'annonce dans le salon d'informations. Les messages supprimés sont recréés.
 */
export async function syncSecuMessages(client, mission, { removedMessageIds = [] } = {}) {
  const channel = await fetchChannel(client, mission.channelId);
  if (!channel) throw new Error(`Salon ${mission.channelId} inaccessible`);

  for (const id of removedMessageIds) await deleteMessage(client, mission.channelId, id);

  mission.headerMessageId = await sendOrEdit(client, channel, mission.channelId, mission.headerMessageId, renderSecuHeader(mission));
  for (const day of mission.days) {
    day.messageId = await sendOrEdit(client, channel, mission.channelId, day.messageId, renderSecuDay(mission, day));
  }

  if (mission.infoChannelId) {
    const infoChannel = await fetchChannel(client, mission.infoChannelId);
    const link = mission.headerMessageId ? messageLink(mission.guildId, mission.channelId, mission.headerMessageId) : null;
    try {
      mission.infoMessageId = await sendOrEdit(
        client,
        infoChannel,
        mission.infoChannelId,
        mission.infoMessageId,
        renderSecuInfo(mission, link),
      );
    } catch (err) {
      log.warn("Annonce dans le salon d'informations impossible :", err.message);
    }
  }
  mission.published = true;
  await mission.save();
  return mission;
}

export async function refreshSecuDay(client, mission, day) {
  if (!day.messageId) return 'gone';
  return editMessage(client, mission.channelId, day.messageId, renderSecuDay(mission, day));
}

function reminderText(mission, day, slot) {
  const s = secuSummary(mission);
  const isFirst = day.slots[0] && String(day.slots[0]._id) === String(slot._id);
  const mentions = slot.registrations.map((r) => `<@${r.userId}>`).join(' ');
  const time = `${formatHM(slot.startAt)} → ${formatHM(slot.endAt)}`;
  if (!slot.registrations.length) {
    return `⚠️ **${slot.label}** — Sécurisation **${mission.lieu}** (${time}) : aucun agent inscrit !`;
  }
  const header =
    isFirst && mission.briefOffset
      ? `🧠 **Brief ${slot.label}** — Sécurisation **${mission.lieu}** · prise de service à ${formatHM(slot.startAt)}`
      : `📣 **${slot.label}** — Sécurisation **${mission.lieu}** : prise de service (${time})`;
  return `${header}\n👕 ${s.tenue} · 🚗 ${s.vehicule} · 📻 ${s.radio}\n${mentions}`;
}

/**
 * Tâche planifiée (chaque minute) : rappels de prise de service, désactivation des créneaux
 * terminés et clôture automatique des sécurisations passées.
 */
export async function runSecuScheduler(client, now = new Date()) {
  const missions = await SecuMission.find({ status: 'OPEN', published: true });
  for (const mission of missions) {
    let dirty = false;
    const changedDays = new Set();
    for (const day of mission.days) {
      for (const [index, slot] of day.slots.entries()) {
        const remindAt = index === 0 && mission.briefOffset ? addMinutes(slot.startAt, -mission.briefOffset) : slot.startAt;
        if (!slot.reminderSentAt && now >= remindAt) {
          slot.reminderSentAt = now;
          dirty = true;
          if (now < slot.endAt) {
            const channel = await fetchChannel(client, mission.pdsChannelId || mission.channelId);
            if (channel?.isSendable?.()) {
              await channel
                .send({
                  content: reminderText(mission, day, slot).slice(0, 2000),
                  allowedMentions: { users: slot.registrations.map((r) => r.userId) },
                })
                .catch((err) => log.warn('Rappel impossible :', err.message));
            }
          }
        }
        if (!slot.endedRendered && now >= slot.endAt) {
          slot.endedRendered = true;
          changedDays.add(day);
          dirty = true;
        }
      }
    }
    const allEnded = mission.days.every((d) => d.slots.every((s) => now >= s.endAt));
    if (allEnded) {
      mission.status = 'FINISHED';
      mission.closedAt = now;
      dirty = true;
    }
    if (dirty) await mission.save();
    if (allEnded) {
      await syncSecuMessages(client, mission).catch((err) => log.warn('Clôture de la sécurisation :', err.message));
      log.info(`Sécurisation ${mission.lieu} (${mission._id}) terminée automatiquement.`);
    } else {
      for (const day of changedDays) await refreshSecuDay(client, mission, day);
    }
  }
}
