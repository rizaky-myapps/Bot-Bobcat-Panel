import { AuditLog } from '../models/index.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('audit');

/**
 * Enregistre une action dans le journal d'audit. Ne lève jamais d'erreur.
 */
export async function audit({ guildId, actorId, actorName, source = 'bot', action, targetType, targetId, summary, details }) {
  try {
    await AuditLog.create({
      guildId,
      actorId,
      actorName,
      source,
      action,
      targetType,
      targetId: targetId ? String(targetId) : undefined,
      summary,
      details,
    });
  } catch (err) {
    log.warn("Impossible d'écrire dans le journal d'audit :", err.message);
  }
}
