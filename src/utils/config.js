import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

dotenv.config({ path: path.join(ROOT_DIR, '.env'), quiet: true });

const env = process.env;

function list(value) {
  return (value || '')
    .split(/[,;\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'oui', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const panelPort = int(env.PANEL_PORT || env.PORT, 3000);

export const config = {
  env: env.NODE_ENV || 'development',
  isProduction: env.NODE_ENV === 'production',
  discord: {
    token: env.DISCORD_TOKEN || '',
    clientId: env.DISCORD_CLIENT_ID || '',
    clientSecret: env.DISCORD_CLIENT_SECRET || '',
    guildId: env.GUILD_ID || '',
  },
  mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017/bobcat',
  superUserIds: list(env.SUPER_USER_IDS),
  superUserRoleIds: list(env.SUPER_USER_ROLE_IDS),
  cloudinary: {
    cloudName: env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: env.CLOUDINARY_API_KEY || '',
    apiSecret: env.CLOUDINARY_API_SECRET || '',
    folder: env.CLOUDINARY_FOLDER || 'bobcat',
  },
  panel: {
    port: panelPort,
    baseUrl: (env.PANEL_BASE_URL || `http://localhost:${panelPort}`).replace(/\/+$/, ''),
    sessionSecret: env.PANEL_SESSION_SECRET || '',
    devLogin: bool(env.PANEL_DEV_LOGIN) && env.NODE_ENV !== 'production',
    devUserId: env.PANEL_DEV_USER_ID || list(env.SUPER_USER_IDS)[0] || '000000000000000000',
  },
  tmpDir: path.join(ROOT_DIR, 'tmp'),
};

export function cloudinaryEnabled() {
  const c = config.cloudinary;
  return Boolean(c.cloudName && c.apiKey && c.apiSecret);
}
