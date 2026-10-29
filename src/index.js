// Point d'entrée unique : démarre le bot Discord et le panel web dans le même processus.
// Ils peuvent aussi être lancés séparément : `npm run bot` et `npm run panel`.
import { config } from './utils/config.js';
import { createLogger } from './utils/logger.js';
import { startBot, stopBot } from './bot/index.js';
import { startPanel } from './panel/index.js';

const log = createLogger('main');
let client = null;
let server = null;

async function main() {
  if (config.discord.token) {
    client = await startBot();
  } else {
    log.warn('DISCORD_TOKEN absent : le bot ne démarre pas.');
  }
  try {
    server = await startPanel();
  } catch (err) {
    if (!client) throw err;
    log.error('Le panel ne démarre pas (le bot continue de tourner) :', err.message);
  }
}

async function shutdown() {
  log.info('Arrêt en cours…');
  server?.close();
  await stopBot(client).catch(() => {});
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (err) => log.error('Promesse rejetée non gérée :', err));

main().catch((err) => {
  log.error('Démarrage impossible :', err.message);
  process.exit(1);
});
