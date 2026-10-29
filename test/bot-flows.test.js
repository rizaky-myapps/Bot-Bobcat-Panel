// Scénarios complets du bot (commandes, boutons, menus, modals, réactions, tâches) sur une vraie base MongoDB,
// avec un faux client Discord. Ignorés si MongoDB n'est pas joignable (TEST_MONGODB_URI).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MessageFlags } from 'discord.js';
import { connectDatabase, disconnectDatabase } from '../src/db/connect.js';
import {
  AtmMission,
  ConvoiMission,
  PanelAction,
  PatrolPlace,
  PatrolSession,
  PatrolTimeBoard,
  PatrolTimeTracking,
  PdsSession,
  SecuMission,
} from '../src/db/models/index.js';
import { loadCommands, loadHandlers } from '../src/bot/index.js';
import { execute as route } from '../src/bot/events/interactionCreate.js';
import { handleAvailabilityReaction } from '../src/bot/services/missions.js';
import { runSecuScheduler } from '../src/bot/services/secu.js';
import { processPanelActions } from '../src/bot/jobs/panelActions.js';
import { checkInactivePatrols } from '../src/bot/utils/patrolInactivityWatcher.js';
import { enqueueAction } from '../src/db/services/outbox.js';
import { isoWeek, formatHM, formatDateShort, addDays, addMinutes } from '../src/utils/times.js';
import { GUILD_ID, createClient, createInteraction, guild, member, textOf } from './helpers/fakeDiscord.js';

const URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/bobcat_test_flows';
const OWNER = '900000000000000500'; // propriétaire du serveur = super-user
const AGENT = '900000000000000601';
const OTHER = '900000000000000602';
const CHANNEL = '910000000000000001';

let available = true;
let client;

before(async () => {
  try {
    await connectDatabase(URI);
    await mongoose.connection.db.dropDatabase();
  } catch {
    available = false;
    return;
  }
  client = createClient();
  await loadCommands(client);
  await loadHandlers(client);
});

after(async () => {
  if (!available) return;
  await mongoose.connection.db.dropDatabase();
  await disconnectDatabase();
});

const run = (name, fn) => test(name, async (t) => (available ? fn(t) : t.skip('MongoDB indisponible')));

async function interact(opts) {
  const i = createInteraction(client, { channelId: CHANNEL, ...opts });
  await route(i);
  return i;
}

const lastText = (i) => textOf(i.log.edits.at(-1) || i.log.updates.at(-1) || i.log.followUps.at(-1) || i.log.replies.at(-1));
const isEphemeral = (p) => Boolean((p?.flags || 0) & MessageFlags.Ephemeral);

