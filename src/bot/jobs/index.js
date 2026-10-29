import { INTERVALS } from '../../utils/constants.js';
import { createLogger } from '../../utils/logger.js';
import { startPatrolInactivityWatcher } from '../utils/patrolInactivityWatcher.js';
import { refreshPatrolBoards } from '../services/patrol.js';
import { runSecuScheduler } from '../services/secu.js';
import { processPanelActions, resetStuckActions } from './panelActions.js';
import { startTempCleanup } from './tempCleanup.js';
import { BotHeartbeat } from '../../db/models/index.js';

const log = createLogger('jobs');

function every(ms, name, fn) {
  let busy = false;
  return setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (err) {
      log.error(`Tâche « ${name} » en échec :`, err);
    } finally {
      busy = false;
    }
  }, ms);
}

async function heartbeat(client, startedAt) {
  await BotHeartbeat.updateOne(
    { _id: 'bot' },
    { $set: { tag: client.user?.tag, guildIds: [...client.guilds.cache.keys()], startedAt, updatedAt: new Date() } },
    { upsert: true },
  );
}

export async function startJobs(client) {
  await resetStuckActions();
  const startedAt = new Date();
  await heartbeat(client, startedAt);
  const timers = [
    every(60_000, 'heartbeat', () => heartbeat(client, startedAt)),
    startPatrolInactivityWatcher(client),
    every(INTERVALS.patrolTimeRefresh, 'patrol-time', () => refreshPatrolBoards(client)),
    every(INTERVALS.scheduler, 'sécurisations', () => runSecuScheduler(client)),
    every(INTERVALS.panelActions, 'actions du panel', () => processPanelActions(client)),
    startTempCleanup(),
  ];
  log.info('Tâches planifiées démarrées (inactivité 5 min, patrol-time 15 min, rappels 1 min, panel 5 s, nettoyage 12 h).');
  return () => timers.forEach(clearInterval);
}
