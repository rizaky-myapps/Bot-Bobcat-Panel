import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { AtmMission } from '../../db/models/index.js';
import { audit } from '../../db/services/audit.js';
import { ATM_FREQUENCIES } from '../../utils/constants.js';
import { combineDateTime, parseDateInput, parseTimeInput, formatDayLabel, formatHM } from '../../utils/times.js';
import { requirePermission } from '../utils/auth.js';
import { replyEphemeral } from '../utils/replies.js';
import { messageLink } from '../utils/messages.js';
import { renderAtm } from '../renderers/missions.js';
import { addAvailabilityReactions } from '../services/missions.js';

export const data = new SlashCommandBuilder()
  .setName('atm')
  .setDescription('Créer une mission ATM')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) => o.setName('date').setDescription('Date de la mission (ex : 16/05)').setRequired(true).setMaxLength(10))
  .addStringOption((o) => o.setName('heure').setDescription('Heure de la mission (ex : 21h, 21:30, 2130)').setRequired(true).setMaxLength(5))
  .addStringOption((o) =>
    o
      .setName('frequence')
      .setDescription('Fréquence radio')
      .setRequired(true)
      .addChoices(...ATM_FREQUENCIES.map((f) => ({ name: f, value: f }))),
  )
  .addRoleOption((o) => o.setName('mention').setDescription('Rôle à mentionner (optionnel)'));

export async function execute(interaction) {
  if (!(await requirePermission(interaction, 'atm', "⛔ Tu n'as pas la permission de créer une mission ATM."))) return;
  const date = parseDateInput(interaction.options.getString('date', true));
  if (!date) return replyEphemeral(interaction, '❌ Date invalide (ex : 16/05).');
  const hm = parseTimeInput(interaction.options.getString('heure', true));
  if (!hm) return replyEphemeral(interaction, '❌ Heure invalide (ex : 21h, 21:30, 2130).');

  const existing = await AtmMission.findOne({ guildId: interaction.guildId, createdBy: interaction.user.id, status: 'OPEN' });
  if (existing) {
    const link = existing.messageId ? ` : ${messageLink(existing.guildId, existing.channelId, existing.messageId)}` : '.';
    return replyEphemeral(interaction, `⚠️ Tu as déjà une mission ATM ouverte${link}\nTermine-la ou annule-la avant d'en créer une autre.`);
  }

  const scheduledAt = combineDateTime(date, hm);
  const mention = interaction.options.getRole('mention');
  const mission = await AtmMission.create({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    createdBy: interaction.user.id,
    dateStr: interaction.options.getString('date', true),
    timeStr: interaction.options.getString('heure', true),
    scheduledAt,
    frequency: interaction.options.getString('frequence', true),
    mentionRoleId: mention?.id || null,
  });
  try {
    await interaction.reply(renderAtm(mission, { withMention: true }));
    const message = await interaction.fetchReply();
    mission.messageId = message.id;
    await mission.save();
    await addAvailabilityReactions(message);
  } catch (err) {
    await AtmMission.deleteOne({ _id: mission._id });
    throw err;
  }
  await audit({
    guildId: interaction.guildId,
    actorId: interaction.user.id,
    actorName: interaction.user.username,
    action: 'atm.create',
    targetType: 'atm',
    targetId: mission._id,
    summary: `Mission ATM du ${formatDayLabel(scheduledAt)} à ${formatHM(scheduledAt)} créée`,
  });
}
