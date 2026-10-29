import { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { audit } from '../../db/services/audit.js';

export const data = new SlashCommandBuilder()
  .setName('clear')
  .setDescription('Supprimer des messages récents du salon')
  .setContexts(InteractionContextType.Guild)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addIntegerOption((o) =>
    o.setName('nombre').setDescription('Nombre de messages à supprimer (1 à 100)').setRequired(true).setMinValue(1).setMaxValue(100),
  )
  .addUserOption((o) => o.setName('membre').setDescription('Ne supprimer que les messages de ce membre'));

export async function execute(interaction) {
  const amount = interaction.options.getInteger('nombre', true);
  const user = interaction.options.getUser('membre');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let messages = await interaction.channel.messages.fetch({ limit: 100 });
  if (user) messages = messages.filter((m) => m.author.id === user.id);
  const toDelete = [...messages.values()].slice(0, amount);
  // Discord ne permet pas la suppression groupée des messages de plus de 14 jours.
  const deleted = await interaction.channel.bulkDelete(toDelete, true);
  await audit({
    guildId: interaction.guildId,
    actorId: interaction.user.id,
    actorName: interaction.user.username,
    action: 'utils.clear',
    targetType: 'channel',
    targetId: interaction.channelId,
    summary: `${deleted.size} message(s) supprimé(s)`,
  });
  const skipped = toDelete.length - deleted.size;
  return interaction.editReply(
    `🧹 ${deleted.size} message(s) supprimé(s).${skipped ? `\n⚠️ ${skipped} message(s) de plus de 14 jours ignoré(s).` : ''}`,
  );
}
