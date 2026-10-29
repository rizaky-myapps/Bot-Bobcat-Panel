import { ChannelType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { audit } from '../../db/services/audit.js';

export const data = new SlashCommandBuilder()
  .setName('say')
  .setDescription('Faire parler le bot')
  .setContexts(InteractionContextType.Guild)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addStringOption((o) => o.setName('message').setDescription('Message à envoyer (\\n pour un retour à la ligne)').setRequired(true).setMaxLength(2000))
  .addChannelOption((o) =>
    o.setName('salon').setDescription('Salon cible (par défaut : ce salon)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
  );

export async function execute(interaction) {
  const content = interaction.options.getString('message', true).replace(/\\n/g, '\n');
  const channel = interaction.options.getChannel('salon') || interaction.channel;
  try {
    await channel.send({ content, allowedMentions: { parse: ['users', 'roles'] } });
  } catch {
    return interaction.reply({ content: "❌ Impossible d'envoyer le message dans ce salon.", flags: MessageFlags.Ephemeral });
  }
  await audit({
    guildId: interaction.guildId,
    actorId: interaction.user.id,
    actorName: interaction.user.username,
    action: 'utils.say',
    targetType: 'channel',
    targetId: channel.id,
    summary: content.slice(0, 200),
  });
  return interaction.reply({ content: '✅ Message envoyé.', flags: MessageFlags.Ephemeral });
}
