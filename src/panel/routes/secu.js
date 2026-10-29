import { Router } from 'express';
import mongoose from 'mongoose';
import { SecuMission } from '../../db/models/index.js';
import { audit } from '../../db/services/audit.js';
import { enqueueAction } from '../../db/services/outbox.js';
import { listMembers } from '../../db/services/members.js';
import { buildSecuDays, buildSlots, parseRanges, relabelSlots } from '../../db/services/secuPlanning.js';
import { actor, guildId, loadMembers, requirePerm } from '../middleware.js';
import { clampInt } from '../helpers.js';
import { SECU_BRIEF_OFFSETS, SECU_MAX_SLOTS_PER_DAY, SECU_RADIOS, SECU_TENUES, SECU_VEHICULES } from '../../utils/constants.js';
import { addDays, combineDateTime, dateKey, formatDayLabel, formatHM, fromDateKey, parseTimeInput } from '../../utils/times.js';

const router = Router();
const PAGE_SIZE = 25;
const isId = (id) => mongoose.isValidObjectId(id);

function notFound(res, what = 'Sécurisation') {
  return res.status(404).render('error', { title: 'Introuvable', message: `${what} introuvable.` });
}

function textChannels(guild) {
  return (guild?.channels || []).filter((c) => c.type === 0 || c.type === 5);
}

function slotStats(mission) {
  const slots = mission.days.flatMap((d) => d.slots);
  return {
    slots: slots.length,
    filled: slots.reduce((n, s) => n + Math.min(s.capacity, s.registrations.length), 0),
    capacity: slots.reduce((n, s) => n + s.capacity, 0),
  };
}

function readInfo(body, channels) {
  const channelIds = new Set(channels.map((c) => c.id));
  const optionalChannel = (id) => (id && channelIds.has(id) ? id : null);
  return {
    lieu: String(body.lieu || '').trim().slice(0, 100),
    tenue: SECU_TENUES[body.tenue] ? body.tenue : 'TENUE_SECURISATION',
    vehicule: SECU_VEHICULES[body.vehicule] ? body.vehicule : 'free',
    vehiculeCustom: String(body.vehiculeCustom || '').slice(0, 100),
    radio: SECU_RADIOS[body.radio] ? body.radio : 'CENTRALE',
    briefOffset: SECU_BRIEF_OFFSETS.includes(Number(body.briefOffset)) ? Number(body.briefOffset) : 0,
    infoChannelId: optionalChannel(body.infoChannelId),
    pdsChannelId: optionalChannel(body.pdsChannelId),
  };
}

async function changed(req, mission, action, summary, payload = {}) {
  await enqueueAction({ guildId: mission.guildId, entity: 'secu', type: 'refresh', entityId: mission._id, payload, createdBy: req.session.user.id });
  await audit({ guildId: mission.guildId, ...actor(req), action, targetType: 'secu', targetId: mission._id, summary });
}

// --- Liste et création ------------------------------------------------------

