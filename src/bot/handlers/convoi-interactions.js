import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { ConvoiMission } from '../../db/models/index.js';
import { audit } from '../../db/services/audit.js';
import { CONVOI_ROLES } from '../../utils/constants.js';
import { combineDateTime, formatDayLabel, formatHM, formatDateShort, parseDateInput, parseTimeInput } from '../../utils/times.js';
import { can } from '../utils/auth.js';
import { replyEphemeral, updateEphemeral } from '../utils/replies.js';
import { buildModal, getText } from '../utils/modals.js';
import { truncate } from '../utils/messages.js';
import { DISPATCH_ACTIONS, handleDispatch } from './dispatch.js';
import { notifyMission, refreshConvoiMessage } from '../services/missions.js';

export const prefix = 'convoi';

export const convoiDispatchConfig = {
  prefix: 'convoi',
  entity: 'convoi',
  roles: CONVOI_ROLES,
  title: (m) => `Convoi du ${formatDayLabel(m.scheduledAt)} à ${formatHM(m.scheduledAt)}`,
  refresh: (client, mission) => refreshConvoiMessage(client, mission),
};

async function canManage(interaction, mission) {
  return mission.createdBy === interaction.user.id || can(interaction, 'convoi');
}

function auditConvoi(interaction, mission, action, summary) {
  return audit({
    guildId: mission.guildId,
    actorId: interaction.user.id,
    actorName: interaction.user.username,
    action,
    targetType: 'convoi',
    targetId: mission._id,
    summary,
  });
}

export async function handle(interaction, action, args) {
  if (action === 'abort') return updateEphemeral(interaction, 'Action annulée.');
  const mission = await ConvoiMission.findById(args[0]).catch(() => null);
  if (!mission) return replyEphemeral(interaction, '❌ Convoi introuvable.');
  if (mission.status !== 'OPEN') return replyEphemeral(interaction, '⚠️ Ce convoi est clôturé.');
  if (!(await canManage(interaction, mission))) {
    return replyEphemeral(interaction, '⛔ Seuls le responsable du convoi et les rôles autorisés peuvent faire ça.');
  }
  const title = convoiDispatchConfig.title(mission);

  if (DISPATCH_ACTIONS.has(action)) return handleDispatch(interaction, action, mission, convoiDispatchConfig);

  switch (action) {
    case 'reschedule':
      return interaction.showModal(
        buildModal({
          customId: `convoi:reschedmodal:${mission._id}`,
          title: 'Reprogrammer le convoi',
          fields: [
            { id: 'date', label: 'Nouvelle date', value: formatDateShort(mission.scheduledAt), placeholder: '17/05', maxLength: 10 },
            { id: 'time', label: 'Nouvelle heure', value: formatHM(mission.scheduledAt), placeholder: '21h, 21:30, 2130', maxLength: 5 },
          ],
        }),
      );

    case 'reschedmodal': {
      const date = parseDateInput(getText(interaction, 'date'));
      const hm = parseTimeInput(getText(interaction, 'time'));
      if (!date || !hm) return replyEphemeral(interaction, '❌ Date ou heure invalide (ex : 17/05 et 21h).');
      const from = mission.scheduledAt;
      const to = combineDateTime(date, hm);
      if (to.getTime() === from.getTime()) return replyEphemeral(interaction, 'ℹ️ La date et l’heure sont identiques.');
      mission.scheduledAt = to;
      mission.dateStr = getText(interaction, 'date');
      mission.timeStr = getText(interaction, 'time');
      mission.reschedules.push({ from, to, by: interaction.user.id, at: new Date() });
      await mission.save();
      await refreshConvoiMessage(interaction.client, mission);
      await notifyMission(
        interaction.client,
        mission,
        `🗓️ Convoi reprogrammé : ~~${formatDayLabel(from)} à ${formatHM(from)}~~ → **${formatDayLabel(to)} à ${formatHM(to)}**.\nPensez à mettre à jour votre disponibilité.`,
      );
      await auditConvoi(interaction, mission, 'convoi.reschedule', `Convoi reprogrammé au ${formatDayLabel(to)} ${formatHM(to)}`);
      return replyEphemeral(interaction, '🗓️ Convoi reprogrammé, les agents ont été prévenus.');
    }

    case 'finish':
      return replyEphemeral(interaction, {
        content: `🏁 Terminer le **${title}** ?`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`convoi:confirmfinish:${mission._id}`).setLabel('Confirmer la fin').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`convoi:abort:${mission._id}`).setLabel('Retour').setStyle(ButtonStyle.Secondary),
          ),
        ],
      });

    case 'confirmfinish':
      mission.status = 'FINISHED';
      mission.closedAt = new Date();
      mission.closedBy = interaction.user.id;
      await mission.save();
      await refreshConvoiMessage(interaction.client, mission);
      await auditConvoi(interaction, mission, 'convoi.finish', `${title} terminé`);
      return updateEphemeral(interaction, '🏁 Convoi terminé.');

    case 'cancel':
      return interaction.showModal(
        buildModal({
          customId: `convoi:cancelmodal:${mission._id}`,
          title: 'Annuler le convoi',
          fields: [{ id: 'reason', label: "Raison de l'annulation (optionnel)", required: false, paragraph: true, maxLength: 300 }],
        }),
      );

    case 'cancelmodal':
      mission.status = 'CANCELLED';
      mission.closedAt = new Date();
      mission.closedBy = interaction.user.id;
      mission.cancelReason = truncate(getText(interaction, 'reason'), 300);
      await mission.save();
      await refreshConvoiMessage(interaction.client, mission);
      await notifyMission(
        interaction.client,
        mission,
        `✖️ Le **${title}** est annulé par <@${interaction.user.id}>.${mission.cancelReason ? `\nRaison : *${mission.cancelReason}*` : ''}`,
      );
      await auditConvoi(interaction, mission, 'convoi.cancel', `${title} annulé`);
      return replyEphemeral(interaction, '✖️ Convoi annulé, les agents concernés ont été prévenus.');

    default:
      return replyEphemeral(interaction, '❓ Action inconnue.');
  }
}
