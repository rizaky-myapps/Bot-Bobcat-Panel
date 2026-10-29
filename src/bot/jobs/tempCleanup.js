import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../utils/config.js';
import { INTERVALS } from '../../utils/constants.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('tmp');

/** Supprime les fichiers temporaires de plus de 12 heures. */
export async function cleanTempFolder(maxAgeMs = INTERVALS.tempCleanup) {
  await fs.mkdir(config.tmpDir, { recursive: true });
  const entries = await fs.readdir(config.tmpDir, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries) {
    const full = path.join(config.tmpDir, entry.name);
    const stat = await fs.stat(full).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > maxAgeMs) {
      await fs.rm(full, { recursive: true, force: true });
      removed++;
    }
  }
  if (removed) log.info(`${removed} fichier(s) temporaire(s) supprimé(s).`);
}

export function startTempCleanup() {
  const run = () => cleanTempFolder().catch((err) => log.warn('Nettoyage impossible :', err.message));
  run();
  return setInterval(run, INTERVALS.tempCleanup);
}
