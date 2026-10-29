import './config.js';

const env = process.env;

export const COLORS = {
  brand: 0xf5a623,
  open: 0x2ecc71,
  info: 0x3498db,
  warning: 0xf1c40f,
  finished: 0x7f8c8d,
  cancelled: 0xe74c3c,
};

// Emojis personnalisés du serveur (format <:nom:id>), avec repli unicode.
export const EMOJIS = {
  bobcat: env.EMOJI_BOBCAT || '🐾',
  shotgun: env.EMOJI_SHOTGUN || '🔫',
  coAtm: env.EMOJI_CO_ATM || '📄',
  u2r: env.EMOJI_U2R || '🏍️',
  available: '✅',
  unavailable: '❌',
};

export const BRAND_NAME = env.BRAND_NAME || 'Bobcat Security';

export const ATM_ROLES = [
  { key: 'CHEF_OP', label: "Chef d'opération", emoji: '🧠' },
  { key: 'CO_ATM', label: 'CO ATM', emoji: EMOJIS.coAtm },
  { key: 'FUSIL', label: 'Fusil à pompe', emoji: EMOJIS.shotgun },
  { key: 'CONDUCTEUR', label: 'Conducteur', emoji: '🚙' },
  { key: 'NOUVEAU', label: "Besoin d'explication", emoji: '🆕' },
  { key: 'U2R', label: 'U2R', emoji: EMOJIS.u2r },
];

export const CONVOI_ROLES = [
  { key: 'CHEF_CONVOI', label: 'Chef de convoi', emoji: '🧠' },
  { key: 'CONDUCTEUR_FOURGON', label: 'Conducteur fourgon', emoji: '🚚' },
  { key: 'ESCORTE', label: 'Escorte', emoji: '🚙' },
  { key: 'FUSIL', label: 'Fusil à pompe', emoji: EMOJIS.shotgun },
  { key: 'U2R', label: 'U2R', emoji: EMOJIS.u2r },
  { key: 'NOUVEAU', label: "Besoin d'explication", emoji: '🆕' },
];

export const ATM_FREQUENCIES = ['S6', 'S7', 'S8'];

export const SECU_TENUES = {
  TENUE_SECURISATION: 'Tenue de sécurisation',
  TENUE_SECURISATION_MC: 'Tenue de sécurisation (manches courtes)',
};

export const SECU_VEHICULES = {
  free: 'Véhicule libre',
  offroad: 'Véhicule tout-terrain',
  custom: 'Véhicule personnalisé',
};

export const SECU_RADIOS = {
  CENTRALE: 'Centrale',
  SIERRA_1: 'Sierra 1',
  SIERRA_2: 'Sierra 2',
  SIERRA_3: 'Sierra 3',
  SIERRA_4: 'Sierra 4',
  SIERRA_5: 'Sierra 5',
  SIERRA_6: 'Sierra 6',
  SIERRA_7: 'Sierra 7',
  SIERRA_8: 'Sierra 8',
  SECU_SHARED: 'Sécu partagée',
};

export const SECU_BRIEF_OFFSETS = [0, 15, 30];
export const SECU_MAX_DAYS = 14;
export const SECU_MAX_SLOTS_PER_DAY = 20;

export const STATUS = {
  OPEN: 'OPEN',
  FINISHED: 'FINISHED',
  CANCELLED: 'CANCELLED',
};

export const STATUS_LABELS = {
  OPEN: 'En cours',
  FINISHED: 'Terminée',
  CANCELLED: 'Annulée',
};

export const INTERVALS = {
  patrolInactivityCheck: 5 * 60 * 1000,
  patrolIdleTimeout: 45 * 60 * 1000,
  patrolTimeRefresh: 15 * 60 * 1000,
  tempCleanup: 12 * 60 * 60 * 1000,
  panelActions: 5 * 1000,
  scheduler: 60 * 1000,
};

// Clés de permissions configurables (rôles Discord autorisés).
// Liste vide = réservé aux super-users, sauf "agent" (liste vide = tout le monde).
export const PERMISSIONS = {
  patrouille: 'Créer et gérer des patrouilles',
  atm: 'Créer des missions ATM et gérer leur dispatch',
  pds: 'Créer des PDS',
  secu: 'Créer et gérer les sécurisations',
  convoi: 'Créer et gérer les convois',
  panel: 'Accéder au panel web',
  agent: "Être agent (réagir aux missions, s'inscrire aux créneaux)",
};
