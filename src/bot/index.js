import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { config } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { connectDatabase, disconnectDatabase } from '../db/connect.js';

const log = createLogger('bot');
const DIR = path.dirname(fileURLToPath(import.meta.url));

async function importDir(dir) {
  const files = (await fs.readdir(path.join(DIR, dir))).filter((f) => f.endsWith('.js')).sort();
  return Promise.all(files.map(async (f) => ({ file: f, mod: await import(pathToFileURL(path.join(DIR, dir, f)).href) })));
}

export async function loadCommands(client) {
  for (const { file, mod } of await importDir('commands')) {
    if (!mod.data || !mod.execute) {
      log.warn(`commands/${file} ignoré (data/execute manquant).`);
      continue;
    }
    client.commands.set(mod.data.name, mod);
  }
  log.info(`${client.commands.size} commandes chargées.`);
}

export async function loadHandlers(client) {
  for (const { mod } of await importDir('handlers')) {
    if (mod.prefix && mod.handle) client.handlers.set(mod.prefix, mod);
  }
}

export async function loadEvents(client) {
  let count = 0;
  for (const { mod } of await importDir('events')) {
    const list = mod.events || (mod.name && mod.execute ? [mod] : []);
    for (const ev of list) {
      const listener = (...args) => ev.execute(...args, client);
      if (ev.once) client.once(ev.name, listener);
      else client.on(ev.name, listener);
      count++;
    }
  }
  log.info(`${count} événements chargés.`);
}

export function createClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember],
    allowedMentions: { parse: ['users', 'roles'] },
  });
  client.commands = new Collection();
  client.handlers = new Map();
  return client;
}

export async function startBot() {
  if (!config.discord.token) throw new Error('DISCORD_TOKEN manquant dans le fichier .env');
  await connectDatabase();
  const client = createClient();
  await loadCommands(client);
  await loadHandlers(client);
  await loadEvents(client);
  client.on('error', (err) => log.error('Erreur client Discord :', err));
  try {
    await client.login(config.discord.token);
  } catch (err) {
    if (/disallowed intents/i.test(err.message)) {
      log.error(
        "Intents refusés par Discord. Active « SERVER MEMBERS INTENT » dans le portail développeur (Bot → Privileged Gateway Intents).",
      );
    } else if (/token/i.test(err.message)) {
      log.error('Token Discord invalide : vérifie DISCORD_TOKEN dans le fichier .env.');
    }
    throw err;
  }
  return client;
}

export async function stopBot(client) {
  await client?.destroy();
  await disconnectDatabase();
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  let client;
  startBot()
    .then((c) => {
      client = c;
    })
    .catch((err) => {
      log.error('Démarrage impossible :', err.message);
      process.exit(1);
    });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      log.info('Arrêt du bot…');
      await stopBot(client).catch(() => {});
      process.exit(0);
    });
  }
}
