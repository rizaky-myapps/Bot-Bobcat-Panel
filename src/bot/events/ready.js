import { Events, OAuth2Scopes, PermissionFlagsBits } from 'discord.js';
import { config } from '../../utils/config.js';
import { createLogger } from '../../utils/logger.js';
import { syncAllMembers, syncGuildCache } from '../services/guildSync.js';
import { rehydrate } from '../services/rehydrate.js';
import { startJobs } from '../jobs/index.js';

const log = createLogger('ready');

export const name = Events.ClientReady;
export const once = true;

export const BOT_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.UseExternalEmojis,
  PermissionFlagsBits.MentionEveryone,
];

async function registerCommands(client) {
  const body = [...client.commands.values()].map((c) => c.data.toJSON());
  if (config.discord.guildId) {
    const guild = await client.guilds.fetch(config.discord.guildId).catch(() => null);
    if (!guild) {
      log.warn(`Le bot n'est pas sur le serveur GUILD_ID=${config.discord.guildId}. Invite-le avec le lien ci-dessous.`);
      return;
    }
    await guild.commands.set(body);
    log.success(`${body.length} commandes enregistrées sur ${guild.name}.`);
  } else {
    await client.application.commands.set(body);
    log.success(`${body.length} commandes globales enregistrées (la propagation peut prendre jusqu'à 1 h).`);
  }
}

export async function execute(client) {
  log.success(`Connecté en tant que ${client.user.tag}`);
  const invite = client.generateInvite({ scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands], permissions: BOT_PERMISSIONS });
  log.info(`Lien d'invitation : ${invite}`);

  try {
    await registerCommands(client);
  } catch (err) {
    log.error("Enregistrement des commandes impossible :", err);
  }

  for (const guild of client.guilds.cache.values()) {
    await syncGuildCache(guild).catch((err) => log.warn('Cache serveur :', err.message));
    await syncAllMembers(guild);
  }

  try {
    await rehydrate(client);
  } catch (err) {
    log.error('Restauration des sessions impossible :', err);
  }
  await startJobs(client);
}
