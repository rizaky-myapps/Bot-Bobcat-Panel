import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { ConvoiMission } from '../../db/models/index.js';
import { audit } from '../../db/services/audit.js';
import { combineDateTime, parseDateInput, parseTimeInput, formatDayLabel, formatHM } from '../../utils/times.js';
import { requirePermission } from '../utils/auth.js';
import { replyEphemeral } from '../utils/replies.js';
import { renderConvoi } from '../renderers/missions.js';
import { addAvailabilityReactions } from '../services/missions.js';

export const data = new SlashCommandBuilder()
  .setName('convoi')
  .setDescription('Créer un ordre de mission pour un convoi de fonds')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) => o.setName('date').setDescription('Date (ex : 17/05)').setRequired(true).setMaxLength(10))
  .addStringOption((o) => o.setName('heure').setDescription('Heure (ex : 21h, 21:30, 2130)').setRequired(true).setMaxLength(5))
  .addStringOption((o) => o.setName('notes').setDescription('Informations complémentaires (optionnel)').setMaxLength(500));

export async function execute(interaction) {
  if (!(await requirePermission(interaction, 'convoi', '⛔ Création de convoi réservée aux super-users et rôles autorisés.'))) return;
  const date = parseDateInput(interaction.options.getString('date', true));
  if (!date) return replyEphemeral(interaction, '❌ Date invalide (ex : 17/05).');
  const hm = parseTimeInput(interaction.options.getString('heure', true));
  if (!hm) return replyEphemeral(interaction, '❌ Heure invalide (ex : 21h, 21:30, 2130).');
  const scheduledAt = combineDateTime(date, hm);

  const mission = await ConvoiMission.create({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    createdBy: interaction.user.id,
    dateStr: interaction.options.getString('date', true),
    timeStr: interaction.options.getString('heure', true),
    scheduledAt,
    notes: interaction.options.getString('notes') || '',
  });
  try {
    await interaction.reply(renderConvoi(mission));
    const message = await interaction.fetchReply();
    mission.messageId = message.id;
    await mission.save();
    await addAvailabilityReactions(message);
  } catch (err) {
    await ConvoiMission.deleteOne({ _id: mission._id });
    throw err;
  }
  await audit({
    guildId: interaction.guildId,
    actorId: interaction.user.id,
    actorName: interaction.user.username,
    action: 'convoi.create',
    targetType: 'convoi',
    targetId: mission._id,
    summary: `Convoi du ${formatDayLabel(scheduledAt)} à ${formatHM(scheduledAt)} créé`,
  });
}
