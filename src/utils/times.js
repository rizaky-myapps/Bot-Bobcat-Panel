// Gestion des dates et heures.
// Le bot utilise le fuseau horaire du processus (variable TZ, sinon celui du système).
// Les dates sont stockées en UTC dans MongoDB et affichées en heure locale.

export const DAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export const pad = (n) => String(n).padStart(2, '0');

/**
 * Lit une heure saisie librement : "21h", "21h30", "21:30", "21.30", "2130", "930", "9".
 * "24h" est accepté et vaut minuit.
 * @returns {{h:number,m:number}|null}
 */
export function parseTimeInput(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  let h;
  let m;
  let match = s.match(/^(\d{1,2})[h:.](\d{2})?$/);
  if (match) {
    h = Number(match[1]);
    m = match[2] ? Number(match[2]) : 0;
  } else if ((match = s.match(/^(\d{3,4})$/))) {
    h = Number(match[1].slice(0, -2));
    m = Number(match[1].slice(-2));
  } else if ((match = s.match(/^(\d{1,2})$/))) {
    h = Number(match[1]);
    m = 0;
  } else {
    return null;
  }
  if (h === 24 && m === 0) h = 0;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

/**
 * Lit une date "16/05", "16/05/2026", "16-05-26", "16.05".
 * Sans année : année courante, ou l'année suivante si la date est passée depuis plus de 30 jours.
 * @returns {Date|null} minuit, heure locale
 */
export function parseDateInput(input, ref = new Date()) {
  if (!input) return null;
  const match = String(input).trim().match(/^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2}|\d{4}))?$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year;
  if (match[3]) {
    year = Number(match[3]);
    if (year < 100) year += 2000;
  } else {
    year = ref.getFullYear();
    const candidate = new Date(year, month - 1, day);
    if (candidate.getTime() < startOfDay(ref).getTime() - 30 * DAY) year += 1;
  }
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * MINUTE);
}

export function combineDateTime(date, hm) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hm.h, hm.m, 0, 0);
}

export function minutesBetween(start, end) {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / MINUTE));
}

/**
 * Transforme une heure saisie (sans date) en Date complète : on choisit, parmi la veille,
 * le jour même et le lendemain de `ref`, la date la plus proche de `ref` qui respecte `notBefore`.
 * Permet de gérer naturellement les patrouilles qui passent minuit.
 */
export function resolveTimeNear(hm, ref = new Date(), { notBefore } = {}) {
  const base = startOfDay(ref);
  const candidates = [-1, 0, 1].map((offset) => combineDateTime(addDays(base, offset), hm));
  const valid = notBefore ? candidates.filter((c) => c.getTime() >= new Date(notBefore).getTime()) : candidates;
  if (!valid.length) {
    const nb = new Date(notBefore);
    let c = combineDateTime(nb, hm);
    if (c.getTime() < nb.getTime()) c = addDays(c, 1);
    return c;
  }
  return valid.reduce((best, c) =>
    Math.abs(c.getTime() - ref.getTime()) < Math.abs(best.getTime() - ref.getTime()) ? c : best,
  );
}

/** Semaine ISO 8601 (lundi → dimanche). */
export function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

/** Début (lundi 00:00 local) et fin (lundi suivant 00:00) d'une semaine ISO. */
export function isoWeekRange(year, week) {
  const jan4 = new Date(year, 0, 4);
  const jan4Day = jan4.getDay() || 7;
  const start = new Date(year, 0, 4 - jan4Day + 1 + (week - 1) * 7);
  const end = addDays(start, 7);
  return { start, end };
}

export function shiftIsoWeek({ year, week }, delta) {
  const { start } = isoWeekRange(year, week);
  return isoWeek(addDays(start, delta * 7 + 3));
}

export function formatHM(date) {
  if (!date) return '--:--';
  const d = new Date(date);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "19h", "19h30" */
export function formatHShort(hmOrDate) {
  const h = hmOrDate instanceof Date ? hmOrDate.getHours() : hmOrDate.h;
  const m = hmOrDate instanceof Date ? hmOrDate.getMinutes() : hmOrDate.m;
  return m ? `${h}h${pad(m)}` : `${h}h`;
}

export function formatDateFR(date) {
  const d = new Date(date);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatDateShort(date) {
  const d = new Date(date);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

/** "Jeudi 29/10" */
export function formatDayLabel(date) {
  const d = new Date(date);
  return `${DAY_NAMES[d.getDay()]} ${formatDateShort(d)}`;
}

/** "Jeudi 29/10/2026" */
export function formatLongDate(date) {
  const d = new Date(date);
  return `${DAY_NAMES[d.getDay()]} ${formatDateFR(d)}`;
}

export function formatDateTime(date) {
  if (!date) return '—';
  return `${formatDateFR(date)} ${formatHM(date)}`;
}

/** 45 → "45 min", 65 → "1h05", 120 → "2h00" */
export function formatDuration(minutes) {
  const total = Math.max(0, Math.round(minutes || 0));
  if (total < 60) return `${total} min`;
  return `${Math.floor(total / 60)}h${pad(total % 60)}`;
}

/** "2h", "90", "90min", "1h30", "45m" → minutes */
export function parseDurationInput(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase().replace(/\s+/g, '');
  let match = s.match(/^(\d+)h(\d{1,2})?$/);
  if (match) return Number(match[1]) * 60 + (match[2] ? Number(match[2]) : 0);
  match = s.match(/^(\d+)(?:m|min|mn)?$/);
  if (match) return Number(match[1]);
  return null;
}

/** Horodatage Discord affiché dans le fuseau de chaque utilisateur. */
export function discordTs(date, style = 't') {
  return `<t:${Math.floor(new Date(date).getTime() / 1000)}:${style}>`;
}

/** 'YYYY-MM-DD' en heure locale */
export function dateKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromDateKey(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Valeur pour <input type="datetime-local"> */
export function toDatetimeLocal(date) {
  if (!date) return '';
  const d = new Date(date);
  return `${dateKey(d)}T${formatHM(d)}`;
}

/** Lit la valeur d'un <input type="datetime-local"> (heure locale). */
export function fromDatetimeLocal(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  return new Date(y, mo - 1, d, h, mi);
}
