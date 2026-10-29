import crypto from 'node:crypto';
import { config } from '../utils/config.js';
import { DiscordMember } from '../db/models/index.js';
import { computePermissions, getGuildConfig } from '../db/services/permissions.js';
import { getGuildCache, getMemberMap } from '../db/services/members.js';

const PERMS_TTL = 60_000;

export function guildId() {
  return config.discord.guildId;
}

/** Jeton CSRF par session, vérifié sur toutes les requêtes non GET. */
export function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrf;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = String(req.body?._csrf || req.get('x-csrf-token') || '');
  const expected = Buffer.from(req.session.csrf);
  const given = Buffer.from(sent);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return res.status(403).render('error', { title: 'Session expirée', message: 'Le formulaire a expiré. Recharge la page et réessaie.' });
  }
  return next();
}

/** Messages flash affichés une seule fois après une redirection. */
export function flash(req, res, next) {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  req.flash = (type, text) => {
    req.session.flash = { type, text };
  };
  next();
}

export async function resolvePermissions(userId, { dev = false } = {}) {
  const cfg = await getGuildConfig(guildId());
  if (dev) return { ...computePermissions({ userId, roleIds: [] }, cfg), super: true, ...devAll() };
  const [member, cache] = await Promise.all([
    DiscordMember.findOne({ guildId: guildId(), userId }).lean(),
    getGuildCache(guildId()),
  ]);
  const ctx = {
    userId,
    roleIds: member?.inGuild ? member.roleIds : [],
    isOwner: Boolean(cache?.ownerId && cache.ownerId === userId),
  };
  return { ...computePermissions(ctx, cfg), inGuild: Boolean(member?.inGuild) };
}

function devAll() {
  return { patrouille: true, atm: true, pds: true, secu: true, convoi: true, panel: true, agent: true };
}

/** Exige une session connectée avec accès au panel. Les permissions sont recalculées chaque minute. */
export async function requireAuth(req, res, next) {
  const user = req.session.user;
  if (!user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  if (!req.session.perms || Date.now() - (req.session.permsAt || 0) > PERMS_TTL) {
    req.session.perms = await resolvePermissions(user.id, { dev: user.dev });
    req.session.permsAt = Date.now();
  }
  const perms = req.session.perms;
  if (!perms.super && !perms.panel) {
    return res.status(403).render('error', {
      title: 'Accès refusé',
      message: "Ton compte Discord n'a pas accès au panel. Demande à un super-user de t'ajouter un rôle autorisé.",
      showLogout: true,
    });
  }
  res.locals.user = user;
  res.locals.perms = perms;
  const guild = await getGuildCache(guildId());
  const members = new Map();
  res.locals.guild = guild;
  res.locals.members = members;
  res.locals.name = (id) => {
    const m = members.get(id);
    return m?.displayName || m?.username || (id ? `Utilisateur ${String(id).slice(-4)}` : '—');
  };
  res.locals.avatar = (id) => members.get(id)?.avatarUrl || null;
  res.locals.roleName = (id) => guild?.roles?.find((r) => r.id === id)?.name || `Rôle ${String(id).slice(-4)}`;
  res.locals.channelName = (id) => (id ? `#${guild?.channels?.find((c) => c.id === id)?.name || String(id).slice(-4)}` : '—');
  next();
}

/** Exige une permission (super, atm, secu…). */
export function requirePerm(key) {
  return (req, res, next) => {
    if (res.locals.perms?.super || res.locals.perms?.[key]) return next();
    return res.status(403).render('error', { title: 'Accès refusé', message: "Tu n'as pas la permission d'effectuer cette action." });
  };
}

/** Charge les noms des membres Discord nécessaires à une vue. */
export async function loadMembers(res, ids) {
  const map = await getMemberMap(guildId(), ids);
  for (const [k, v] of map) res.locals.members.set(k, v);
  return res.locals.members;
}

export function actor(req) {
  return { actorId: req.session.user?.id, actorName: req.session.user?.displayName || req.session.user?.username, source: 'panel' };
}
