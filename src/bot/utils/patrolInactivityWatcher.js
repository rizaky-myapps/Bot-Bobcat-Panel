import { PatrolSession } from '../../db/models/index.js';
import { getGuildConfig } from '../../db/services/permissions.js';
import { fetchChannel, messageLink } from './messages.js';
import { createLogger } from '../../utils/logger.js';
import { INTERVALS } from '../../utils/constants.js';

const log = createLogger('inactivity');

/**
 * Prévient le créateur d'une patrouille restée sans action depuis 45 minutes (configurable).
 * DM en priorité, sinon message avec mention dans le salon. L'avertissement est supprimé
 * dès qu'une nouvelle action a lieu ou que la patrouille est terminée.
 */
export async function checkInactivePatrols(client, now = new Date()) {
  const sessions = await PatrolSession.find({ status: 'OPEN', 'inactivityWarning.sentAt': null });
  for (const session of sessions) {
    const cfg = await getGuildConfig(session.guildId);
    const idleMinutes = cfg.settings?.patrolIdleMinutes || INTERVALS.patrolIdleTimeout / 60000;
    if (now - session.lastActivityAt < idleMinutes * 60 * 1000) continue;

    const link = session.messageId ? messageLink(session.guildId, session.channelId, session.messageId) : '';
    const text = `⏰ La patrouille **${session.unit}** est inactive depuis ${idleMinutes} minutes.\nPense à ajouter un lieu, quitter un lieu ou la terminer${link ? ` : ${link}` : '.'}`;
    let warning = null;
    try {
      const user = await client.users.fetch(session.authorId);
      const dm = await user.send(text);
      warning = { sentAt: now, viaDm: true, channelId: dm.channelId, messageId: dm.id };
    } catch {
      const channel = await fetchChannel(client, session.channelId);
      if (channel?.isSendable?.()) {
        try {
          const msg = await channel.send({
            content: `<@${session.authorId}> ${text}`,
            allowedMentions: { users: [session.authorId] },
          });
          warning = { sentAt: now, viaDm: false, channelId: msg.channelId, messageId: msg.id };
        } catch (err) {
          log.warn(`Avertissement impossible pour la patrouille ${session._id} :`, err.message);
        }
      }
    }
    // Même en cas d'échec, on note l'envoi pour ne pas réessayer toutes les 5 minutes.
    session.inactivityWarning = warning || { sentAt: now };
    await session.save();
    log.info(`Patrouille ${session.unit} (${session._id}) inactive : avertissement ${warning?.viaDm ? 'par DM' : 'dans le salon'}.`);
  }
}

export function startPatrolInactivityWatcher(client) {
  const run = () => checkInactivePatrols(client).catch((err) => log.error('Watcher en échec :', err));
  setTimeout(run, 30_000);
  return setInterval(run, INTERVALS.patrolInactivityCheck);
}
