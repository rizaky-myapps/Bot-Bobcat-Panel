import { Router } from 'express';
import { AtmMission, AuditLog, ConvoiMission, GuildConfig, PatrolSession, PatrolTimeTracking, SecuMission } from '../../db/models/index.js';
import { getWeeklyTotals } from '../../db/services/patrolTime.js';
import { getGuildConfig, invalidateGuildConfig, PERMISSION_KEYS } from '../../db/services/permissions.js';
import { audit } from '../../db/services/audit.js';
import { actor, guildId, loadMembers, requirePerm } from '../middleware.js';
import { asArray, clampInt, escapeRegex, parseIdList } from '../helpers.js';
import { config } from '../../utils/config.js';
import { addDays, isoWeek, isoWeekRange, minutesBetween, shiftIsoWeek, DAY_NAMES } from '../../utils/times.js';

const router = Router();

// --- Statistiques -------------------------------------------------------------

function topEntries(map, limit = 10) {
  return [...map.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

router.get('/stats', async (req, res) => {
  const gid = guildId();
  const weeksCount = [4, 8, 12, 26].includes(Number(req.query.semaines)) ? Number(req.query.semaines) : 8;
  const current = isoWeek();
  const weeks = Array.from({ length: weeksCount }, (_, i) => shiftIsoWeek(current, i - weeksCount + 1));
  const since = isoWeekRange(weeks[0].year, weeks[0].week).start;

  const [weekly, placeTotals, sessions, atms, convois, secus] = await Promise.all([
    getWeeklyTotals(gid, weeks),
    PatrolTimeTracking.aggregate([
      { $match: { guildId: gid, $or: weeks.map((w) => ({ year: w.year, weekNumber: w.week })) } },
      { $group: { _id: '$placeName', total: { $sum: '$totalMinutes' } } },
      { $sort: { total: -1 } },
      { $limit: 15 },
    ]),
    PatrolSession.find({ guildId: gid, startAt: { $gte: since } }).select('authorId agentIds agents startAt endAt status places').lean(),
    AtmMission.find({ guildId: gid, scheduledAt: { $gte: since } }).select('status scheduledAt availability participants').lean(),
    ConvoiMission.find({ guildId: gid, scheduledAt: { $gte: since } }).select('status scheduledAt availability participants').lean(),
    SecuMission.find({ guildId: gid, createdAt: { $gte: addDays(since, -30) } }).select('status days').lean(),
  ]);

  // Agents les plus actifs en patrouille (mentions Discord et matricules).
  const patrolAgents = new Map();
  for (const s of sessions) {
    const minutes = s.endAt ? minutesBetween(s.startAt, s.endAt) : 0;
    const keys = new Set([...s.agentIds.map((id) => `id:${id}`), ...s.agents.filter((a) => !/^<@/.test(a)).map((a) => `mat:${a}`)]);
    for (const key of keys) {
      const entry = patrolAgents.get(key) || { score: 0, count: 0, minutes: 0 };
      entry.count++;
      entry.minutes += minutes;
      entry.score = entry.minutes;
      patrolAgents.set(key, entry);
    }
  }

  // Participation aux missions (dispatch ATM + convoi) et disponibilités.
  const missionAgents = new Map();
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const m of [...atms, ...convois]) {
    const when = new Date(m.scheduledAt);
    for (const a of m.availability) {
      const entry = missionAgents.get(a.userId) || { score: 0, dispatched: 0, available: 0 };
      if (a.status === 'AVAILABLE') {
        entry.available++;
        heat[(when.getDay() + 6) % 7][when.getHours()]++;
      }
      missionAgents.set(a.userId, entry);
    }
    for (const p of m.participants) {
      const entry = missionAgents.get(p.userId) || { score: 0, dispatched: 0, available: 0 };
      entry.dispatched++;
      missionAgents.set(p.userId, entry);
    }
  }
  for (const e of missionAgents.values()) e.score = e.dispatched * 10 + e.available;

  // Inscriptions aux sécurisations sur la période.
  const secuAgents = new Map();
  for (const m of secus) {
    for (const d of m.days) {
      for (const slot of d.slots) {
        if (new Date(slot.startAt) < since) continue;
        for (const r of slot.registrations) {
          const entry = secuAgents.get(r.userId) || { score: 0, slots: 0, minutes: 0 };
          entry.slots++;
          entry.minutes += minutesBetween(slot.startAt, slot.endAt);
          entry.score = entry.minutes;
          secuAgents.set(r.userId, entry);
        }
      }
    }
  }

  const countBy = (list) => ({
    OPEN: list.filter((m) => m.status === 'OPEN').length,
    FINISHED: list.filter((m) => m.status === 'FINISHED').length,
    CANCELLED: list.filter((m) => m.status === 'CANCELLED').length,
  });

  const topPatrol = topEntries(patrolAgents);
  const topMissions = topEntries(missionAgents);
  const topSecu = topEntries(secuAgents);
  await loadMembers(res, [
    ...topPatrol.filter((e) => e.key.startsWith('id:')).map((e) => e.key.slice(3)),
    ...topMissions.map((e) => e.key),
    ...topSecu.map((e) => e.key),
  ]);

  const totalMinutes = weekly.reduce((n, w) => n + w.totalMinutes, 0);
  res.render('stats', {
    title: 'Statistiques',
    weeksCount,
    weekly,
    totalMinutes,
    placeTotals,
    patrolCount: sessions.length,
    topPatrol,
    topMissions,
    topSecu,
    atmCounts: countBy(atms),
    convoiCounts: countBy(convois),
    heat,
    heatMax: Math.max(1, ...heat.flat()),
    dayNames: [...DAY_NAMES.slice(1), DAY_NAMES[0]],
  });
});

// --- Paramètres et permissions --------------------------------------------------

router.get('/parametres', requirePerm('super'), async (req, res) => {
  const cfg = await GuildConfig.findOne({ guildId: guildId() }).lean() || (await getGuildConfig(guildId()));
  await loadMembers(res, [...(cfg.superUserIds || []), ...config.superUserIds]);
  res.render('settings', {
    title: 'Paramètres',
    cfg,
    keys: PERMISSION_KEYS,
    envSuperUserIds: config.superUserIds,
    envSuperRoleIds: config.superUserRoleIds,
  });
});

router.post('/parametres', requirePerm('super'), async (req, res) => {
  const roleIds = new Set((res.locals.guild?.roles || []).map((r) => r.id));
  const pick = (value) => asArray(value).filter((id) => roleIds.has(id));
  const permissions = {};
  for (const key of PERMISSION_KEYS) permissions[key] = pick(req.body.perm?.[key]);
  const update = {
    permissions,
    superUserRoleIds: pick(req.body.superUserRoleIds),
    superUserIds: parseIdList(req.body.superUserIds),
    'settings.patrolIdleMinutes': clampInt(req.body.patrolIdleMinutes, 10, 240, 45),
  };
  await GuildConfig.updateOne({ guildId: guildId() }, { $set: update }, { upsert: true });
  invalidateGuildConfig(guildId());
  req.session.perms = null;
  await audit({ guildId: guildId(), ...actor(req), action: 'settings.update', summary: 'Permissions et paramètres modifiés', details: update });
  req.flash('success', 'Paramètres enregistrés. Ils s’appliquent au bot sous 30 secondes.');
  res.redirect('/parametres');
});

// --- Journal d'audit --------------------------------------------------------------

router.get('/journal', async (req, res) => {
  const filter = { guildId: guildId() };
  if (['bot', 'panel', 'system'].includes(req.query.source)) filter.source = req.query.source;
  if (req.query.action) filter.action = { $regex: `^${escapeRegex(req.query.action)}` };
  if (req.query.q) filter.summary = { $regex: escapeRegex(req.query.q), $options: 'i' };
  const page = clampInt(req.query.page, 1, 10_000, 1);
  const pageSize = 50;
  const [total, logs, actions] = await Promise.all([
    AuditLog.countDocuments(filter),
    AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    AuditLog.distinct('action', { guildId: guildId() }),
  ]);
  await loadMembers(res, logs.map((l) => l.actorId));
  const families = [...new Set(actions.map((a) => a.split('.')[0]))].sort();
  res.render('audit', { title: 'Journal', logs, query: req.query, page, pages: Math.max(1, Math.ceil(total / pageSize)), total, families });
});

export default router;
