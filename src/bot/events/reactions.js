import { Events } from 'discord.js';
import { handleAvailabilityReaction } from '../services/missions.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('reactions');

const wrap = (added) => (reaction, user) =>
  handleAvailabilityReaction(reaction, user, added).catch((err) => log.error('Réaction non traitée :', err));

export const events = [
  { name: Events.MessageReactionAdd, execute: wrap(true) },
  { name: Events.MessageReactionRemove, execute: wrap(false) },
];
