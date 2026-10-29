import { ATM_ROLES, CONVOI_ROLES, SECU_RADIOS, SECU_TENUES, SECU_VEHICULES, STATUS_LABELS, BRAND_NAME, PERMISSIONS } from '../utils/constants.js';
import {
  formatDateFR,
  formatDateTime,
  formatDayLabel,
  formatDuration,
  formatHM,
  formatLongDate,
  minutesBetween,
  toDatetimeLocal,
  dateKey,
} from '../utils/times.js';

const STATUS_CLASS = { OPEN: 'ok', FINISHED: 'muted', CANCELLED: 'danger' };
const STATUS_TEXT = { ...STATUS_LABELS, OPEN: 'En cours' };

/** Fonctions disponibles dans toutes les vues EJS. */
export const viewHelpers = {
  BRAND_NAME,
  ATM_ROLES,
  CONVOI_ROLES,
  SECU_TENUES,
  SECU_VEHICULES,
  SECU_RADIOS,
  PERMISSIONS,
  fmt: {
    date: (d) => (d ? formatDateFR(d) : '—'),
    dateTime: (d) => (d ? formatDateTime(d) : '—'),
    hm: (d) => (d ? formatHM(d) : '—'),
    day: (d) => (d ? formatDayLabel(d) : '—'),
    longDate: (d) => (d ? formatLongDate(d) : '—'),
    duration: (m) => formatDuration(m),
    between: (a, b) => formatDuration(minutesBetween(a, b || new Date())),
    dtLocal: (d) => toDatetimeLocal(d),
    dateInput: (d) => (d ? dateKey(d) : ''),
    hmInput: (d) => (d ? formatHM(d) : ''),
    relative(d) {
      if (!d) return '—';
      const diff = Math.round((new Date(d).getTime() - Date.now()) / 60000);
      const abs = Math.abs(diff);
      if (abs < 1) return "à l'instant";
      const text = abs < 60 ? `${abs} min` : abs < 1440 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} j`;
      return diff >= 0 ? `dans ${text}` : `il y a ${text}`;
    },
  },
  statusClass: (s) => STATUS_CLASS[s] || 'muted',
  statusText: (s, feminine = true) => {
    if (!feminine && s === 'FINISHED') return 'Terminé';
    if (!feminine && s === 'CANCELLED') return 'Annulé';
    return STATUS_TEXT[s] || s;
  },
  roleLabel(key, roles) {
    const r = roles.find((x) => x.key === key);
    return r ? `${r.emoji.startsWith('<') ? '' : `${r.emoji} `}${r.label}` : key;
  },
  emoji(value) {
    // Les emojis custom Discord (<:nom:id>) sont affichés en image.
    const m = String(value || '').match(/^<(a?):(\w+):(\d+)>$/);
    if (m) return { url: `https://cdn.discordapp.com/emojis/${m[3]}.${m[1] ? 'gif' : 'webp'}?size=32`, name: m[2] };
    return { text: value || '📍' };
  },
  colorHex(n) {
    return n ? `#${Number(n).toString(16).padStart(6, '0')}` : 'var(--text-muted)';
  },
  qs(base, params) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, v);
    const s = sp.toString();
    return s ? `${base}?${s}` : base;
  },
};

/** Lecture de champs de formulaire. */
export function asArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

export function parseIdList(text) {
  return [...new Set(String(text || '').split(/[\s,;]+/).filter((s) => /^\d{17,21}$/.test(s)))];
}

export function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
