import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { AtmMission } from '../../db/models/index.js';
import { audit } from '../../db/services/audit.js';
import { ATM_ROLES } from '../../utils/constants.js';
import { formatDayLabel, formatHM } from '../../utils/times.js';
import { can } from '../utils/auth.js';
import { replyEphemeral, updateEphemeral } from '../utils/replies.js';
import { buildModal, getText } from '../utils/modals.js';
import { truncate } from '../utils/messages.js';
import { DISPATCH_ACTIONS, handleDispatch } from './dispatch.js';
import { notifyMission, refreshAtmMessage, refreshPdsForMission } from '../services/missions.js';

export const prefix = 'atm';

export const atmDispatchConfig = {
  prefix: 'atm',
  entity: 'atm',
  roles: ATM_ROLES,
  title: (m) => `Mission ATM du ${formatDayLabel(m.scheduledAt)} à ${formatHM(m.scheduledAt)}`,
  refresh: async (client, mission) => {
    await refreshAtmMessage(client, mission);
    await refreshPdsForMission(client, mission);
  },
};

async function canManage(interaction, mission) {
  return mission.createdBy === interaction.user.id || can(interaction, 'atm');
}

function confirmRow(id, action, label) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`atm:${action}:${id}`).setLabel(label).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`atm:abort:${id}`).setLabel('Retour').setStyle(ButtonStyle.Secondary),
  );
}

export async function handle(interaction, action, args) {
  if (action === 'abort') return updateEphemeral(interaction, 'Action annulée.');
  const mission = await AtmMission.findById(args[0]).catch(() => null);
  if (!mission) return replyEphemeral(interaction, '❌ Mission ATM introuvable.');
  if (mission.status !== 'OPEN') return replyEphemeral(interaction, '⚠️ Cette mission est clôturée.');
  if (!(await canManage(interaction, mission))) {
    return replyEphemeral(interaction, '⛔ Seuls le responsable de la mission et les rôles autorisés peuvent faire ça.');
  }
  const title = atmDispatchConfig.title(mission);

  if (DISPATCH_ACTIONS.has(action)) return handleDispatch(interaction, action, mission, atmDispatchConfig);

  switch (action) {
    case 'finish':
      return replyEphemeral(interaction, {
        content: `🏁 Terminer la **${title}** ?`,
        components: [confirmRow(mission._id, 'confirmfinish', 'Confirmer la fin')],
      });

    case 'confirmfinish': {
      mission.status = 'FINISHED';
      mission.closedAt = new Date();
      mission.closedBy = interaction.user.id;
      await mission.save();
      await refreshAtmMessage(interaction.client, mission);
      await audit({
        guildId: mission.guildId,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
        action: 'atm.finish',
        targetType: 'atm',
        targetId: mission._id,
        summary: `${title} terminée`,
      });
      return updateEphemeral(interaction, '🏁 Mission terminée.');
    }

    case 'cancel':
      return interaction.showModal(
        buildModal({
          customId: `atm:cancelmodal:${mission._id}`,
          title: 'Annuler la mission ATM',
          fields: [{ id: 'reason', label: "Raison de l'annulation (optionnel)", required: false, paragraph: true, maxLength: 300 }],
        }),
      );

    case 'cancelmodal': {
      mission.status = 'CANCELLED';
      mission.closedAt = new Date();
      mission.closedBy = interaction.user.id;
      mission.cancelReason = truncate(getText(interaction, 'reason'), 300);
      await mission.save();
      await refreshAtmMessage(interaction.client, mission);
      await notifyMission(
        interaction.client,
        mission,
        `✖️ La **${title}** est annulée par <@${interaction.user.id}>.${mission.cancelReason ? `\nRaison : *${mission.cancelReason}*` : ''}`,
      );
      await audit({
        guildId: mission.guildId,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
        action: 'atm.cancel',
        targetType: 'atm',
        targetId: mission._id,
        summary: `${title} annulée`,
      });
      return replyEphemeral(interaction, '✖️ Mission annulée, les agents concernés ont été prévenus.');
    }

    default:
      return replyEphemeral(interaction, '❓ Action inconnue.');
  }
}
