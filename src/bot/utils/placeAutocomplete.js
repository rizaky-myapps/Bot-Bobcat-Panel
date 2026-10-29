import mongoose from 'mongoose';
import { PatrolPlace } from '../../db/models/index.js';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Autocomplete des lieux de patrouille (valeur = ID du lieu). */
export async function autocompletePlaces(interaction) {
  const focused = String(interaction.options.getFocused() || '').trim();
  const filter = { guildId: interaction.guildId };
  if (focused) filter.name = { $regex: escapeRegex(focused), $options: 'i' };
  const places = await PatrolPlace.find(filter).collation({ locale: 'fr', strength: 2 }).sort({ name: 1 }).limit(25).lean();
  await interaction.respond(
    places.map((p) => ({
      name: `${p.name}${p.maxHoursPerWeek ? ` (${p.maxHoursPerWeek}h/sem.)` : ' (illimité)'}${p.active ? '' : ' — inactif'}`.slice(0, 100),
      value: String(p._id),
    })),
  );
}

/** Retrouve un lieu par ID (autocomplete) ou par nom saisi. */
export async function resolvePlace(guildId, target) {
  if (!target) return null;
  if (mongoose.isValidObjectId(target)) {
    const byId = await PatrolPlace.findOne({ _id: target, guildId });
    if (byId) return byId;
  }
  return PatrolPlace.findOne({ guildId, name: target.trim() }).collation({ locale: 'fr', strength: 2 });
}
