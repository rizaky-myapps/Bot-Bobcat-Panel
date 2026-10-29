import {
  ContainerBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorSpacingSize,
  SlashCommandBuilder,
} from 'discord.js';
import { COLORS, EMOJIS } from '../../utils/constants.js';

export const data = new SlashCommandBuilder()
  .setName('separateur')
  .setDescription('Ajouter un séparateur visuel dans le salon')
  .setContexts(InteractionContextType.Guild)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addStringOption((o) => o.setName('titre').setDescription('Titre affiché au milieu (optionnel)').setMaxLength(100));

export function renderSeparator(title) {
  const container = new ContainerBuilder().setAccentColor(COLORS.brand);
  if (title) {
    container
      .addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Large))
      .addTextDisplayComponents((t) => t.setContent(`### ${EMOJIS.bobcat} ${title}`))
      .addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Large));
  } else {
    container.addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Large));
  }
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

export async function execute(interaction) {
  try {
    await interaction.channel.send(renderSeparator(interaction.options.getString('titre')));
  } catch {
    return interaction.reply({ content: "❌ Impossible d'envoyer le séparateur ici.", flags: MessageFlags.Ephemeral });
  }
  return interaction.reply({ content: '✅ Séparateur ajouté.', flags: MessageFlags.Ephemeral });
}
