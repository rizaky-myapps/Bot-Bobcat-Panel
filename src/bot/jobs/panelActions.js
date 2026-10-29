import {
  AtmMission,
  ConvoiMission,
  PanelAction,
  PatrolSession,
  PdsSession,
  SecuMission,
} from '../../db/models/index.js';
import { refreshPatrolBoards, refreshPatrolMessage, clearInactivityWarning } from '../services/patrol.js';
import {
  addAvailabilityReactions,
  notifyMission,
  refreshAtmMessage,
  refreshConvoiMessage,
  refreshPdsForMission,
  refreshPdsMessage,
} from '../services/missions.js';
import { syncSecuMessages } from '../services/secu.js';
import { renderConvoi } from '../renderers/missions.js';
import { deleteMessage, fetchChannel } from '../utils/messages.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('panel-actions');
const MAX_ATTEMPTS = 3;

/** Actions demandées par le panel web, exécutées par le bot. */
const HANDLERS = {
  'patrol:refresh': async (client, action) => {
    const session = await PatrolSession.findById(action.entityId);
    if (!session) return;
    if (session.status === 'FINISHED' && session.inactivityWarning?.sentAt) {
      await clearInactivityWarning(client, session);
      await session.save();
    }
    await refreshPatrolMessage(client, session);
    if (session.status === 'FINISHED') await refreshPatrolBoards(client, session.guildId);
  },
  'patrolTime:refresh': (client, action) => refreshPatrolBoards(client, action.guildId),
  'atm:refresh': async (client, action) => {
    const mission = await AtmMission.findById(action.entityId);
    if (!mission) return;
    await refreshAtmMessage(client, mission);
    await refreshPdsForMission(client, mission);
    if (action.payload?.message) await notifyMission(client, mission, action.payload.message);
  },
  'convoi:refresh': async (client, action) => {
    const mission = await ConvoiMission.findById(action.entityId);
    if (!mission) return;
    await refreshConvoiMessage(client, mission);
    if (action.payload?.message) await notifyMission(client, mission, action.payload.message);
  },
  'convoi:publish': async (client, action) => {
    const mission = await ConvoiMission.findById(action.entityId);
    if (!mission || mission.messageId) return;
    const channel = await fetchChannel(client, mission.channelId);
    if (!channel?.isSendable?.()) throw new Error('Salon inaccessible');
    const message = await channel.send(renderConvoi(mission));
    mission.messageId = message.id;
    await mission.save();
    await addAvailabilityReactions(message);
  },
  'pds:refresh': async (client, action) => {
    const pds = await PdsSession.findById(action.entityId);
    if (pds) await refreshPdsMessage(client, pds);
  },
  'secu:publish': async (client, action) => {
    const mission = await SecuMission.findById(action.entityId);
    if (mission) await syncSecuMessages(client, mission, { removedMessageIds: action.payload?.removedMessageIds || [] });
  },
  'secu:refresh': async (client, action) => {
    const mission = await SecuMission.findById(action.entityId);
    if (!mission) return;
    await syncSecuMessages(client, mission, { removedMessageIds: action.payload?.removedMessageIds || [] });
    if (action.payload?.message) {
      const users = [...new Set(mission.days.flatMap((d) => d.slots.flatMap((s) => s.registrations.map((r) => r.userId))))];
      const channel = await fetchChannel(client, mission.channelId);
      await channel
        ?.send({
          content: `${action.payload.message}${users.length ? `\n${users.map((id) => `<@${id}>`).join(' ')}` : ''}`.slice(0, 2000),
          allowedMentions: { users },
        })
        .catch((err) => log.warn('Notification de sécurisation impossible :', err.message));
    }
  },
  'message:delete': async (client, action) => {
    for (const { channelId, messageId } of action.payload?.messages || []) await deleteMessage(client, channelId, messageId);
  },
};

let running = false;

export async function processPanelActions(client) {
  if (running) return;
  running = true;
  try {
    for (let i = 0; i < 20; i++) {
      const action = await PanelAction.findOneAndUpdate(
        { status: 'PENDING' },
        { $set: { status: 'PROCESSING' }, $inc: { attempts: 1 } },
        { sort: { createdAt: 1 }, returnDocument: 'after' },
      );
      if (!action) break;
      const handler = HANDLERS[`${action.entity}:${action.type}`];
      try {
        if (!handler) throw new Error(`Action inconnue : ${action.entity}:${action.type}`);
        if (!client.guilds.cache.has(action.guildId)) throw new Error(`Le bot n'est pas sur le serveur ${action.guildId}`);
        await handler(client, action);
        action.status = 'DONE';
        action.error = undefined;
      } catch (err) {
        log.warn(`Action ${action.entity}:${action.type} en échec (essai ${action.attempts}) :`, err.message);
        action.status = action.attempts >= MAX_ATTEMPTS ? 'ERROR' : 'PENDING';
        action.error = err.message;
      }
      action.processedAt = new Date();
      await action.save();
    }
  } finally {
    running = false;
  }
}

/** Remet en file les actions interrompues par un arrêt du bot. */
export async function resetStuckActions() {
  await PanelAction.updateMany({ status: 'PROCESSING' }, { $set: { status: 'PENDING' } });
}
