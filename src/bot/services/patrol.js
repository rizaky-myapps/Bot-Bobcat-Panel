import { PatrolSession, PatrolTimeBoard } from '../../db/models/index.js';
import { getWeekBoard, syncSessionTracking } from '../../db/services/patrolTime.js';
import { renderPatrol, renderPatrolTimeBoard } from '../renderers/patrol.js';
import { editMessage, deleteMessage } from '../utils/messages.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('patrol');

export async function refreshPatrolMessage(client, session) {
  if (!session.messageId) return 'gone';
  const result = await editMessage(client, session.channelId, session.messageId, renderPatrol(session));
  if (result === 'gone') log.warn(`Message de la patrouille ${session._id} introuvable (supprimé ?).`);
  return result;
}

/** Supprime l'avertissement d'inactivité (DM ou salon). Ne sauvegarde pas la session. */
export async function clearInactivityWarning(client, session) {
  const warning = session.inactivityWarning;
  if (!warning?.sentAt) return;
  if (warning.messageId) {
    if (warning.viaDm) {
      try {
        const user = await client.users.fetch(session.authorId);
        const dm = await user.createDM();
        await dm.messages.delete(warning.messageId);
      } catch {
        // DM déjà supprimé ou fermé.
      }
    } else {
      await deleteMessage(client, warning.channelId, warning.messageId);
    }
  }
  session.inactivityWarning = undefined;
}

/** À appeler à chaque action sur une patrouille. Ne sauvegarde pas la session. */
export async function touchSession(client, session) {
  session.lastActivityAt = new Date();
  await clearInactivityWarning(client, session);
}

/** Termine une patrouille : ferme les lieux ouverts, compte le temps, met à jour les tableaux. */
export async function finishPatrolSession(client, session, { endAt = new Date(), actorId } = {}) {
  session.endAt = endAt;
  for (const visit of session.places) {
    if (!visit.leftAt) visit.leftAt = visit.arrivedAt > endAt ? visit.arrivedAt : endAt;
  }
  session.status = 'FINISHED';
  session.finishedBy = actorId;
  await clearInactivityWarning(client, session);
  await syncSessionTracking(session);
  await session.save();
  await refreshPatrolMessage(client, session);
  await refreshPatrolBoards(client, session.guildId);
  return session;
}

/** Met à jour tous les tableaux /patrol-time d'un serveur. */
export async function refreshPatrolBoards(client, guildId) {
  const boards = await PatrolTimeBoard.find(guildId ? { guildId } : {}).lean();
  if (!boards.length) return;
  const dataByGuild = new Map();
  for (const board of boards) {
    if (!dataByGuild.has(board.guildId)) dataByGuild.set(board.guildId, await getWeekBoard(board.guildId));
    const result = await editMessage(client, board.channelId, board.messageId, renderPatrolTimeBoard(dataByGuild.get(board.guildId)));
    if (result === 'gone') {
      await PatrolTimeBoard.deleteOne({ _id: board._id });
      log.info(`Tableau /patrol-time supprimé du salon ${board.channelId} (message introuvable).`);
    }
  }
}

export async function findOpenSessionInChannel(guildId, channelId) {
  return PatrolSession.findOne({ guildId, channelId, status: 'OPEN' });
}
