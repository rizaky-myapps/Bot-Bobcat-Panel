import { Router } from 'express';
import mongoose from 'mongoose';
import { PatrolPlace, PatrolSession } from '../../db/models/index.js';
import {
  getWeekBoard,
  resetAllTime,
  resetPlaceTime,
  syncSessionTracking,
  uncountSession,
  uncountVisit,
  visitMinutes,
} from '../../db/services/patrolTime.js';
import { audit } from '../../db/services/audit.js';
import { enqueueAction } from '../../db/services/outbox.js';
import { listMembers } from '../../db/services/members.js';
import { actor, guildId, loadMembers, requirePerm } from '../middleware.js';
import { clampInt, escapeRegex } from '../helpers.js';
import {
  formatDateTime,
  formatDuration,
  fromDatetimeLocal,
  fromDateKey,
  addDays,
  isoWeek,
  shiftIsoWeek,
  minutesBetween,
} from '../../utils/times.js';

const router = Router();
const PAGE_SIZE = 25;
const PLACE_COLLATION = { locale: 'fr', strength: 2 };

const isId = (id) => mongoose.isValidObjectId(id);

function notFound(res, what = 'Élément') {
  return res.status(404).render('error', { title: 'Introuvable', message: `${what} introuvable.` });
}

function patrolFilter(query) {
  const filter = { guildId: guildId() };
  if (query.status === 'OPEN' || query.status === 'FINISHED') filter.status = query.status;
  if (query.q) {
    const re = { $regex: escapeRegex(query.q.trim()), $options: 'i' };
    filter.$or = [{ unit: re }, { agents: re }];
  }
  if (query.agent) filter.$and = [{ $or: [{ agentIds: query.agent }, { authorId: query.agent }] }];
  if (query.lieu && isId(query.lieu)) filter['places.placeId'] = new mongoose.Types.ObjectId(query.lieu);
  const from = fromDateKey(query.from || '');
  const to = fromDateKey(query.to || '');
  if (from || to) {
    filter.startAt = {};
    if (from) filter.startAt.$gte = from;
    if (to) filter.startAt.$lt = addDays(to, 1);
  }
  return filter;
}

// --- Historique -------------------------------------------------------------

