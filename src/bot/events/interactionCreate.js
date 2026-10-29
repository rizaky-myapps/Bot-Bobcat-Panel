import { Events, MessageFlags } from 'discord.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('interaction');

export const name = Events.InteractionCreate;

async function reportError(interaction, err) {
  if (err?.code === 10062 || err?.code === 40060) {
    log.warn(`Interaction expirée ou déjà traitée (${interaction.customId || interaction.commandName}).`);
    return;
  }
  log.error(`Erreur sur ${interaction.commandName || interaction.customId} :`, err);
  if (!interaction.isRepliable()) return;
  const payload = { content: '❌ Une erreur est survenue. Réessaie, ou préviens un administrateur si ça persiste.' };
  try {
    if (interaction.deferred && !interaction.replied) await interaction.editReply(payload);
    else if (interaction.replied) await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  } catch {
    // L'interaction n'est plus utilisable.
  }
}

export async function execute(interaction) {
  const { client } = interaction;
  try {
    if (!interaction.inGuild()) {
      if (interaction.isRepliable()) await interaction.reply({ content: 'Les commandes du bot s’utilisent sur le serveur.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      log.debug(`/${interaction.commandName} par ${interaction.user.tag}`);
      await command.execute(interaction);
      return;
    }
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) await command.autocomplete(interaction);
      return;
    }
    if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
      const [prefix, action, ...args] = interaction.customId.split(':');
      const handler = client.handlers.get(prefix);
      if (!handler) {
        log.warn(`Aucun gestionnaire pour ${interaction.customId}`);
        return;
      }
      await handler.handle(interaction, action, args);
    }
  } catch (err) {
    if (interaction.isAutocomplete()) {
      log.warn('Autocomplete en échec :', err.message);
      return;
    }
    await reportError(interaction, err);
  }
}
