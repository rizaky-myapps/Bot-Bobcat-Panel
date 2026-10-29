import { MessageFlags } from 'discord.js';

function toPayload(content) {
  return typeof content === 'string' ? { content } : { ...content };
}

/** Répond de façon éphémère, quel que soit l'état de l'interaction (déjà répondue, différée…). */
export async function replyEphemeral(interaction, content) {
  const payload = toPayload(content);
  if (interaction.deferred && !interaction.replied) return interaction.editReply(payload);
  const flags = (payload.flags || 0) | MessageFlags.Ephemeral;
  if (interaction.replied) return interaction.followUp({ ...payload, flags });
  return interaction.reply({ ...payload, flags });
}

/**
 * Met à jour le message éphémère d'origine (menu / bouton / modal ouvert depuis un message éphémère).
 * Si l'interaction vient d'un message public, on répond en éphémère pour ne jamais l'écraser.
 */
export async function updateEphemeral(interaction, content) {
  const payload = { components: [], embeds: [], ...toPayload(content) };
  const fromEphemeral = Boolean(interaction.message?.flags?.has(MessageFlags.Ephemeral));
  if (fromEphemeral && (interaction.deferred || interaction.replied)) return interaction.editReply(payload);
  if (fromEphemeral && (interaction.isMessageComponent() || interaction.isModalSubmit())) {
    return interaction.update(payload);
  }
  return replyEphemeral(interaction, toPayload(content));
}