run('patrouille complète : création, lieux, sortie, fin et temps hebdomadaire', async () => {
  // Lieu créé par un super-user, refusé pour un simple membre.
  const denied = await interact({ type: 'command', commandName: 'patrol', userId: OTHER, options: { _sub: 'add', nom: 'Superette', emoji: '🏪', max_heures: 5 } });
  assert.match(lastText(denied), /super-users/);
  await interact({ type: 'command', commandName: 'patrol', userId: OWNER, options: { _sub: 'add', nom: 'Superette', emoji: '🏪', max_heures: 5 } });
  const place = await PatrolPlace.findOne({ name: 'Superette' });
  assert.ok(place);
  const badEmoji = await interact({ type: 'command', commandName: 'patrol', userId: OWNER, options: { _sub: 'add', nom: 'X', emoji: 'abc', max_heures: 1 } });
  assert.match(lastText(badEmoji), /Emoji invalide/);

  // Tableau de temps publié dans le salon.
  await interact({ type: 'command', commandName: 'patrol-time', userId: OWNER });
  const board = await PatrolTimeBoard.findOne({ channelId: CHANNEL });
  assert.ok(board);

  const now = new Date();
  const create = await interact({
    type: 'command',
    commandName: 'patrouille',
    userId: OWNER,
    options: { 'unité': 'Alpha 1', agents: `<@${AGENT}>, 1234`, heure_debut: formatHM(addMinutes(now, -60)) },
  });
  assert.ok(!isEphemeral(create.log.replies[0]), 'le message de patrouille est public');
  const session = await PatrolSession.findOne({ unit: 'Alpha 1' });
  assert.equal(session.messageId, create._reply.id);
  assert.deepEqual(session.agentIds, [AGENT]);

  // Une seule patrouille par salon.
  const dup = await interact({ type: 'command', commandName: 'patrouille-v2', userId: OWNER, options: { 'unité': 'Bravo', agents: '1' } });
  assert.match(lastText(dup), /déjà en cours/);

  // Un membre extérieur ne peut pas modifier la patrouille.
  const intruder = await interact({ type: 'button', customId: `patrol:add:${session._id}`, userId: OTHER });
  assert.match(lastText(intruder), /créateur et les agents/);

  // Ajout d'un lieu par un agent de la patrouille : bouton → menu → modal.
  const add = await interact({ type: 'button', customId: `patrol:add:${session._id}`, userId: AGENT });
  assert.ok(isEphemeral(add.log.replies[0]));
  assert.match(lastText(add), /Superette/);
  const sel = await interact({ type: 'select', customId: `patrol:addsel:${session._id}`, values: [String(place._id)], userId: AGENT, fromEphemeral: true });
  assert.equal(sel.log.modals.length, 1);
  assert.equal(sel.log.modals[0].custom_id, `patrol:addmodal:${session._id}:${place._id}`);
  const arrival = await interact({
    type: 'modal',
    customId: `patrol:addmodal:${session._id}:${place._id}`,
    fields: { time: formatHM(addMinutes(now, -40)) },
    userId: AGENT,
    fromEphemeral: true,
  });
  assert.match(lastText(arrival), /ajouté/);
  assert.equal(arrival.log.updates.length, 1, 'le menu éphémère est remplacé par la confirmation');

  // Heure invalide puis heure future refusées.
  const bad = await interact({ type: 'modal', customId: `patrol:addmodal:${session._id}:${place._id}`, fields: { time: 'abc' }, userId: AGENT, fromEphemeral: true });
  assert.match(lastText(bad), /Heure invalide/);

  // Quitter : un seul lieu ouvert → modal direct, réponse éphémère (le message public n'est pas écrasé).
  const leave = await interact({ type: 'button', customId: `patrol:leave:${session._id}`, userId: AGENT });
  assert.equal(leave.log.modals.length, 1);
  const visitId = (await PatrolSession.findById(session._id)).places[0]._id;
  const left = await interact({
    type: 'modal',
    customId: `patrol:leavemodal:${session._id}:${visitId}`,
    fields: { time: formatHM(addMinutes(now, -10)), reason: 'RAS' },
    userId: AGENT,
  });
  assert.equal(left.log.updates.length, 0);
  assert.ok(isEphemeral(left.log.replies[0]));
  assert.match(lastText(left), /quitté/);

  // Correction : suppression d'un passage via le menu du modal, puis rajout.
  const edit = await interact({ type: 'button', customId: `patrol:edit:${session._id}`, userId: OWNER });
  assert.match(lastText(edit), /corriger/);
  const editSel = await interact({ type: 'select', customId: `patrol:editsel:${session._id}`, values: [String(visitId)], userId: OWNER, fromEphemeral: true });
  assert.equal(editSel.log.modals.length, 1, 'le modal de correction (avec menu) est valide');
  const corrected = await interact({
    type: 'modal',
    customId: `patrol:editmodal:${session._id}:${visitId}`,
    fields: { arrival: formatHM(addMinutes(now, -45)), departure: formatHM(addMinutes(now, -15)), reason: 'Corrigé', action: ['save'] },
    userId: OWNER,
    fromEphemeral: true,
  });
  assert.match(lastText(corrected), /corrigé/);
  const afterEdit = (await PatrolSession.findById(session._id)).places[0];
  assert.equal(afterEdit.leaveReason, 'Corrigé');
  assert.equal(Math.round((afterEdit.leftAt - afterEdit.arrivedAt) / 60000), 30);

  // Fin de patrouille.
  const finish = await interact({ type: 'button', customId: `patrol:finish:${session._id}`, userId: OWNER });
  assert.equal(finish.log.modals.length, 1);
  const done = await interact({ type: 'modal', customId: `patrol:finishmodal:${session._id}`, fields: { time: formatHM(now) }, userId: OWNER });
  assert.match(lastText(done), /terminée/);
  const finished = await PatrolSession.findById(session._id);
  assert.equal(finished.status, 'FINISHED');
  const week = isoWeek(finished.startAt);
  const tracking = await PatrolTimeTracking.findOne({ placeId: place._id, year: week.year, weekNumber: week.week });
  assert.ok(tracking.totalMinutes >= 29 && tracking.totalMinutes <= 31, `30 min attendues, ${tracking.totalMinutes} comptées`);

  // Message de patrouille mis à jour (plus de boutons) et tableau rafraîchi.
  const message = client.channel(CHANNEL).messagesMap.get(finished.messageId);
  assert.ok(message.edits > 0);
  assert.equal(message.payload.components.length, 0);
  const boardMessage = client.channel(CHANNEL).messagesMap.get(board.messageId);
  assert.ok(boardMessage.edits > 0);
  assert.match(textOf(boardMessage.payload), /30 min/);

  // Les boutons d'une patrouille terminée répondent proprement.
  const late = await interact({ type: 'button', customId: `patrol:add:${session._id}`, userId: OWNER });
  assert.match(lastText(late), /déjà terminée/);
});

