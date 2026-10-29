import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import mongoose from 'mongoose';
import { config, ROOT_DIR } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { connectDatabase } from '../db/connect.js';
import { viewHelpers } from './helpers.js';
import { csrf, flash, requireAuth } from './middleware.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import patrolRoutes from './routes/patrols.js';
import missionRoutes from './routes/missions.js';
import secuRoutes from './routes/secu.js';
import adminRoutes from './routes/admin.js';

const log = createLogger('panel');
const DIR = path.dirname(fileURLToPath(import.meta.url));

function sessionSecret() {
  if (config.panel.sessionSecret) return config.panel.sessionSecret;
  if (config.isProduction) throw new Error('PANEL_SESSION_SECRET est obligatoire en production.');
  log.warn('PANEL_SESSION_SECRET absent : secret temporaire généré (les sessions seront perdues au redémarrage).');
  return crypto.randomBytes(32).toString('hex');
}

function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self' https://discord.com",
  });
  next();
}

export function createApp() {
  const app = express();
  const secure = config.panel.baseUrl.startsWith('https://');
  if (secure) app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.join(DIR, 'views'));
  app.disable('x-powered-by');
  Object.assign(app.locals, viewHelpers);

  app.use(securityHeaders);
  app.use('/static', express.static(path.join(DIR, 'public'), { maxAge: '1h' }));
  app.use('/vendor/chart.js', express.static(path.join(ROOT_DIR, 'node_modules', 'chart.js', 'dist'), { maxAge: '7d' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(
    session({
      name: 'bobcat.sid',
      secret: sessionSecret(),
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({
        client: mongoose.connection.getClient(),
        collectionName: 'panel_sessions',
        ttl: 7 * 24 * 3600,
      }),
      cookie: { httpOnly: true, sameSite: 'lax', secure, maxAge: 7 * 24 * 3600 * 1000 },
    }),
  );
  app.use(flash);
  app.use(csrf);
  app.use((req, res, next) => {
    res.locals.currentPath = req.path;
    res.locals.user = req.session.user || null;
    res.locals.perms = {};
    res.locals.devLogin = config.panel.devLogin;
    next();
  });

  app.use(authRoutes);
  app.use(requireAuth);
  app.use(dashboardRoutes);
  app.use(patrolRoutes);
  app.use(missionRoutes);
  app.use(secuRoutes);
  app.use(adminRoutes);

  app.use((req, res) => res.status(404).render('error', { title: 'Page introuvable', message: "Cette page n'existe pas." }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    log.error(`${req.method} ${req.originalUrl} :`, err);
    res.status(err.status || 500).render('error', { title: 'Erreur', message: err.expose ? err.message : 'Une erreur interne est survenue.' });
  });
  return app;
}

export async function startPanel() {
  if (!config.discord.guildId) throw new Error('GUILD_ID manquant : le panel a besoin de connaître le serveur à gérer.');
  await connectDatabase();
  const app = createApp();
  return new Promise((resolve) => {
    const server = app.listen(config.panel.port, () => {
      log.success(`Panel disponible sur ${config.panel.baseUrl} (port ${config.panel.port})`);
      if (config.panel.devLogin) log.warn('Connexion de développement activée (PANEL_DEV_LOGIN) — à désactiver en production.');
      resolve(server);
    });
  });
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  startPanel().catch((err) => {
    log.error('Démarrage du panel impossible :', err.message);
    process.exit(1);
  });
}