router.get('/secu', async (req, res) => {
  const filter = { guildId: guildId() };
  if (['OPEN', 'FINISHED', 'CANCELLED'].includes(req.query.status)) filter.status = req.query.status;
  const page = clampInt(req.query.page, 1, 10_000, 1);
  const [total, missions] = await Promise.all([
    SecuMission.countDocuments(filter),
    SecuMission.find(filter).sort({ status: -1, createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
  ]);
  await loadMembers(res, missions.map((m) => m.createdBy));
  res.render('secu/list', {
    title: 'Sécurisations',
    missions: missions.map((m) => ({ ...m, stats: slotStats(m) })),
    query: req.query,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    total,
  });
});

router.get('/secu/nouveau', requirePerm('secu'), (req, res) => {
  res.render('secu/new', {
    title: 'Nouvelle sécurisation',
    channels: textChannels(res.locals.guild),
    values: { capacity: 2, template: '19h-23h/2h', briefOffset: 15 },
    preview: null,
  });
});

router.post('/secu/nouveau', requirePerm('secu'), async (req, res) => {
  const channels = textChannels(res.locals.guild);
  const info = readInfo(req.body, channels);
  const capacity = clampInt(req.body.capacity, 1, 50, 2);
  const { days, error } = buildSecuDays({ daysSpec: req.body.daysSpec, template: req.body.template, planning: req.body.planning, capacity });
  let formError = error;
  if (!formError && !info.lieu) formError = 'Le lieu est obligatoire.';
  if (!formError && !channels.some((c) => c.id === req.body.channelId)) formError = 'Choisis le salon des inscriptions.';
  if (!formError && info.vehicule === 'custom' && !info.vehiculeCustom) formError = 'Indique le véhicule personnalisé.';

  if (formError || req.body.action === 'preview') {
    return res.status(formError ? 400 : 200).render('secu/new', {
      title: 'Nouvelle sécurisation',
      channels,
      values: req.body,
      preview: formError ? null : days,
      error: formError,
    });
  }

  const mission = await SecuMission.create({
    guildId: guildId(),
    channelId: req.body.channelId,
    createdBy: req.session.user.id,
    ...info,
    capacity,
    daysSpec: req.body.daysSpec,
    template: req.body.template,
    planning: req.body.planning || '',
    days,
  });
  await enqueueAction({ guildId: guildId(), entity: 'secu', type: 'publish', entityId: mission._id, createdBy: req.session.user.id });
  await audit({ guildId: guildId(), ...actor(req), action: 'secu.create', targetType: 'secu', targetId: mission._id, summary: `Sécurisation ${mission.lieu} créée depuis le panel` });
  req.flash('success', 'Sécurisation créée — le bot la publie sur Discord dans quelques secondes.');
  res.redirect(`/secu/${mission._id}`);
});

// --- Détail -----------------------------------------------------------------

async function load(req) {
  if (!isId(req.params.id)) return null;
  return SecuMission.findOne({ _id: req.params.id, guildId: guildId() });
}

router.get('/secu/:id', async (req, res) => {
  const mission = await load(req);
  if (!mission) return notFound(res);
  const memberList = await listMembers(guildId());
  await loadMembers(res, [mission.createdBy, ...mission.days.flatMap((d) => d.slots.flatMap((s) => s.registrations.map((r) => r.userId)))]);
  res.render('secu/detail', {
    title: `Sécurisation ${mission.lieu}`,
    mission,
    stats: slotStats(mission),
    channels: textChannels(res.locals.guild),
    memberList,
    maxSlots: SECU_MAX_SLOTS_PER_DAY,
  });
});

router.post('/secu/:id', requirePerm('secu'), async (req, res) => {
  const mission = await load(req);
  if (!mission) return notFound(res);
  const info = readInfo(req.body, textChannels(res.locals.guild));
  if (!info.lieu) {
    req.flash('error', 'Le lieu est obligatoire.');
    return res.redirect(`/secu/${mission._id}`);
  }
  if (mission.infoChannelId && mission.infoChannelId !== info.infoChannelId && mission.infoMessageId) {
    await enqueueAction({
      guildId: mission.guildId,
      entity: 'message',
      type: 'delete',
      payload: { messages: [{ channelId: mission.infoChannelId, messageId: mission.infoMessageId }] },
      createdBy: req.session.user.id,
    });
    mission.infoMessageId = null;
  }
  Object.assign(mission, info);
  await mission.save();
  await changed(req, mission, 'secu.update', `Sécurisation ${mission.lieu} modifiée`);
  req.flash('success', 'Informations mises à jour.');
  res.redirect(`/secu/${mission._id}`);
});

router.post('/secu/:id/status', requirePerm('secu'), async (req, res) => {
  const mission = await load(req);
  if (!mission) return notFound(res);
  const status = req.body.status;
  if (!['OPEN', 'FINISHED', 'CANCELLED'].includes(status)) return res.redirect(`/secu/${mission._id}`);
  mission.status = status;
  mission.closedAt = status === 'OPEN' ? undefined : new Date();
  mission.closedBy = status === 'OPEN' ? undefined : req.session.user.id;
  await mission.save();
  const payload = {};
  if (status === 'CANCELLED' && req.body.notify === 'on') {
    payload.message = `✖️ La sécurisation **${mission.lieu}** est annulée.${req.body.reason ? `\nRaison : *${String(req.body.reason).slice(0, 300)}*` : ''}`;
  }
  await changed(req, mission, 'secu.status', `Sécurisation ${mission.lieu} → ${status}`, payload);
  req.flash('success', 'Statut mis à jour.');
  res.redirect(`/secu/${mission._id}`);
});

router.post('/secu/:id/republish', requirePerm('secu'), async (req, res) => {
  const mission = await load(req);
  if (!mission) return notFound(res);
  await changed(req, mission, 'secu.republish', `Messages de ${mission.lieu} resynchronisés`);
  req.flash('success', 'Les messages Discord vont être mis à jour (et recréés s’ils ont été supprimés).');
  res.redirect(`/secu/${mission._id}`);
});

router.post('/secu/:id/delete', requirePerm('super'), async (req, res) => {
  const mission = await load(req);
  if (!mission) return notFound(res);
  const messages = [
    mission.headerMessageId && { channelId: mission.channelId, messageId: mission.headerMessageId },
    ...mission.days.map((d) => d.messageId && { channelId: mission.channelId, messageId: d.messageId }),
    mission.infoMessageId && { channelId: mission.infoChannelId, messageId: mission.infoMessageId },
  ].filter(Boolean);
  await mission.deleteOne();
  if (messages.length) {
    await enqueueAction({ guildId: mission.guildId, entity: 'message', type: 'delete', payload: { messages }, createdBy: req.session.user.id });
  }
  await audit({ guildId: mission.guildId, ...actor(req), action: 'secu.delete', targetType: 'secu', targetId: mission._id, summary: `Sécurisation ${mission.lieu} supprimée` });
  req.flash('success', 'Sécurisation supprimée, ses messages Discord vont être retirés.');
  res.redirect('/secu');
});

// --- Jours et créneaux --------------------------------------------------------

function slotTimes(day, startRaw, endRaw) {
  const start = parseTimeInput(startRaw);
  const end = parseTimeInput(endRaw);
  if (!start || !end) return null;
  const startAt = combineDateTime(day.date, start);
  let endAt = combineDateTime(day.date, end);
  if (endAt <= startAt) endAt = addDays(endAt, 1);
  return { startAt, endAt };
}

function resetSlotFlags(slot, now = new Date()) {
  if (slot.startAt > now) slot.reminderSentAt = null;
  if (slot.endAt > now) slot.endedRendered = false;
}

router.post('/secu/:id/days', requirePerm('secu'), async (req, res) => {
  const mission = await load(req);
  if (!mission) return notFound(res);
  const date = fromDateKey(req.body.date);
  const { ranges, error } = parseRanges(req.body.ranges);
  const capacity = clampInt(req.body.capacity, 1, 50, mission.capacity);
  if (!date || error) {
    req.flash('error', error || 'Date invalide.');
    return res.redirect(`/secu/${mission._id}`);
  }
  let day = mission.days.find((d) => dateKey(d.date) === dateKey(date));
  if (!day) {
    mission.days.push({ date, slots: [] });
    mission.days.sort((a, b) => a.date - b.date);
    day = mission.days.find((d) => dateKey(d.date) === dateKey(date));
  }
  for (const slot of buildSlots(date, ranges, capacity)) day.slots.push(slot);
  if (day.slots.length > SECU_MAX_SLOTS_PER_DAY) {
    req.flash('error', `Maximum ${SECU_MAX_SLOTS_PER_DAY} créneaux par jour.`);
    return res.redirect(`/secu/${mission._id}`);
  }
  relabelSlots(day);
  if (mission.status === 'FINISHED') mission.status = 'OPEN';
  await mission.save();
  await changed(req, mission, 'secu.day.add', `Créneaux ajoutés le ${formatDayLabel(date)} (${mission.lieu})`);
  req.flash('success', `Créneaux ajoutés le ${formatDayLabel(date)}.`);
  res.redirect(`/secu/${mission._id}#day-${day._id}`);
});

router.post('/secu/:id/days/:dayId/delete', requirePerm('secu'), async (req, res) => {
  const mission = await load(req);
  const day = mission?.days.id(req.params.dayId);
  if (!day) return notFound(res, 'Jour');
  const removedMessageIds = day.messageId ? [day.messageId] : [];
  mission.days.pull(day._id);
  await mission.save();
  await changed(req, mission, 'secu.day.delete', `Jour ${formatDayLabel(day.date)} supprimé (${mission.lieu})`, { removedMessageIds });
  req.flash('success', `Jour ${formatDayLabel(day.date)} supprimé.`);
  res.redirect(`/secu/${mission._id}`);
});

router.post('/secu/:id/days/:dayId/slots', requirePerm('secu'), async (req, res) => {
  const mission = await load(req);
  const day = mission?.days.id(req.params.dayId);
  if (!day) return notFound(res, 'Jour');
  const times = slotTimes(day, req.body.start, req.body.end);
  if (!times) {
    req.flash('error', 'Horaires invalides (ex : 19h, 21:30).');
    return res.redirect(`/secu/${mission._id}#day-${day._id}`);
  }
  if (day.slots.length >= SECU_MAX_SLOTS_PER_DAY) {
    req.flash('error', `Maximum ${SECU_MAX_SLOTS_PER_DAY} créneaux par jour.`);
    return res.redirect(`/secu/${mission._id}#day-${day._id}`);
  }
  day.slots.push({ ...times, capacity: clampInt(req.body.capacity, 1, 50, mission.capacity), registrations: [] });
  relabelSlots(day);
  await mission.save();
  await changed(req, mission, 'secu.slot.add', `Créneau ${formatHM(times.startAt)}-${formatHM(times.endAt)} ajouté le ${formatDayLabel(day.date)}`);
  req.flash('success', 'Créneau ajouté.');
  res.redirect(`/secu/${mission._id}#day-${day._id}`);
});

router.post('/secu/:id/days/:dayId/slots/:slotId', requirePerm('secu'), async (req, res) => {
  const mission = await load(req);
  const day = mission?.days.id(req.params.dayId);
  const slot = day?.slots.id(req.params.slotId);
  if (!slot) return notFound(res, 'Créneau');
  const back = `/secu/${mission._id}#day-${day._id}`;
  if (req.body.action === 'delete') {
    day.slots.pull(slot._id);
    relabelSlots(day);
    await mission.save();
    await changed(req, mission, 'secu.slot.delete', `${slot.label} supprimé le ${formatDayLabel(day.date)}`);
    req.flash('success', `${slot.label} supprimé.`);
    return res.redirect(back);
  }
  const times = slotTimes(day, req.body.start, req.body.end);
  if (!times) {
    req.flash('error', 'Horaires invalides (ex : 19h, 21:30).');
    return res.redirect(back);
  }
  slot.startAt = times.startAt;
  slot.endAt = times.endAt;
  slot.capacity = clampInt(req.body.capacity, 1, 50, slot.capacity);
  resetSlotFlags(slot);
  relabelSlots(day);
  await mission.save();
  await changed(req, mission, 'secu.slot.update', `${slot.label} modifié le ${formatDayLabel(day.date)}`);
  req.flash('success', `${slot.label} mis à jour.`);
  res.redirect(back);
});

router.post('/secu/:id/days/:dayId/slots/:slotId/registrations', requirePerm('secu'), async (req, res) => {
  const mission = await load(req);
  const day = mission?.days.id(req.params.dayId);
  const slot = day?.slots.id(req.params.slotId);
  if (!slot) return notFound(res, 'Créneau');
  const back = `/secu/${mission._id}#day-${day._id}`;
  const userId = String(req.body.userId || '').trim();
  if (!/^\d{17,21}$/.test(userId)) {
    req.flash('error', 'Agent invalide.');
    return res.redirect(back);
  }
  if (slot.registrations.some((r) => r.userId === userId)) {
    req.flash('error', 'Cet agent est déjà inscrit sur ce créneau.');
    return res.redirect(back);
  }
  slot.registrations.push({ userId, at: new Date(), by: req.session.user.id });
  await mission.save();
  await changed(req, mission, 'secu.register', `Agent ${userId} inscrit sur ${slot.label} (${formatDayLabel(day.date)})`);
  req.flash(
    slot.registrations.length > slot.capacity ? 'warning' : 'success',
    slot.registrations.length > slot.capacity ? `Agent inscrit — attention, ${slot.label} dépasse sa capacité.` : 'Agent inscrit.',
  );
  res.redirect(back);
});

router.post('/secu/:id/days/:dayId/slots/:slotId/registrations/:userId/delete', requirePerm('secu'), async (req, res) => {
  const mission = await load(req);
  const day = mission?.days.id(req.params.dayId);
  const slot = day?.slots.id(req.params.slotId);
  if (!slot) return notFound(res, 'Créneau');
  slot.registrations = slot.registrations.filter((r) => r.userId !== req.params.userId);
  await mission.save();
  await changed(req, mission, 'secu.unregister', `Agent ${req.params.userId} retiré de ${slot.label} (${formatDayLabel(day.date)})`);
  req.flash('success', 'Inscription retirée.');
  res.redirect(`/secu/${mission._id}#day-${day._id}`);
});

export default router;
