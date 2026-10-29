import { PanelAction } from '../models/index.js';

/**
 * Demande au bot de (re)publier ou mettre à jour un message Discord.
 * Le bot traite la file toutes les quelques secondes.
 */
export async function enqueueAction({ guildId, entity, type = 'refresh', entityId = null, payload = {}, createdBy }) {
  return PanelAction.create({
    guildId,
    entity,
    type,
    entityId: entityId ? String(entityId) : null,
    payload,
    createdBy,
  });
}
