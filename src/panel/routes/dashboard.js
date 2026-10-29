import { Router } from 'express';
import {
  AtmMission,
  AuditLog,
  BotHeartbeat,
  ConvoiMission,
  PanelAction,
  PatrolSession,
  PdsSession,
  SecuMission,
} from '../../db/models/index.js';
import { getWeekBoard } from '../../db/services/patrolTime.js';
import { guildId, loadMembers } from '../middleware.js';
import { addDays } from '../../utils/times.js';

const router = Router();

router.get('/', async (req, res) => {
  const gid = guildId();
  const now = new Date();
  const horizon = addDays(now, 14);
  const [openPatrols, board, atms, pds, convois, secus, recent, heartbeat, pending, failed] = await Promise.all([
    PatrolSession.find({ guildId: gid, status: 'OPEN' }).sort({ startAt: -1 }).lean(),
    getWeekBoard(gid),
    AtmMission.find({ guildId: gid, status: 'OPEN' }).sort({ scheduledAt: 1 }).lean(),
    PdsSession.find({ guildId: gid, status: 'OPEN' }).lean(),
    ConvoiMission.find({ guildId: gid, status: 'OPEN' }).sort({ scheduledAt: 1 }).lean(),
    SecuMission.find({ guildId: gid, status: 'OPEN' }).lean(),
    AuditLog.find({ guildId: gid, action: { $ne: 'panel.login' } }).sort({ createdAt: -1 }).limit(12).lean(),
    BotHeartbeat.findById('bot').lean(),
    PanelAction.countDocuments({ guildId: gid, status: { $in: ['PENDING', 'PROCESSING'] } }),
    PanelAction.countDocuments({ guildId: gid, status: 'ERROR', updatedAt: { $gt: addDays(now, -1) } }),
  ]);

  const upcoming = [
    ...atms.map((m) => ({ kind: 'ATM', icon: '📦', href: `/atm/${m._id}`, at: m.scheduledAt, title: `Mission ATM · ${m.frequency}`, m })),
    ...convois.map((m) => ({ kind: 'Convoi', icon: '🚛', href: `/convois/${m._id}`, at: m.scheduledAt, title: 'Convoi de fonds', m })),
    ...secus.flatMap((s) =>
      s.days
        .filter((d) => d.slots.some((slot) => new Date(slot.endAt) > now))
        .slice(0, 1)
        .map((d) => {
          const slots = d.slots;
          const filled = slots.reduce((n, slot) => n + slot.registrations.length, 0);
          const capacity = slots.reduce((n, slot) => n + slot.capacity, 0);
          return { kind: 'Sécu', icon: '🔒', href: `/secu/${s._id}`, at: slots[0]?.startAt || d.date, title: s.lieu, filled, capacity };
        }),
    ),
  ]
    .filter((u) => new Date(u.at) < horizon)
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .slice(0, 10);

  const secuSlots = secus.flatMap((s) => s.days.flatMap((d) => d.slots)).filter((slot) => new Date(slot.endAt) > now);
  const secuFill = {
    filled: secuSlots.reduce((n, s) => n + Math.min(s.capacity, s.registrations.length), 0),
    capacity: secuSlots.reduce((n, s) => n + s.capacity, 0),
  };

  const ids = [
    ...openPatrols.flatMap((p) => [p.authorId, ...p.agentIds]),
    ...atms.map((m) => m.createdBy),
    ...convois.map((m) => m.createdBy),
    ...recent.map((r) => r.actorId),
  ];
  await loadMembers(res, ids);

  const botOnline = heartbeat?.updatedAt && now - new Date(heartbeat.updatedAt) < 3 * 60 * 1000;
  res.render('dashboard', {
    title: 'Tableau de bord',
    openPatrols,
    board,
    atms,
    pds,
    convois,
    secus,
    secuFill,
    upcoming,
    recent,
    bot: { online: Boolean(botOnline), heartbeat, pending, failed },
  });
});

export default router;
