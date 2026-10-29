import { ActionRowBuilder, ButtonBuilder, ButtonStyle, InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { resetPlaceTime } from '../../db/services/patrolTime.js';
import { audit } from '../../db/services/audit.js';
import { requireSuper } from '../utils/auth.js';
import { replyEphemeral } from '../utils/replies.js';
import { autocompletePlaces, resolvePlace } from '../utils/placeAutocomplete.js';
import { refreshPatrolBoards } from '../services/patrol.js';
import { isoWeek } from '../../utils/times.js';

export const data = new SlashCommandBuilder()
  .setName('patrol-time-reset')
  .setDescription('Réinitialiser les temps de patrouille de la semaine (super-user)')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('lieu')
      .setDescription("Réinitialiser le temps d'un lieu")
      .addStringOption((o) => o.setName('lieu').setDescription('Lieu à réinitialiser').setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((s) => s.setName('tous').setDescription('Réinitialiser le temps de tous les lieux'));

export async function autocomplete(interaction) {
  return autocompletePlaces(interaction);
}

export async function execute(interaction) {
  if (!(await requireSuper(interaction))) return;
  const week = isoWeek();
  if (interaction.options.getSubcommand() === 'tous') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ptreset:all:confirm').setLabel('Oui, tout réinitialiser').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('ptreset:all:cancel').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
    );
    return replyEphemeral(interaction, {
      content: `⚠️ Réinitialiser **tous** les temps de patrouille de la semaine ${week.week} ? Cette action est irréversible.`,
      components: [row],
    });
  }
  const place = await resolvePlace(interaction.guildId, interaction.options.getString('lieu', true));
  if (!place) return replyEphemeral(interaction, '❌ Lieu introuvable.');
  await resetPlaceTime(interaction.guildId, place._id, week);
  await audit({
    guildId: interaction.guildId,
    actorId: interaction.user.id,
    actorName: interaction.user.username,
    action: 'patrolTime.reset',
    targetType: 'place',
    targetId: place._id,
    summary: `Temps de ${place.name} réinitialisé (semaine ${week.week})`,
  });
  await refreshPatrolBoards(interaction.client, interaction.guildId);
  return replyEphemeral(interaction, `♻️ Temps de **${place.name}** réinitialisé pour la semaine ${week.week}.`);
}