router.get('/patrouilles', async (req, res) => {
  const filter = patrolFilter(req.query);
  const page = clampInt(req.query.page, 1, 10_000, 1);
  const [total, sessions, places, members] = await Promise.all([
    PatrolSession.countDocuments(filter),
    PatrolSession.find(filter).sort({ startAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    PatrolPlace.find({ guildId: guildId() }).collation(PLACE_COLLATION).sort({ name: 1 }).lean(),
    listMembers(guildId()),
  ]);
  await loadMembers(res, sessions.flatMap((s) => [s.authorId, ...s.agentIds]));
  res.render('patrols/list', {
    title: 'Patrouilles',
    sessions,
    places,
    memberList: members,
    query: req.query,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    total,
  });
});

function csvCell(value) {
  const s = String(value ?? '');
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

router.get('/patrouilles.csv', async (req, res) => {
  const sessions = await PatrolSession.find(patrolFilter(req.query)).sort({ startAt: -1 }).limit(5000).lean();
  const members = await loadMembers(res, sessions.flatMap((s) => [s.authorId, ...s.agentIds]));
  const label = (s) => s.agents.map((a) => a.replace(/<@!?(\d+)>/g, (_, id) => members.get(id)?.displayName || id)).join(', ');
  const rows = [['Date début', 'Date fin', 'Unité', 'Agents', 'Créateur', 'Statut', 'Durée (min)', 'Lieu', 'Arrivée', 'Départ', 'Minutes sur place', 'Raison']];
  for (const s of sessions) {
    const base = [
      formatDateTime(s.startAt),
      s.endAt ? formatDateTime(s.endAt) : '',
      s.unit,
      label(s),
      members.get(s.authorId)?.displayName || s.authorId,
      s.status === 'OPEN' ? 'En cours' : 'Terminée',
      s.endAt ? minutesBetween(s.startAt, s.endAt) : '',
    ];
    if (!s.places.length) rows.push([...base, '', '', '', '', '']);
    for (const v of s.places) {
      rows.push([...base, v.name, formatDateTime(v.arrivedAt), v.leftAt ? formatDateTime(v.leftAt) : '', visitMinutes(v, s.endAt || new Date()), v.leaveReason]);
    }
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="patrouilles-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`﻿${rows.map((r) => r.map(csvCell).join(';')).join('\n')}`);
});

// --- Détail et corrections --------------------------------------------------

async function loadSession(req, res) {
  if (!isId(req.params.id)) return null;
  return PatrolSession.findOne({ _id: req.params.id, guildId: guildId() });
}

async function saveSession(req, session, action, summary) {
  if (session.status === 'FINISHED') await syncSessionTracking(session);
  await session.save();
  await enqueueAction({ guildId: session.guildId, entity: 'patrol', entityId: session._id, createdBy: req.session.user.id });
  if (session.status === 'FINISHED') await enqueueAction({ guildId: session.guildId, entity: 'patrolTime', createdBy: req.session.user.id });
  await audit({ guildId: session.guildId, ...actor(req), action, targetType: 'patrol', targetId: session._id, summary });
}

router.get('/patrouilles/:id', async (req, res) => {
  const session = await loadSession(req, res);
  if (!session) return notFound(res, 'Patrouille');
  const places = await PatrolPlace.find({ guildId: guildId(), active: true }).collation(PLACE_COLLATION).sort({ name: 1 }).lean();
  await loadMembers(res, [session.authorId, ...session.agentIds, session.finishedBy]);
  res.render('patrols/detail', { title: `Patrouille ${session.unit}`, session, places, visitMinutes });
});

function readVisitTimes(body) {
  const arrivedAt = fromDatetimeLocal(body.arrivedAt);
  const leftAt = body.leftAt ? fromDatetimeLocal(body.leftAt) : null;
  if (!arrivedAt) return { error: "Heure d'arrivée invalide." };
  if (body.leftAt && !leftAt) return { error: 'Heure de départ invalide.' };
  if (leftAt && leftAt < arrivedAt) return { error: "Le départ doit être après l'arrivée." };
  return { arrivedAt, leftAt };
}

router.post('/patrouilles/:id/visits', requirePerm('patrouille'), async (req, res) => {
  const session = await loadSession(req, res);
  if (!session) return notFound(res, 'Patrouille');
  const place = isId(req.body.placeId) ? await PatrolPlace.findOne({ _id: req.body.placeId, guildId: guildId() }).lean() : null;
  const times = readVisitTimes(req.body);
  if (!place || times.error) {
    req.flash('error', times.error || 'Lieu invalide.');
    return res.redirect(`/patrouilles/${session._id}`);
  }
  session.places.push({ placeId: place._id, name: place.name, emoji: place.emoji, arrivedAt: times.arrivedAt, leftAt: times.leftAt, leaveReason: req.body.leaveReason || '' });
  session.places.sort((a, b) => a.arrivedAt - b.arrivedAt);
  await saveSession(req, session, 'patrol.visit.add', `Passage ${place.name} ajouté à ${session.unit}`);
  req.flash('success', `Passage à ${place.name} ajouté.`);
  res.redirect(`/patrouilles/${session._id}`);
});

router.post('/patrouilles/:id/visits/:visitId', requirePerm('patrouille'), async (req, res) => {
  const session = await loadSession(req, res);
  const visit = session?.places.id(req.params.visitId);
  if (!visit) return notFound(res, 'Passage');
  if (req.body.action === 'delete') {
    await uncountVisit(session, visit);
    session.places.pull(visit._id);
    await saveSession(req, session, 'patrol.visit.delete', `Passage ${visit.name} supprimé de ${session.unit}`);
    req.flash('success', `Passage à ${visit.name} supprimé.`);
    return res.redirect(`/patrouilles/${session._id}`);
  }
  const times = readVisitTimes(req.body);
  if (times.error) {
    req.flash('error', times.error);
    return res.redirect(`/patrouilles/${session._id}`);
  }
  if (session.status === 'FINISHED' && !times.leftAt) times.leftAt = session.endAt;
  visit.arrivedAt = times.arrivedAt;
  visit.leftAt = times.leftAt;
  visit.leaveReason = String(req.body.leaveReason || '').slice(0, 200);
  session.places.sort((a, b) => a.arrivedAt - b.arrivedAt);
  await saveSession(req, session, 'patrol.visit.update', `Passage ${visit.name} corrigé (${session.unit})`);
  req.flash('success', `Passage à ${visit.name} corrigé.`);
  res.redirect(`/patrouilles/${session._id}`);
});

router.post('/patrouilles/:id', requirePerm('patrouille'), async (req, res) => {
  const session = await loadSession(req, res);
  if (!session) return notFound(res, 'Patrouille');
  const startAt = fromDatetimeLocal(req.body.startAt);
  const endAt = req.body.endAt ? fromDatetimeLocal(req.body.endAt) : null;
  if (!startAt || (session.status === 'FINISHED' && !endAt) || (endAt && endAt < startAt)) {
    req.flash('error', 'Horaires invalides.');
    return res.redirect(`/patrouilles/${session._id}`);
  }
  session.unit = String(req.body.unit || session.unit).slice(0, 100);
  session.startAt = startAt;
  if (session.status === 'FINISHED') session.endAt = endAt;
  await saveSession(req, session, 'patrol.update', `Patrouille ${session.unit} modifiée`);
  req.flash('success', 'Patrouille mise à jour.');
  res.redirect(`/patrouilles/${session._id}`);
});

router.post('/patrouilles/:id/finish', requirePerm('patrouille'), async (req, res) => {
  const session = await loadSession(req, res);
  if (!session) return notFound(res, 'Patrouille');
  if (session.status !== 'OPEN') return res.redirect(`/patrouilles/${session._id}`);
  const endAt = fromDatetimeLocal(req.body.endAt) || new Date();
  if (endAt < session.startAt) {
    req.flash('error', "L'heure de fin doit être après le début.");
    return res.redirect(`/patrouilles/${session._id}`);
  }
  for (const v of session.places) if (!v.leftAt) v.leftAt = v.arrivedAt > endAt ? v.arrivedAt : endAt;
  session.endAt = endAt;
  session.status = 'FINISHED';
  session.finishedBy = req.session.user.id;
  await saveSession(req, session, 'patrol.finish', `Patrouille ${session.unit} terminée depuis le panel`);
  req.flash('success', `Patrouille terminée (${formatDuration(minutesBetween(session.startAt, endAt))}).`);
  res.redirect(`/patrouilles/${session._id}`);
});

router.post('/patrouilles/:id/delete', requirePerm('super'), async (req, res) => {
  const session = await loadSession(req, res);
  if (!session) return notFound(res, 'Patrouille');
  await uncountSession(session);
  await session.deleteOne();
  const messages = [];
  if (session.messageId) messages.push({ channelId: session.channelId, messageId: session.messageId });
  if (session.inactivityWarning?.messageId && !session.inactivityWarning.viaDm) {
    messages.push({ channelId: session.inactivityWarning.channelId, messageId: session.inactivityWarning.messageId });
  }
  if (messages.length) await enqueueAction({ guildId: session.guildId, entity: 'message', type: 'delete', payload: { messages }, createdBy: req.session.user.id });
  await enqueueAction({ guildId: session.guildId, entity: 'patrolTime', createdBy: req.session.user.id });
  await audit({ guildId: session.guildId, ...actor(req), action: 'patrol.delete', targetType: 'patrol', targetId: session._id, summary: `Patrouille ${session.unit} supprimée` });
  req.flash('success', 'Patrouille supprimée (temps retiré du suivi hebdomadaire).');
  res.redirect('/patrouilles');
});

// --- Lieux ------------------------------------------------------------------

router.get('/lieux', async (req, res) => {
  const [places, board] = await Promise.all([
    PatrolPlace.find({ guildId: guildId() }).collation(PLACE_COLLATION).sort({ name: 1 }).lean(),
    getWeekBoard(guildId()),
  ]);
  const usage = new Map(board.rows.map((r) => [r.placeId, r]));
  res.render('patrols/places', { title: 'Lieux de patrouille', places, usage });
});

function readPlace(body) {
  const name = String(body.name || '').trim().slice(0, 60);
  const emoji = String(body.emoji || '').trim() || '📍';
  const maxHoursPerWeek = Math.max(0, Math.min(168, Number(String(body.maxHoursPerWeek || '0').replace(',', '.')) || 0));
  return { name, emoji, maxHoursPerWeek, active: body.active === 'on' || body.active === 'true' };
}

async function placesChanged(req, action, place, summary) {
  await enqueueAction({ guildId: guildId(), entity: 'patrolTime', createdBy: req.session.user.id });
  await audit({ guildId: guildId(), ...actor(req), action, targetType: 'place', targetId: place._id, summary });
}

router.post('/lieux', requirePerm('super'), async (req, res) => {
  const data = readPlace({ ...req.body, active: 'on' });
  if (!data.name) {
    req.flash('error', 'Le nom du lieu est obligatoire.');
    return res.redirect('/lieux');
  }
  try {
    const place = await PatrolPlace.create({ guildId: guildId(), ...data });
    await placesChanged(req, 'place.create', place, `Lieu ${place.name} créé`);
    req.flash('success', `Lieu ${place.name} créé.`);
  } catch (err) {
    if (err.code !== 11000) throw err;
    req.flash('error', `Un lieu nommé « ${data.name} » existe déjà.`);
  }
  res.redirect('/lieux');
});

router.post('/lieux/:id', requirePerm('super'), async (req, res) => {
  const place = isId(req.params.id) ? await PatrolPlace.findOne({ _id: req.params.id, guildId: guildId() }) : null;
  if (!place) return notFound(res, 'Lieu');
  if (req.body.action === 'delete') {
    await place.deleteOne();
    await placesChanged(req, 'place.delete', place, `Lieu ${place.name} supprimé`);
    req.flash('success', `Lieu ${place.name} supprimé.`);
    return res.redirect('/lieux');
  }
  const data = readPlace(req.body);
  if (!data.name) {
    req.flash('error', 'Le nom du lieu est obligatoire.');
    return res.redirect('/lieux');
  }
  Object.assign(place, data);
  try {
    await place.save();
  } catch (err) {
    if (err.code !== 11000) throw err;
    req.flash('error', `Un lieu nommé « ${data.name} » existe déjà.`);
    return res.redirect('/lieux');
  }
  await placesChanged(req, 'place.update', place, `Lieu ${place.name} modifié`);
  req.flash('success', `Lieu ${place.name} mis à jour.`);
  res.redirect('/lieux');
});

// --- Temps de patrouille ----------------------------------------------------

function readWeek(query) {
  const current = isoWeek();
  const year = clampInt(query.year, 2020, 2100, current.year);
  const week = clampInt(query.week, 1, 53, current.week);
  return { year, week };
}

router.get('/temps', async (req, res) => {
  const week = readWeek(req.query);
  const board = await getWeekBoard(guildId(), week);
  const current = isoWeek();
  const view = req.query.partial ? 'patrols/_board' : 'patrols/time';
  res.render(view, {
    title: 'Temps de patrouille',
    board,
    week,
    isCurrent: week.year === current.year && week.week === current.week,
    prev: shiftIsoWeek(week, -1),
    next: shiftIsoWeek(week, 1),
  });
});

router.post('/temps/reset', requirePerm('super'), async (req, res) => {
  const week = readWeek(req.body);
  if (req.body.placeId === 'all') {
    await resetAllTime(guildId(), week);
    await audit({ guildId: guildId(), ...actor(req), action: 'patrolTime.resetAll', summary: `Tous les temps réinitialisés (semaine ${week.week})` });
    req.flash('success', `Tous les temps de la semaine ${week.week} ont été réinitialisés.`);
  } else if (isId(req.body.placeId)) {
    const place = await PatrolPlace.findOne({ _id: req.body.placeId, guildId: guildId() }).lean();
    if (place) {
      await resetPlaceTime(guildId(), place._id, week);
      await audit({ guildId: guildId(), ...actor(req), action: 'patrolTime.reset', targetType: 'place', targetId: place._id, summary: `Temps de ${place.name} réinitialisé (semaine ${week.week})` });
      req.flash('success', `Temps de ${place.name} réinitialisé.`);
    }
  }
  await enqueueAction({ guildId: guildId(), entity: 'patrolTime', createdBy: req.session.user.id });
  res.redirect(`/temps?year=${week.year}&week=${week.week}`);
});

export default router;
