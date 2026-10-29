import { Router } from 'express';
import mongoose from 'mongoose';
import { AtmMission, ConvoiMission, PdsSession } from '../../db/models/index.js';
import { audit } from '../../db/services/audit.js';
import { enqueueAction } from '../../db/services/outbox.js';
import { listMembers } from '../../db/services/members.js';
import { actor, guildId, loadMembers, requirePerm } from '../middleware.js';
import { asArray, clampInt } from '../helpers.js';
import { ATM_ROLES, CONVOI_ROLES } from '../../utils/constants.js';
import { formatDayLabel, formatHM, fromDatetimeLocal, formatDateShort } from '../../utils/times.js';

const router = Router();
const PAGE_SIZE = 25;
const isId = (id) => mongoose.isValidObjectId(id);

function notFound(res, what) {
  return res.status(404).render('error', { title: 'Introuvable', message: `${what} introuvable.` });
}

function statusFilter(query) {
  return ['OPEN', 'FINISHED', 'CANCELLED'].includes(query.status) ? query.status : undefined;
}

function textChannels(guild) {
  return (guild?.channels || []).filter((c) => c.type === 0 || c.type === 5);
}

/** Lit le formulaire de dispatch : roles[<userId>][] = clés de rôles. */
function readDispatch(body, roles) {
  const valid = new Set(roles.map((r) => r.key));
  const participants = [];
  for (const [userId, keys] of Object.entries(body.roles || {})) {
    if (!/^\d{17,21}$/.test(userId)) continue;
    const list = asArray(keys).filter((k) => valid.has(k));
    if (list.length) participants.push({ userId, roles: list });
  }
  const added = String(body.addUser || '').trim();
  const addRoles = asArray(body.addRoles).filter((k) => valid.has(k));
  if (/^\d{17,21}$/.test(added) && addRoles.length) {
    const existing = participants.find((p) => p.userId === added);
    if (existing) existing.roles = [...new Set([...existing.roles, ...addRoles])];
    else participants.push({ userId: added, roles: addRoles });
  }
  return participants;
}

function missionTitle(kind, m) {
  return `${kind === 'atm' ? 'Mission ATM' : 'Convoi'} du ${formatDayLabel(m.scheduledAt)} à ${formatHM(m.scheduledAt)}`;
}

