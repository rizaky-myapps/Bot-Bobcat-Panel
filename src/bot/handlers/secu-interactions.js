import { MessageFlags } from 'discord.js';
import { SecuMission } from '../../db/models/index.js';
import { can } from '../utils/auth.js';
import { replyEphemeral } from '../utils/replies.js';
import { renderSecuDay } from '../renderers/secu.js';
import { formatDayLabel, formatHM } from '../../utils/times.js';
import { audit } from '../../db/services/audit.js';

export const prefix = 'secu';

export async function handle(interaction, action, args) {
  if (action !== 'toggle') return replyEphemeral(interaction, '❓ Action inconnue.');
  const [missionId, dayId, slotId] = args;
  const mission = await SecuMission.findById(missionId).catch(() => null);
  if (!mission) return replyEphemeral(interaction, '❌ Sécurisation introuvable.');
  if (mission.status !== 'OPEN') return replyEphemeral(interaction, '⚠️ Cette sécurisation est clôturée.');
  const day = mission.days.id(dayId);
  const slot = day?.slots.id(slotId);
  if (!slot) return replyEphemeral(interaction, '❌ Créneau introuvable (il a peut-être été modifié depuis le panel).');
  if (!(await can(interaction, 'agent'))) return replyEphemeral(interaction, "⛔ Tu n'as pas le rôle nécessaire pour t'inscrire.");
  if (new Date() >= slot.endAt) return replyEphemeral(interaction, '⏱️ Ce créneau est terminé.');

  const userId = interaction.user.id;
  const registered = slot.registrations.some((r) => r.userId === userId);
  const arrayFilters = [{ 'd._id': day._id }, { 's._id': slot._id }];
  let notice;

  if (registered) {
    await SecuMission.updateOne(
      { _id: mission._id },
      { $pull: { 'days.$[d].slots.$[s].registrations': { userId } } },
      { arrayFilters },
    );
    notice = `🗑️ Tu es désinscrit de **${slot.label}** (${formatDayLabel(slot.startAt)} ${formatHM(slot.startAt)} → ${formatHM(slot.endAt)}).`;
  } else {
    // Mise à jour atomique : n'inscrit que s'il reste de la place, même en cas de clics simultanés.
    const result = await SecuMission.updateOne(
      {
        _id: mission._id,
        days: {
          $elemMatch: {
            _id: day._id,
            slots: {
              $elemMatch: {
                _id: slot._id,
                [`registrations.${slot.capacity - 1}`]: { $exists: false },
                'registrations.userId': { $ne: userId },
              },
            },
          },
        },
      },
      { $push: { 'days.$[d].slots.$[s].registrations': { userId, at: new Date(), by: userId } } },
      { arrayFilters },
    );
    notice = result.modifiedCount
      ? `✅ Inscrit sur **${slot.label}** — ${formatDayLabel(slot.startAt)} ${formatHM(slot.startAt)} → ${formatHM(slot.endAt)}.`
      : `🚫 **${slot.label}** est complet.`;
  }

  const fresh = await SecuMission.findById(mission._id);
  const freshDay = fresh.days.id(dayId);
  await interaction.update(renderSecuDay(fresh, freshDay));
  await interaction.followUp({ content: notice, flags: MessageFlags.Ephemeral });
  await audit({
    guildId: mission.guildId,
    actorId: userId,
    actorName: interaction.user.username,
    action: registered ? 'secu.unregister' : 'secu.register',
    targetType: 'secu',
    targetId: mission._id,
    summary: `${registered ? 'Désinscription' : 'Inscription'} ${slot.label} ${formatDayLabel(slot.startAt)} — ${mission.lieu}`,
  });
}