run('watcher d’inactivité : DM puis repli dans le salon, nettoyage à la reprise', async () => {
  const s1 = await PatrolSession.create({
    guildId: GUILD_ID, channelId: CHANNEL, messageId: '1', authorId: AGENT, unit: 'Inactive DM',
    startAt: addMinutes(new Date(), -120), lastActivityAt: addMinutes(new Date(), -50),
  });
  client.dmBlocked.add(OTHER);
  const s2 = await PatrolSession.create({
    guildId: GUILD_ID, channelId: '910000000000000077', messageId: '2', authorId: OTHER, unit: 'Inactive salon',
    startAt: addMinutes(new Date(), -120), lastActivityAt: addMinutes(new Date(), -50),
  });
  client.channel('910000000000000077');
  await checkInactivePatrols(client);
  const w1 = (await PatrolSession.findById(s1._id)).inactivityWarning;
  const w2 = (await PatrolSession.findById(s2._id)).inactivityWarning;
  assert.equal(w1.viaDm, true);
  assert.equal(w2.viaDm, false);
  assert.match(client.channel('910000000000000077').sent[0].payload.content, new RegExp(`<@${OTHER}>`));
  // Pas de second avertissement.
  await checkInactivePatrols(client);
  assert.equal(client.channel('910000000000000077').sent.length, 1);
  // Une action supprime l'avertissement.
  const { touchSession } = await import('../src/bot/services/patrol.js');
  const fresh = await PatrolSession.findById(s2._id);
  await touchSession(client, fresh);
  await fresh.save();
  assert.equal(client.channel('910000000000000077').messagesMap.size, 0);
  assert.equal((await PatrolSession.findById(s2._id)).inactivityWarning?.sentAt, undefined);
  await PatrolSession.updateMany({ _id: { $in: [s1._id, s2._id] } }, { status: 'FINISHED' });
});