// Routes communes ATM / convoi.
function missionRoutes({ kind, base, Model, roles, permission, label, view }) {
  router.get(base, async (req, res) => {
    const filter = { guildId: guildId() };
    const status = statusFilter(req.query);
    if (status) filter.status = status;
    const page = clampInt(req.query.page, 1, 10_000, 1);
    const [total, missions] = await Promise.all([
      Model.countDocuments(filter),
      Model.find(filter).sort({ status: -1, scheduledAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    ]);
    await loadMembers(res, missions.map((m) => m.createdBy));
    let pdsCounts = new Map();
    if (kind === 'atm') {
      const counts = await PdsSession.aggregate([
        { $match: { atmMissionId: { $in: missions.map((m) => m._id) } } },
        { $group: { _id: '$atmMissionId', n: { $sum: 1 } } },
      ]);
      pdsCounts = new Map(counts.map((c) => [String(c._id), c.n]));
    }
    res.render(`${view}/list`, { title: label, missions, query: req.query, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total, pdsCounts });
  });

  async function load(req) {
    if (!isId(req.params.id)) return null;
    return Model.findOne({ _id: req.params.id, guildId: guildId() });
  }

  router.get(`${base}/:id`, async (req, res) => {
    const mission = await load(req);
    if (!mission) return notFound(res, label);
    const pds = kind === 'atm' ? await PdsSession.find({ atmMissionId: mission._id }).sort({ startAt: -1 }).lean() : [];
    const memberList = await listMembers(guildId());
    await loadMembers(res, [
      mission.createdBy,
      mission.closedBy,
      ...mission.availability.map((a) => a.userId),
      ...mission.participants.map((p) => p.userId),
      ...(mission.reschedules || []).map((r) => r.by),
      ...pds.map((p) => p.createdBy),
    ]);
    const agentIds = [...new Set([...mission.participants.map((p) => p.userId), ...mission.availability.filter((a) => a.status === 'AVAILABLE').map((a) => a.userId)])];
    res.render(`${view}/detail`, { title: missionTitle(kind, mission), mission, roles, agentIds, memberList, pds, kind });
  });

  router.post(`${base}/:id/dispatch`, requirePerm(permission), async (req, res) => {
    const mission = await load(req);
    if (!mission) return notFound(res, label);
    if (mission.status !== 'OPEN') {
      req.flash('error', 'Cette mission est clôturée.');
      return res.redirect(`${base}/${mission._id}`);
    }
    mission.participants = readDispatch(req.body, roles);
    await mission.save();
    await enqueueAction({ guildId: mission.guildId, entity: kind, entityId: mission._id, createdBy: req.session.user.id });
    await audit({ guildId: mission.guildId, ...actor(req), action: `${kind}.dispatch`, targetType: kind, targetId: mission._id, summary: `Dispatch modifié (${mission.participants.length} agent(s))` });
    req.flash('success', 'Dispatch enregistré — le message Discord sera mis à jour dans quelques secondes.');
    res.redirect(`${base}/${mission._id}`);
  });

  router.post(`${base}/:id/status`, requirePerm(permission), async (req, res) => {
    const mission = await load(req);
    if (!mission) return notFound(res, label);
    const status = req.body.status;
    if (!['OPEN', 'FINISHED', 'CANCELLED'].includes(status)) return res.redirect(`${base}/${mission._id}`);
    const title = missionTitle(kind, mission);
    mission.status = status;
    if (status === 'OPEN') {
      mission.closedAt = undefined;
      mission.closedBy = undefined;
      mission.cancelReason = undefined;
    } else {
      mission.closedAt = new Date();
      mission.closedBy = req.session.user.id;
      if (status === 'CANCELLED') mission.cancelReason = String(req.body.reason || '').slice(0, 300);
    }
    await mission.save();
    let message;
    if (status === 'CANCELLED' && req.body.notify === 'on') {
      message = `✖️ ${kind === 'atm' ? 'La' : 'Le'} **${title}** est ${kind === 'atm' ? 'annulée' : 'annulé'}.${mission.cancelReason ? `\nRaison : *${mission.cancelReason}*` : ''}`;
    }
    await enqueueAction({ guildId: mission.guildId, entity: kind, entityId: mission._id, payload: { message }, createdBy: req.session.user.id });
    await audit({ guildId: mission.guildId, ...actor(req), action: `${kind}.status`, targetType: kind, targetId: mission._id, summary: `${title} → ${status}` });
    req.flash('success', 'Statut mis à jour.');
    res.redirect(`${base}/${mission._id}`);
  });

  router.post(`${base}/:id/availability/:userId/delete`, requirePerm(permission), async (req, res) => {
    const mission = await load(req);
    if (!mission) return notFound(res, label);
    await Model.updateOne({ _id: mission._id }, { $pull: { availability: { userId: req.params.userId } } });
    await enqueueAction({ guildId: mission.guildId, entity: kind, entityId: mission._id, createdBy: req.session.user.id });
    req.flash('success', 'Disponibilité retirée (la réaction Discord reste visible).');
    res.redirect(`${base}/${mission._id}`);
  });

  return load;
}

// --- Convois : création (déclarée avant /convois/:id) -------------------------

router.get('/convois/nouveau', requirePerm('convoi'), (req, res) => {
  res.render('convois/new', { title: 'Nouveau convoi', channels: textChannels(res.locals.guild), values: {} });
});

router.post('/convois/nouveau', requirePerm('convoi'), async (req, res) => {
  const scheduledAt = fromDatetimeLocal(req.body.scheduledAt);
  const channels = textChannels(res.locals.guild);
  if (!scheduledAt || !channels.some((c) => c.id === req.body.channelId)) {
    return res.status(400).render('convois/new', { title: 'Nouveau convoi', channels, values: req.body, error: 'Date ou salon invalide.' });
  }
  const mission = await ConvoiMission.create({
    guildId: guildId(),
    channelId: req.body.channelId,
    createdBy: req.session.user.id,
    dateStr: formatDateShort(scheduledAt),
    timeStr: formatHM(scheduledAt),
    scheduledAt,
    notes: String(req.body.notes || '').slice(0, 500),
  });
  await enqueueAction({ guildId: guildId(), entity: 'convoi', type: 'publish', entityId: mission._id, createdBy: req.session.user.id });
  await audit({ guildId: guildId(), ...actor(req), action: 'convoi.create', targetType: 'convoi', targetId: mission._id, summary: `${missionTitle('convoi', mission)} créé depuis le panel` });
  req.flash('success', 'Convoi créé — le bot va publier l’ordre de mission dans quelques secondes.');
  res.redirect(`/convois/${mission._id}`);
});

missionRoutes({ kind: 'atm', base: '/atm', Model: AtmMission, roles: ATM_ROLES, permission: 'atm', label: 'Missions ATM', view: 'atm' });
const loadConvoi = missionRoutes({ kind: 'convoi', base: '/convois', Model: ConvoiMission, roles: CONVOI_ROLES, permission: 'convoi', label: 'Convois', view: 'convois' });

// --- Convois : reprogrammation ------------------------------------------------

router.post('/convois/:id/reschedule', requirePerm('convoi'), async (req, res) => {
  const mission = await loadConvoi(req);
  if (!mission) return notFound(res, 'Convoi');
  const to = fromDatetimeLocal(req.body.scheduledAt);
  if (!to) {
    req.flash('error', 'Date invalide.');
    return res.redirect(`/convois/${mission._id}`);
  }
  const from = mission.scheduledAt;
  mission.scheduledAt = to;
  mission.dateStr = formatDateShort(to);
  mission.timeStr = formatHM(to);
  mission.reschedules.push({ from, to, by: req.session.user.id, at: new Date() });
  mission.notes = String(req.body.notes ?? mission.notes).slice(0, 500);
  await mission.save();
  const message =
    req.body.notify === 'on' && from.getTime() !== to.getTime()
      ? `🗓️ Convoi reprogrammé : ~~${formatDayLabel(from)} à ${formatHM(from)}~~ → **${formatDayLabel(to)} à ${formatHM(to)}**.\nPensez à mettre à jour votre disponibilité.`
      : undefined;
  await enqueueAction({ guildId: mission.guildId, entity: 'convoi', entityId: mission._id, payload: { message }, createdBy: req.session.user.id });
  await audit({ guildId: mission.guildId, ...actor(req), action: 'convoi.reschedule', targetType: 'convoi', targetId: mission._id, summary: `Convoi reprogrammé au ${formatDayLabel(to)} ${formatHM(to)}` });
  req.flash('success', 'Convoi mis à jour.');
  res.redirect(`/convois/${mission._id}`);
});

// --- PDS ------------------------------------------------------------------------

router.get('/pds', async (req, res) => {
  const filter = { guildId: guildId() };
  if (req.query.status === 'OPEN' || req.query.status === 'FINISHED') filter.status = req.query.status;
  const page = clampInt(req.query.page, 1, 10_000, 1);
  const [total, sessions] = await Promise.all([
    PdsSession.countDocuments(filter),
    PdsSession.find(filter).sort({ startAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).populate('atmMissionId').lean(),
  ]);
  await loadMembers(res, sessions.map((s) => s.createdBy));
  res.render('pds/list', { title: 'Prises de service', sessions, query: req.query, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total });
});

async function loadPds(req) {
  if (!isId(req.params.id)) return null;
  return PdsSession.findOne({ _id: req.params.id, guildId: guildId() });
}

router.get('/pds/:id', async (req, res) => {
  const pds = await loadPds(req);
  if (!pds) return notFound(res, 'PDS');
  const mission = await AtmMission.findById(pds.atmMissionId).lean();
  const participants = pds.status === 'OPEN' && mission ? mission.participants : pds.participants;
  await loadMembers(res, [pds.createdBy, pds.finishedBy, ...participants.map((p) => p.userId), ...pds.atms.map((a) => a.addedBy)]);
  res.render('pds/detail', { title: `PDS ${pds.plate}`, pds, mission, participants });
});

router.post('/pds/:id/atms/:atmId/delete', requirePerm('pds'), async (req, res) => {
  const pds = await loadPds(req);
  const atm = pds?.atms.id(req.params.atmId);
  if (!atm) return notFound(res, 'ATM');
  pds.atms.pull(atm._id);
  await pds.save();
  await enqueueAction({ guildId: pds.guildId, entity: 'pds', entityId: pds._id, createdBy: req.session.user.id });
  await audit({ guildId: pds.guildId, ...actor(req), action: 'pds.atm.delete', targetType: 'pds', targetId: pds._id, summary: `ATM ${atm.label} retiré de la PDS ${pds.plate}` });
  req.flash('success', `ATM ${atm.label} supprimé.`);
  res.redirect(`/pds/${pds._id}`);
});

router.post('/pds/:id/finish', requirePerm('pds'), async (req, res) => {
  const pds = await loadPds(req);
  if (!pds) return notFound(res, 'PDS');
  if (pds.status === 'OPEN') {
    const mission = await AtmMission.findById(pds.atmMissionId).lean();
    pds.status = 'FINISHED';
    pds.endAt = new Date();
    pds.finishedBy = req.session.user.id;
    if (mission) pds.participants = mission.participants;
    await pds.save();
    await enqueueAction({ guildId: pds.guildId, entity: 'pds', entityId: pds._id, createdBy: req.session.user.id });
    await audit({ guildId: pds.guildId, ...actor(req), action: 'pds.finish', targetType: 'pds', targetId: pds._id, summary: `PDS ${pds.plate} terminée depuis le panel` });
    req.flash('success', 'PDS terminée.');
  }
  res.redirect(`/pds/${pds._id}`);
});

export default router;
