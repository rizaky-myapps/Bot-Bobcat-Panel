import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { PatrolTimeBoard } from '../../db/models/index.js';
import { getWeekBoard } from '../../db/services/patrolTime.js';
import { renderPatrolTimeBoard } from '../renderers/patrol.js';
import { requirePermission } from '../utils/auth.js';
import { replyEphemeral } from '../utils/replies.js';
import { deleteMessage } from '../utils/messages.js';

export const data = new SlashCommandBuilder()
  .setName('patrol-time')
  .setDescription('Publier le tableau du temps de patrouille de la semaine (mis à jour automatiquement)')
  .setContexts(InteractionContextType.Guild);

export async function execute(interaction) {
  if (!(await requirePermission(interaction, 'patrouille'))) return;
  const { guildId, channelId, channel } = interaction;
  if (!channel?.isSendable?.()) return replyEphemeral(interaction, '❌ Je ne peux pas écrire dans ce salon.');

  const board = await getWeekBoard(guildId);
  let message;
  try {
    message = await channel.send(renderPatrolTimeBoard(board));
  } catch {
    return replyEphemeral(interaction, '❌ Impossible de publier le tableau ici (permissions du bot ?).');
  }
  const previous = await PatrolTimeBoard.findOne({ guildId, channelId });
  if (previous) await deleteMessage(interaction.client, previous.channelId, previous.messageId);
  await PatrolTimeBoard.findOneAndUpdate(
    { guildId, channelId },
    { messageId: message.id, createdBy: interaction.user.id },
    { upsert: true },
  );
  return replyEphemeral(interaction, '✅ Tableau publié. Il sera mis à jour toutes les 15 minutes et à chaque fin de patrouille.');
}
