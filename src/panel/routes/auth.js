import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../../utils/config.js';
import { createLogger } from '../../utils/logger.js';
import { audit } from '../../db/services/audit.js';
import { DiscordMember } from '../../db/models/index.js';
import { guildId, resolvePermissions } from '../middleware.js';

const router = Router();
const log = createLogger('auth');
const DISCORD_API = 'https://discord.com/api/v10';

function redirectUri() {
  return `${config.panel.baseUrl}/auth/callback`;
}

function oauthConfigured() {
  return Boolean(config.discord.clientId && config.discord.clientSecret);
}

function avatarUrl(user) {
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
  const index = Number((BigInt(user.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

async function loginUser(req, res, user) {
  const perms = await resolvePermissions(user.id, { dev: user.dev });
  if (!perms.super && !perms.panel) {
    log.warn(`Accès refusé au panel pour ${user.username} (${user.id}).`);
    return res.status(403).render('error', {
      title: 'Accès refusé',
      message: perms.inGuild
        ? "Ton compte n'a pas de rôle autorisé à accéder au panel. Demande à un super-user de te l'ajouter."
        : "Ton compte n'est pas reconnu sur le serveur. Vérifie que tu es bien membre et que le bot est en ligne (il synchronise les membres).",
    });
  }
  const returnTo = req.session.returnTo || '/';
  await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
  req.session.user = user;
  req.session.perms = perms;
  req.session.permsAt = Date.now();
  await audit({ guildId: guildId(), actorId: user.id, actorName: user.displayName, source: 'panel', action: 'panel.login', summary: 'Connexion au panel' });
  // Uniquement un chemin local : « //domaine » ou « /\domaine » mèneraient vers un autre site.
  const safe = /^\/(?![/\\])/.test(returnTo) ? returnTo : '/';
  return res.redirect(safe);
}

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { title: 'Connexion', oauth: oauthConfigured(), error: req.query.error || null });
});

router.get('/auth/discord', (req, res) => {
  if (!oauthConfigured()) return res.redirect('/login?error=oauth');
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  const params = new URLSearchParams({
    client_id: config.discord.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'identify',
    state,
    prompt: 'none',
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

router.get('/auth/callback', async (req, res, next) => {
  try {
    const { code, state } = req.query;
    if (!code || !state || state !== req.session.oauthState) return res.redirect('/login?error=state');
    delete req.session.oauthState;
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.discord.clientId,
        client_secret: config.discord.clientSecret,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: redirectUri(),
      }),
    });
    if (!tokenRes.ok) {
      log.warn('Échange du code OAuth refusé :', tokenRes.status, await tokenRes.text());
      return res.redirect('/login?error=token');
    }
    const token = await tokenRes.json();
    const userRes = await fetch(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${token.access_token}` } });
    if (!userRes.ok) return res.redirect('/login?error=user');
    const discordUser = await userRes.json();
    const member = await DiscordMember.findOne({ guildId: guildId(), userId: discordUser.id }).lean();
    return loginUser(req, res, {
      id: discordUser.id,
      username: discordUser.username,
      displayName: member?.displayName || discordUser.global_name || discordUser.username,
      avatarUrl: member?.avatarUrl || avatarUrl(discordUser),
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/auth/dev', async (req, res, next) => {
  if (!config.panel.devLogin) return res.redirect('/login');
  try {
    const id = config.panel.devUserId;
    const member = await DiscordMember.findOne({ guildId: guildId(), userId: id }).lean();
    return loginUser(req, res, {
      id,
      username: member?.username || 'dev',
      displayName: member?.displayName || 'Développeur',
      avatarUrl: member?.avatarUrl || null,
      dev: true,
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('bobcat.sid');
    res.redirect('/login');
  });
});

export default router;
