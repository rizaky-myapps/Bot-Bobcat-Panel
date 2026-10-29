import { EmbedBuilder, InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { PatrolPlace } from '../../db/models/index.js';
import { audit } from '../../db/services/audit.js';
import { requireSuper } from '../utils/auth.js';
import { replyEphemeral } from '../utils/replies.js';
import { isValidEmoji } from '../utils/emoji.js';
import { autocompletePlaces, resolvePlace } from '../utils/placeAutocomplete.js';
import { refreshPatrolBoards } from '../services/patrol.js';
import { BRAND_NAME, COLORS } from '../../utils/constants.js';

export const data = new SlashCommandBuilder()
  .setName('patrol')
  .setDescription('Gérer les lieux de patrouille')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Ajouter un lieu de patrouille (super-user)')
      .addStringOption((o) => o.setName('nom').setDescription('Nom du lieu').setRequired(true).setMaxLength(60))
      .addStringOption((o) => o.setName('emoji').setDescription('Emoji unicode ou emoji custom du serveur').setRequired(true))
      .addNumberOption((o) =>
        o.setName('max_heures').setDescription('Limite d’heures par semaine (0 = illimité)').setRequired(true).setMinValue(0).setMaxValue(168),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('edit')
      .setDescription('Modifier un lieu de patrouille (super-user)')
      .addStringOption((o) => o.setName('cible').setDescription('Lieu à modifier').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('nom').setDescription('Nouveau nom').setMaxLength(60))
      .addStringOption((o) => o.setName('emoji').setDescription('Nouvel emoji'))
      .addNumberOption((o) => o.setName('max_heures').setDescription('Nouvelle limite hebdomadaire (0 = illimité)').setMinValue(0).setMaxValue(168))
      .addBooleanOption((o) => o.setName('actif').setDescription('Lieu actif (proposé dans les patrouilles)')),
  )
  .addSubcommand((s) =>
    s
      .setName('delete')
      .setDescription('Supprimer un lieu de patrouille (super-user)')
      .addStringOption((o) => o.setName('cible').setDescription('Lieu à supprimer').setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((s) => s.setName('list').setDescription('Lister les lieux de patrouille du serveur'));

export async function autocomplete(interaction) {
  return autocompletePlaces(interaction);
}

function auditPlace(interaction, action, place, summary) {
  return audit({
    guildId: interaction.guildId,
    actorId: interaction.user.id,
    actorName: interaction.user.username,
    action,
    targetType: 'place',
    targetId: place._id,
    summary,
  });
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (sub === 'list') {
    const places = await PatrolPlace.find({ guildId }).collation({ locale: 'fr', strength: 2 }).sort({ name: 1 }).lean();
    const lines = places.map(
      (p) =>
        `${p.emoji || '📍'} **${p.name}** — ${p.maxHoursPerWeek ? `${p.maxHoursPerWeek}h / semaine` : 'illimité'}${p.active ? '' : ' · *inactif*'}`,
    );
    const embed = new EmbedBuilder()
      .setColor(COLORS.brand)
      .setTitle(`📍 Lieux de patrouille (${places.length})`)
      .setDescription(lines.length ? lines.join('\n').slice(0, 4000) : '*Aucun lieu configuré. Utilise `/patrol add`.*')
      .setFooter({ text: BRAND_NAME });
    return replyEphemeral(interaction, { embeds: [embed] });
  }

  if (!(await requireSuper(interaction))) return;

  if (sub === 'add') {
    const name = interaction.options.getString('nom', true).trim();
    const emoji = interaction.options.getString('emoji', true).trim();
    const maxHours = interaction.options.getNumber('max_heures', true);
    if (!isValidEmoji(emoji)) return replyEphemeral(interaction, '❌ Emoji invalide. Utilise un emoji unicode (🏪) ou un emoji custom du serveur.');
    try {
      const place = await PatrolPlace.create({ guildId, name, emoji, maxHoursPerWeek: maxHours });
      await auditPlace(interaction, 'place.create', place, `Lieu ${name} créé`);
      await refreshPatrolBoards(interaction.client, guildId);
      return replyEphemeral(interaction, `✅ Lieu ${emoji} **${name}** ajouté (${maxHours ? `${maxHours}h / semaine` : 'illimité'}).`);
    } catch (err) {
      if (err.code === 11000) return replyEphemeral(interaction, `⚠️ Un lieu nommé **${name}** existe déjà.`);
      throw err;
    }
  }

  const place = await resolvePlace(guildId, interaction.options.getString('cible', true));
  if (!place) return replyEphemeral(interaction, '❌ Lieu introuvable.');

  if (sub === 'edit') {
    const name = interaction.options.getString('nom');
    const emoji = interaction.options.getString('emoji');
    const maxHours = interaction.options.getNumber('max_heures');
    const active = interaction.options.getBoolean('actif');
    if (emoji && !isValidEmoji(emoji.trim())) return replyEphemeral(interaction, '❌ Emoji invalide.');
    if (name) place.name = name.trim();
    if (emoji) place.emoji = emoji.trim();
    if (maxHours !== null) place.maxHoursPerWeek = maxHours;
    if (active !== null) place.active = active;
    try {
      await place.save();
    } catch (err) {
      if (err.code === 11000) return replyEphemeral(interaction, `⚠️ Un lieu nommé **${name}** existe déjà.`);
      throw err;
    }
    await auditPlace(interaction, 'place.update', place, `Lieu ${place.name} modifié`);
    await refreshPatrolBoards(interaction.client, guildId);
    return replyEphemeral(
      interaction,
      `✏️ Lieu mis à jour : ${place.emoji} **${place.name}** — ${place.maxHoursPerWeek ? `${place.maxHoursPerWeek}h / semaine` : 'illimité'}${place.active ? '' : ' (inactif)'}.`,
    );
  }

  if (sub === 'delete') {
    await place.deleteOne();
    await auditPlace(interaction, 'place.delete', place, `Lieu ${place.name} supprimé`);
    await refreshPatrolBoards(interaction.client, guildId);
    return replyEphemeral(interaction, `🗑️ Lieu **${place.name}** supprimé. L'historique des patrouilles est conservé.`);
  }
}