run('mission ATM : réactions, dispatch, PDS avec ATM, annulation notifiée', async () => {
  const tomorrow = addDays(new Date(), 1);
  const create = await interact({
    type: 'command', commandName: 'atm', userId: OWNER,
    options: { date: formatDateShort(tomorrow), heure: '21h', frequence: 'S7', mention: { id: '920000000000000001' } },
  });
  const mission = await AtmMission.findOne({ createdBy: OWNER });
  assert.ok(mission.messageId);
  assert.deepEqual(create._reply.reactionsAdded, ['✅', '❌']);
  assert.match(create._reply.payload.content, /<@&920000000000000001>/);

  const again = await interact({ type: 'command', commandName: 'atm', userId: OWNER, options: { date: formatDateShort(tomorrow), heure: '22h', frequence: 'S6' } });
  assert.match(lastText(again), /déjà une mission ATM ouverte/);

  // Réaction ✅ d'un agent.
  const message = client.channel(CHANNEL).messagesMap.get(mission.messageId);
  const reactionMessage = { id: mission.messageId, guildId: GUILD_ID, client, guild: guild(OWNER, [member(AGENT)]), reactions: { resolve: () => null } };
  await handleAvailabilityReaction({ partial: false, emoji: { name: '✅' }, message: reactionMessage, users: { remove: async () => {} } }, { id: AGENT, bot: false }, true);
  assert.equal((await AtmMission.findById(mission._id)).availability[0].status, 'AVAILABLE');
  // Changement d'avis : ❌ remplace ✅, puis retrait du ✅ sans effet.
  await handleAvailabilityReaction({ partial: false, emoji: { name: '❌' }, message: reactionMessage, users: { remove: async () => {} } }, { id: AGENT, bot: false }, true);
  await handleAvailabilityReaction({ partial: false, emoji: { name: '✅' }, message: reactionMessage, users: { remove: async () => {} } }, { id: AGENT, bot: false }, false);
  let fresh = await AtmMission.findById(mission._id);
  assert.equal(fresh.availability.length, 1);
  assert.equal(fresh.availability[0].status, 'UNAVAILABLE');
  await handleAvailabilityReaction({ partial: false, emoji: { name: '✅' }, message: reactionMessage, users: { remove: async () => {} } }, { id: AGENT, bot: false }, true);

  // Dispatch : panneau → choix de l'agent → rôles.
  const panel = await interact({ type: 'button', customId: `atm:dispatch:${mission._id}`, userId: OWNER });
  assert.ok(isEphemeral(panel.log.replies[0]));
  const pick = await interact({ type: 'select', customId: `atm:dsel:${mission._id}`, values: [AGENT], userId: OWNER, fromEphemeral: true });
  assert.match(lastText(pick), /Rôles de/);
  await interact({ type: 'select', customId: `atm:droles:${mission._id}:${AGENT}`, values: ['CHEF_OP', 'FUSIL', 'INCONNU'], userId: OWNER, fromEphemeral: true });
  fresh = await AtmMission.findById(mission._id);
  assert.deepEqual(fresh.participants.map((p) => [p.userId, p.roles]), [[AGENT, ['CHEF_OP', 'FUSIL']]]);
  await new Promise((r) => setTimeout(r, 1700)); // rafraîchissement différé après réaction
  assert.match(textOf(message.payload), /Chef d'opération/);

  // Un agent sans rôle ATM ne gère pas le dispatch.
  const nope = await interact({ type: 'button', customId: `atm:dispatch:${mission._id}`, userId: OTHER });
  assert.match(lastText(nope), /responsable de la mission/);

  // PDS rattachée à la mission.
  const pdsCmd = await interact({ type: 'command', commandName: 'pds', userId: AGENT, roles: [], options: { immatriculation: 'zjr  325' } });
  assert.match(lastText(pdsCmd), /permission/); // AGENT n'a pas la permission pds
  await interact({ type: 'command', commandName: 'pds', userId: OWNER, options: { immatriculation: 'zjr  325' } });
  const pds = await PdsSession.findOne({ plate: 'ZJR 325' });
  assert.equal(pds.participants.length, 1);
  const addAtm = await interact({ type: 'button', customId: `pds:addatm:${pds._id}`, userId: AGENT });
  assert.equal(addAtm.log.modals.length, 1, "l'équipage peut ajouter un ATM");
  const added = await interact({ type: 'modal', customId: `pds:atmmodal:${pds._id}`, fields: { label: 'ATM Legion', note: 'RAS' }, userId: AGENT });
  assert.match(lastText(added), /ATM Legion/);
  assert.equal((await PdsSession.findById(pds._id)).atms.length, 1);
  await interact({ type: 'button', customId: `pds:finish:${pds._id}`, userId: AGENT });
  await interact({ type: 'button', customId: `pds:confirmfinish:${pds._id}`, userId: AGENT, fromEphemeral: true });
  assert.equal((await PdsSession.findById(pds._id)).status, 'FINISHED');

  // Annulation avec raison : notification aux agents concernés.
  const before = client.channel(CHANNEL).sent.length;
  await interact({ type: 'button', customId: `atm:cancel:${mission._id}`, userId: OWNER });
  await interact({ type: 'modal', customId: `atm:cancelmodal:${mission._id}`, fields: { reason: 'Météo' }, userId: OWNER });
  fresh = await AtmMission.findById(mission._id);
  assert.equal(fresh.status, 'CANCELLED');
  const notice = client.channel(CHANNEL).sent.slice(before).find((m) => /annulée/.test(m.payload.content));
  assert.ok(notice, 'notification envoyée');
  assert.match(notice.payload.content, new RegExp(`<@${AGENT}>`));
  assert.equal(message.payload.components.length, 0);
});

run('convoi : création, reprogrammation notifiée', async () => {
  await interact({ type: 'command', commandName: 'convoi', userId: OWNER, options: { date: formatDateShort(addDays(new Date(), 2)), heure: '22h' } });
  const convoi = await ConvoiMission.findOne({ createdBy: OWNER });
  assert.ok(convoi.messageId);
  convoi.participants.push({ userId: AGENT, roles: ['ESCORTE'] });
  await convoi.save();
  const target = addDays(new Date(), 3);
  await interact({ type: 'button', customId: `convoi:reschedule:${convoi._id}`, userId: OWNER });
  const res = await interact({ type: 'modal', customId: `convoi:reschedmodal:${convoi._id}`, fields: { date: formatDateShort(target), time: '23h30' }, userId: OWNER });
  assert.match(lastText(res), /reprogrammé/);
  const fresh = await ConvoiMission.findById(convoi._id);
  assert.equal(fresh.reschedules.length, 1);
  assert.equal(fresh.scheduledAt.getHours(), 23);
  const notice = client.channel(CHANNEL).sent.at(-1);
  assert.match(notice.payload.content, /reprogrammé/);
  assert.match(notice.payload.content, new RegExp(`<@${AGENT}>`));
});

run('sécurisation : publication, inscriptions concurrentes, rappels et clôture', async () => {
  const day = addDays(new Date(), 1);
  const PDS_CHANNEL = '910000000000000088';
  client.channel(PDS_CHANNEL);
  const res = await interact({
    type: 'command', commandName: 'secu', userId: OWNER,
    options: {
      lieu: 'Casino', date_et_jours: `${formatDateShort(day)}:2`, capacite: 1, tenue: 'TENUE_SECURISATION', vehicule: 'free',
      radio: 'SIERRA_2', template: '19h-21h,21h-23h', brief_offset: 15, salon_pds: { id: PDS_CHANNEL },
    },
  });
  assert.match(lastText(res), /2 jour\(s\), 4 créneau\(x\)/);
  const mission = await SecuMission.findOne({ lieu: 'Casino' });
  assert.equal(mission.days.length, 2);
  assert.ok(mission.headerMessageId && mission.days.every((d) => d.messageId));

  const d0 = mission.days[0];
  const s0 = d0.slots[0];
  const customId = `secu:toggle:${mission._id}:${d0._id}:${s0._id}`;

  // Clics simultanés de 6 agents sur un créneau à 1 place : une seule inscription.
  const users = Array.from({ length: 6 }, (_, i) => `90000000000000070${i}`);
  await Promise.all(users.map((userId) => interact({ type: 'button', customId, userId })));
  let fresh = await SecuMission.findById(mission._id);
  assert.equal(fresh.days[0].slots[0].registrations.length, 1);
  const winner = fresh.days[0].slots[0].registrations[0].userId;

  // Désinscription en recliquant.
  const toggle = await interact({ type: 'button', customId, userId: winner });
  assert.match(textOf(toggle.log.followUps[0]), /désinscrit/);
  assert.equal(toggle.log.updates.length, 1, 'le message du jour est mis à jour');
  await interact({ type: 'button', customId, userId: AGENT });

  // Rappel du brief TEAM 1 (15 min avant), puis rappel de relève TEAM 2.
  await runSecuScheduler(client, addMinutes(s0.startAt, -14));
  const brief = client.channel(PDS_CHANNEL).sent.at(-1);
  assert.match(brief.payload.content, /Brief TEAM 1/);
  assert.match(brief.payload.content, new RegExp(`<@${AGENT}>`));
  await runSecuScheduler(client, addMinutes(d0.slots[1].startAt, 1));
  assert.match(client.channel(PDS_CHANNEL).sent.at(-1).payload.content, /TEAM 2.*aucun agent inscrit/);
  const count = client.channel(PDS_CHANNEL).sent.length;
  await runSecuScheduler(client, addMinutes(d0.slots[1].startAt, 2));
  assert.equal(client.channel(PDS_CHANNEL).sent.length, count, 'pas de rappel en double');

  // Après le dernier créneau : clôture automatique, boutons retirés.
  const lastSlot = fresh.days[1].slots.at(-1);
  await runSecuScheduler(client, addMinutes(lastSlot.endAt, 1));
  fresh = await SecuMission.findById(mission._id);
  assert.equal(fresh.status, 'FINISHED');
  const dayMessage = client.channel(CHANNEL).messagesMap.get(fresh.days[0].messageId);
  assert.equal(dayMessage.payload.components.length, 0);
});

run('actions du panel : resynchronisation, suppression et erreurs', async () => {
  const mission = await SecuMission.findOne({ lieu: 'Casino' });
  mission.status = 'OPEN';
  const removed = mission.days[1].messageId;
  mission.days.pull(mission.days[1]._id);
  await mission.save();
  await enqueueAction({ guildId: GUILD_ID, entity: 'secu', type: 'refresh', entityId: mission._id, payload: { removedMessageIds: [removed], message: '✖️ Test' } });
  await enqueueAction({ guildId: GUILD_ID, entity: 'inconnu', type: 'refresh' });
  for (let i = 0; i < 3; i++) await processPanelActions(client);
  assert.ok(!client.channel(CHANNEL).messagesMap.has(removed), 'message du jour supprimé');
  const actions = await PanelAction.find().sort({ createdAt: 1 }).lean();
  assert.equal(actions[0].status, 'DONE');
  assert.equal(actions[1].status, 'ERROR');
  assert.equal(actions[1].attempts, 3);
  assert.match(client.channel(CHANNEL).sent.at(-1).payload.content, /✖️ Test/);

  // Message supprimé à la main sur Discord : recréé à la resynchronisation.
  const fresh = await SecuMission.findById(mission._id);
  client.channel(CHANNEL).messagesMap.delete(fresh.headerMessageId);
  await enqueueAction({ guildId: GUILD_ID, entity: 'secu', type: 'refresh', entityId: mission._id });
  await processPanelActions(client);
  const recreated = await SecuMission.findById(mission._id);
  assert.notEqual(recreated.headerMessageId, fresh.headerMessageId);
  assert.ok(client.channel(CHANNEL).messagesMap.has(recreated.headerMessageId));
});

run('utilitaires et autocomplétion', async () => {
  const ac = createInteraction(client, { type: 'autocomplete', commandName: 'patrol', userId: OWNER, channelId: CHANNEL, options: { _focused: 'sup' } });
  await route(ac);
  assert.equal(ac.log.choices.length, 1);
  assert.match(ac.log.choices[0].name, /Superette/);
  const sep = await interact({ type: 'command', commandName: 'separateur', userId: OWNER, options: { titre: 'Patrouilles' } });
  assert.match(lastText(sep), /Séparateur ajouté/);
  const say = await interact({ type: 'command', commandName: 'say', userId: OWNER, options: { message: 'Ligne 1\\nLigne 2' } });
  assert.match(lastText(say), /Message envoyé/);
  assert.equal(client.channel(CHANNEL).sent.at(-1).payload.content, 'Ligne 1\nLigne 2');
  const unknown = await interact({ type: 'button', customId: 'patrol:add:000000000000000000000000', userId: OWNER });
  assert.match(lastText(unknown), /introuvable/);
});
