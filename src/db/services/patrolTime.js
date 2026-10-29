import { PatrolPlace, PatrolTimeTracking } from '../models/index.js';
import { isoWeek, isoWeekRange, minutesBetween } from '../../utils/times.js';

export function visitMinutes(visit, fallbackEnd) {
  return minutesBetween(visit.arrivedAt, visit.leftAt || fallbackEnd);
}

async function incrementTracking(guildId, placeId, placeName, { year, week }, delta) {
  if (!placeId || !delta) return;
  const doc = await PatrolTimeTracking.findOneAndUpdate(
    { guildId, placeId, year, weekNumber: week },
    { $inc: { totalMinutes: delta }, $set: { placeName } },
    { upsert: true, returnDocument: 'after' },
  );
  if (doc.totalMinutes < 0) {
    doc.totalMinutes = 0;
    await doc.save();
  }
}

const sameWeek = (a, b) => a?.year === b?.year && a?.week === b?.week;

/**
 * Compte (ou recompte après correction) le temps d'une patrouille terminée dans le suivi hebdomadaire.
 * Le temps est imputé à la semaine ISO du début de la patrouille.
 * Modifie `session` (countedMinutes, countedWeek) sans la sauvegarder.
 */
export async function syncSessionTracking(session) {
  if (session.status !== 'FINISHED') return;
  const target = isoWeek(session.startAt);
  const previous = session.countedWeek?.year ? { year: session.countedWeek.year, week: session.countedWeek.week } : null;
  if (previous && !sameWeek(previous, target)) {
    for (const visit of session.places) {
      await incrementTracking(session.guildId, visit.placeId, visit.name, previous, -(visit.countedMinutes || 0));
      visit.countedMinutes = 0;
    }
  }
  session.countedWeek = target;
  for (const visit of session.places) {
    const minutes = visitMinutes(visit, session.endAt);
    const delta = minutes - (visit.countedMinutes || 0);
    if (delta) await incrementTracking(session.guildId, visit.placeId, visit.name, target, delta);
    visit.countedMinutes = minutes;
  }
}

/** Retire du suivi le temps d'un passage (avant suppression). */
export async function uncountVisit(session, visit) {
  if (!session.countedWeek?.year || !visit.countedMinutes) return;
  const week = { year: session.countedWeek.year, week: session.countedWeek.week };
  await incrementTracking(session.guildId, visit.placeId, visit.name, week, -visit.countedMinutes);
  visit.countedMinutes = 0;
}

export async function uncountSession(session) {
  for (const visit of session.places) await uncountVisit(session, visit);
}

export async function getPlaceUsedMinutes(guildId, placeId, week = isoWeek()) {
  const doc = await PatrolTimeTracking.findOne({ guildId, placeId, year: week.year, weekNumber: week.week }).lean();
  return doc?.totalMinutes || 0;
}

/** Données du tableau /patrol-time pour une semaine. */
export async function getWeekBoard(guildId, week = isoWeek()) {
  const [places, tracks] = await Promise.all([
    PatrolPlace.find({ guildId, active: true }).collation({ locale: 'fr', strength: 2 }).sort({ name: 1 }).lean(),
    PatrolTimeTracking.find({ guildId, year: week.year, weekNumber: week.week }).lean(),
  ]);
  const used = new Map(tracks.map((t) => [String(t.placeId), t.totalMinutes]));
  const rows = places.map((p) => {
    const usedMinutes = used.get(String(p._id)) || 0;
    const maxMinutes = Math.round((p.maxHoursPerWeek || 0) * 60);
    const unlimited = maxMinutes <= 0;
    const remaining = unlimited ? null : Math.max(0, maxMinutes - usedMinutes);
    const percent = unlimited ? null : Math.min(100, Math.round((usedMinutes / maxMinutes) * 100));
    return {
      placeId: String(p._id),
      name: p.name,
      emoji: p.emoji,
      usedMinutes,
      maxMinutes,
      unlimited,
      remaining,
      percent,
      reached: !unlimited && remaining <= 0,
    };
  });
  return {
    year: week.year,
    week: week.week,
    range: isoWeekRange(week.year, week.week),
    rows,
    available: rows.filter((r) => !r.reached),
    reached: rows.filter((r) => r.reached),
    totalMinutes: rows.reduce((sum, r) => sum + r.usedMinutes, 0),
  };
}

export async function resetPlaceTime(guildId, placeId, week = isoWeek()) {
  return PatrolTimeTracking.updateOne(
    { guildId, placeId, year: week.year, weekNumber: week.week },
    { $set: { totalMinutes: 0 } },
  );
}

export async function resetAllTime(guildId, week = isoWeek()) {
  return PatrolTimeTracking.updateMany({ guildId, year: week.year, weekNumber: week.week }, { $set: { totalMinutes: 0 } });
}

/** Total de minutes par semaine (pour les statistiques). */
export async function getWeeklyTotals(guildId, weeks) {
  const docs = await PatrolTimeTracking.aggregate([
    { $match: { guildId, $or: weeks.map((w) => ({ year: w.year, weekNumber: w.week })) } },
    { $group: { _id: { year: '$year', week: '$weekNumber' }, total: { $sum: '$totalMinutes' } } },
  ]);
  const map = new Map(docs.map((d) => [`${d._id.year}-${d._id.week}`, d.total]));
  return weeks.map((w) => ({ ...w, totalMinutes: map.get(`${w.year}-${w.week}`) || 0 }));
}

export function progressBar(percent, size = 20) {
  const pct = Math.max(0, Math.min(100, percent || 0));
  const filled = Math.round((pct / 100) * size);
  return `[${'█'.repeat(filled)}${'░'.repeat(size - filled)}] ${pct}%`;
}
