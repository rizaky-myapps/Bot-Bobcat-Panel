import {
  parseDateInput,
  parseTimeInput,
  parseDurationInput,
  combineDateTime,
  addDays,
  dateKey,
  formatHShort,
} from '../../utils/times.js';
import { SECU_MAX_DAYS, SECU_MAX_SLOTS_PER_DAY } from '../../utils/constants.js';

const OFF_WORDS = ['off', 'repos', 'aucun', 'non', 'none', '-'];

/**
 * Lit la liste des jours :
 *  - "17/08:3"        → 17/08, 18/08, 19/08
 *  - "14/08,17/08"    → 14/08 et 17/08
 *  - "14/08,17/08:2"  → 14/08, 17/08, 18/08
 */
export function parseDaysSpec(spec, ref = new Date()) {
  if (!spec || !String(spec).trim()) return { dates: [], error: 'Aucun jour indiqué.' };
  const byKey = new Map();
  for (const raw of String(spec).split(/[,;]+/)) {
    const token = raw.trim();
    if (!token) continue;
    const match = token.match(/^([\d/.-]+?)(?::(\d{1,2}))?$/);
    if (!match) return { dates: [], error: `Jour invalide : « ${token} » (attendu : 17/08 ou 17/08:3).` };
    const start = parseDateInput(match[1], ref);
    if (!start) return { dates: [], error: `Date invalide : « ${match[1]} ».` };
    const count = match[2] ? Number(match[2]) : 1;
    if (count < 1) return { dates: [], error: `Nombre de jours invalide dans « ${token} ».` };
    for (let i = 0; i < count; i++) {
      const d = addDays(start, i);
      byKey.set(dateKey(d), d);
    }
  }
  const dates = [...byKey.values()].sort((a, b) => a - b);
  if (!dates.length) return { dates: [], error: 'Aucun jour indiqué.' };
  if (dates.length > SECU_MAX_DAYS) return { dates: [], error: `Maximum ${SECU_MAX_DAYS} jours par sécurisation.` };
  return { dates, error: null };
}

/**
 * Lit une liste de plages horaires :
 *  - "19h-00h"            → un créneau
 *  - "19h-21h,21h-23h"    → deux créneaux
 *  - "19h-01h/2h"         → découpage en créneaux de 2h (19-21, 21-23, 23-01)
 * Une heure de fin inférieure ou égale au début signifie le lendemain.
 * @returns {{ranges: {start:{h,m}, end:{h,m}}[], error: string|null}}
 */
export function parseRanges(text) {
  if (!text || !String(text).trim()) return { ranges: [], error: 'Aucune plage horaire indiquée.' };
  const ranges = [];
  for (const raw of String(text).split(/[,|+]+/)) {
    const token = raw.trim();
    if (!token) continue;
    const match = token.match(/^(.+?)\s*(?:-|–|—|à|>)\s*([^/]+?)(?:\s*\/\s*(.+))?$/i);
    if (!match) return { ranges: [], error: `Plage invalide : « ${token} » (attendu : 19h-21h).` };
    const start = parseTimeInput(match[1]);
    const end = parseTimeInput(match[2]);
    if (!start || !end) return { ranges: [], error: `Heure invalide dans « ${token} ».` };
    const startMin = start.h * 60 + start.m;
    let endMin = end.h * 60 + end.m;
    if (endMin <= startMin) endMin += 24 * 60;
    if (match[3]) {
      const step = parseDurationInput(match[3]);
      if (!step || step < 15) return { ranges: [], error: `Durée de découpage invalide dans « ${token} » (minimum 15 min).` };
      for (let t = startMin; t < endMin; t += step) {
        const e = Math.min(t + step, endMin);
        ranges.push({ start: toHm(t), end: toHm(e) });
      }
    } else {
      ranges.push({ start, end: toHm(endMin) });
    }
  }
  if (!ranges.length) return { ranges: [], error: 'Aucune plage horaire indiquée.' };
  return { ranges, error: null };
}

