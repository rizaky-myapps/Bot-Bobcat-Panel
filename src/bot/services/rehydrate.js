import { AtmMission, ConvoiMission, PatrolSession, PdsSession, SecuMission } from '../../db/models/index.js';
import { refreshPatrolBoards, refreshPatrolMessage } from './patrol.js';
import {
  refreshAtmMessage,
  refreshConvoiMessage,
  refreshPdsMessage,
  syncAvailabilityFromReactions,
} from './missions.js';
import { syncSecuMessages } from './secu.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('rehydrate');

/**
 * Au démarrage : restaure l'état des messages Discord des sessions en cours
 * (patrouilles, PDS, missions ATM / convoi, sécurisations, tableaux de temps).
 */
export async function rehydrate(client) {
  const guildIds = [...client.guilds.cache.keys()];
  const filter = { guildId: { $in: guildIds }, status: 'OPEN' };
  const counts = { patrouilles: 0, pds: 0, atm: 0, convois: 0, secu: 0 };

  for (const session of await PatrolSession.find(filter)) {
    if ((await refreshPatrolMessage(client, session)) === 'ok') counts.patrouilles++;
  }
  for (const pds of await PdsSession.find(filter)) {
    if ((await refreshPdsMessage(client, pds)) === 'ok') counts.pds++;
  }
  for (const mission of await AtmMission.find(filter)) {
    await syncAvailabilityFromReactions(client, AtmMission, mission);
    if ((await refreshAtmMessage(client, mission)) === 'ok') counts.atm++;
  }
  for (const mission of await ConvoiMission.find(filter)) {
    await syncAvailabilityFromReactions(client, ConvoiMission, mission);
    if ((await refreshConvoiMessage(client, mission)) === 'ok') counts.convois++;
  }
  for (const mission of await SecuMission.find({ ...filter, published: true })) {
    try {
      await syncSecuMessages(client, mission);
      counts.secu++;
    } catch (err) {
      log.warn(`Sécurisation ${mission._id} non restaurée :`, err.message);
    }
  }
  await refreshPatrolBoards(client);
  log.success(
    `Sessions restaurées — patrouilles : ${counts.patrouilles}, PDS : ${counts.pds}, ATM : ${counts.atm}, convois : ${counts.convois}, sécurisations : ${counts.secu}`,
  );
}
