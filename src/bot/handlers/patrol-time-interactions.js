import { resetAllTime } from '../../db/services/patrolTime.js';
import { audit } from '../../db/services/audit.js';
import { requireSuper } from '../utils/auth.js';
import { updateEphemeral } from '../utils/replies.js';
import { refreshPatrolBoards } from '../services/patrol.js';
import { isoWeek } from '../../utils/times.js';

export const prefix = 'ptreset';

export async function handle(interaction, action, args) {
  if (action !== 'all') return;
  if (args[0] === 'cancel') return updateEphemeral(interaction, 'Réinitialisation annulée.');
  if (!(await requireSuper(interaction))) return;
  const week = isoWeek();
  await resetAllTime(interaction.guildId, week);
  await audit({
    guildId: interaction.guildId,
    actorId: interaction.user.id,
    actorName: interaction.user.username,
    action: 'patrolTime.resetAll',
    summary: `Tous les temps réinitialisés (semaine ${week.week})`,
  });
  await refreshPatrolBoards(interaction.client, interaction.guildId);
  return updateEphemeral(interaction, `♻️ Tous les temps de patrouille de la semaine ${week.week} ont été réinitialisés.`);
}