function toHm(totalMinutes) {
  const m = ((totalMinutes % 1440) + 1440) % 1440;
  return { h: Math.floor(m / 60), m: m % 60 };
}

/**
 * Lit les exceptions de planning, une par ligne (ou séparées par « ; ») :
 *   17/08=20h-23h
 *   18/08: 19h-21h, 21h-23h
 *   19/08 off
 * @returns {{overrides: Map<string, {date: Date, ranges: Array|null}>, error: string|null}}
 */
export function parsePlanning(text, ref = new Date()) {
  const overrides = new Map();
  if (!text || !String(text).trim()) return { overrides, error: null };
  for (const raw of String(text).split(/[\n;]+/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^(\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?)\s*(?:[:=]\s*|\s+)(.+)$/);
    if (!match) return { overrides, error: `Ligne de planning invalide : « ${line} » (attendu : 17/08=20h-23h).` };
    const date = parseDateInput(match[1], ref);
    if (!date) return { overrides, error: `Date invalide dans le planning : « ${match[1]} ».` };
    const value = match[2].trim();
    if (OFF_WORDS.includes(value.toLowerCase())) {
      overrides.set(dateKey(date), { date, ranges: null });
      continue;
    }
    const { ranges, error } = parseRanges(value);
    if (error) return { overrides, error: `Planning du ${match[1]} : ${error}` };
    overrides.set(dateKey(date), { date, ranges });
  }
  return { overrides, error: null };
}

export function buildSlots(date, ranges, capacity) {
  return ranges
    .map((r) => {
      const startAt = combineDateTime(date, r.start);
      let endAt = combineDateTime(date, r.end);
      if (endAt <= startAt) endAt = addDays(endAt, 1);
      return { startAt, endAt, capacity, registrations: [] };
    })
    .sort((a, b) => a.startAt - b.startAt)
    .map((slot, i) => ({ ...slot, label: `TEAM ${i + 1}` }));
}

/**
 * Construit les jours et créneaux d'une sécurisation à partir des paramètres de /secu.
 */
export function buildSecuDays({ daysSpec, template, planning, capacity, ref = new Date() }) {
  const { dates, error: daysError } = parseDaysSpec(daysSpec, ref);
  if (daysError) return { days: [], error: daysError };
  const { ranges: templateRanges, error: templateError } = parseRanges(template);
  if (templateError) return { days: [], error: `Template : ${templateError}` };
  const { overrides, error: planningError } = parsePlanning(planning, ref);
  if (planningError) return { days: [], error: planningError };

  const byKey = new Map(dates.map((d) => [dateKey(d), d]));
  for (const [key, o] of overrides) if (!byKey.has(key)) byKey.set(key, o.date);
  if (byKey.size > SECU_MAX_DAYS) return { days: [], error: `Maximum ${SECU_MAX_DAYS} jours par sécurisation.` };

  const days = [];
  for (const [key, date] of [...byKey.entries()].sort((a, b) => a[1] - b[1])) {
    const ranges = overrides.has(key) ? overrides.get(key).ranges : templateRanges;
    if (!ranges) continue;
    const slots = buildSlots(date, ranges, capacity);
    if (slots.length > SECU_MAX_SLOTS_PER_DAY) {
      return { days: [], error: `Le ${key} contient ${slots.length} créneaux (maximum ${SECU_MAX_SLOTS_PER_DAY}).` };
    }
    days.push({ date, slots });
  }
  if (!days.length) return { days: [], error: 'Aucun créneau à créer (tous les jours sont en repos ?).' };
  return { days, error: null };
}

/** Renumérote les créneaux d'un jour (TEAM 1, TEAM 2…) après tri chronologique. */
export function relabelSlots(day) {
  day.slots.sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  day.slots.forEach((slot, i) => {
    slot.label = `TEAM ${i + 1}`;
  });
}

export function slotTimeLabel(slot) {
  return `${formatHShort(new Date(slot.startAt))}-${formatHShort(new Date(slot.endAt))}`;
}

