import { ActionRowBuilder, MessageFlags, StringSelectMenuBuilder } from 'discord.js';
import { PatrolPlace, PatrolSession } from '../../db/models/index.js';
import { getWeekBoard, getPlaceUsedMinutes } from '../../db/services/patrolTime.js';
import { audit } from '../../db/services/audit.js';
import { renderPatrol } from '../renderers/patrol.js';
import { refreshPatrolMessage, touchSession, finishPatrolSession, findOpenSessionInChannel } from '../services/patrol.js';
import { can, isSuper, requirePermission } from '../utils/auth.js';
import { replyEphemeral, updateEphemeral } from '../utils/replies.js';
import { buildModal, getText, getSelect } from '../utils/modals.js';
import { parseAgents, isInFuture } from '../utils/agents.js';
import { toComponentEmoji } from '../utils/emoji.js';
import { messageLink, truncate } from '../utils/messages.js';
import { formatDuration, formatHM, formatLongDate, minutesBetween, parseTimeInput, resolveTimeNear } from '../../utils/times.js';

export const prefix = 'patrol';

const TIME_HINT = 'Formats acceptés : 21h, 21h30, 21:30, 2130';

/** Création d'une patrouille (/patrouille et /patrouille-v2). */
export async function startPatrol(interaction, version) {
  if (!(await requirePermission(interaction, 'patrouille', "⛔ Tu n'as pas la permission de créer une patrouille."))) return;
  const { guildId, channelId } = interaction;
  const existing = await findOpenSessionInChannel(guildId, channelId);
  if (existing) {
    const link = existing.messageId ? ` (${messageLink(guildId, channelId, existing.messageId)})` : '';
    return replyEphemeral(interaction, `⚠️ Une patrouille est déjà en cours dans ce salon${link}. Termine-la avant d'en créer une nouvelle.`);
  }

  const now = new Date();
  let startAt = now;
  const startRaw = interaction.options.getString('heure_debut');
  if (startRaw) {
    const hm = parseTimeInput(startRaw);
    if (!hm) return replyEphemeral(interaction, `❌ Heure de début invalide. ${TIME_HINT}.`);
    startAt = resolveTimeNear(hm, now);
    if (isInFuture(startAt, now)) return replyEphemeral(interaction, "❌ L'heure de début ne peut pas être dans le futur.");
  }

  const unit = interaction.options.getString('unité', true).trim();
  const { labels, ids } = parseAgents(interaction.options.getString('agents', true));
  const session = await PatrolSession.create({
    guildId,
    channelId,
    authorId: interaction.user.id,
    version,
    unit: truncate(unit, 100),
    agents: labels,
    agentIds: ids,
    dateLabel: formatLongDate(startAt),
    startAt,
    lastActivityAt: now,
  });

  try {
    await interaction.reply(renderPatrol(session));
    const message = await interaction.fetchReply();
    session.messageId = message.id;
    await session.save();
  } catch (err) {
    await PatrolSession.deleteOne({ _id: session._id });
    throw err;
  }
  await audit({
    guildId,
    actorId: interaction.user.id,
    actorName: interaction.user.username,
    action: 'patrol.create',
    targetType: 'patrol',
    targetId: session._id,
    summary: `Patrouille ${session.unit} créée (${version})`,
  });
}

async function canManage(interaction, session) {
  const userId = interaction.user.id;
  if (session.authorId === userId || session.agentIds.includes(userId)) return true;
  return can(interaction, 'patrouille');
}

function placeSelect(customId, placeholder, options) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).addOptions(options.slice(0, 25)),
  );
}

function arrivalModal(session, place) {
  return buildModal({
    customId: `patrol:addmodal:${session._id}:${place._id}`,
    title: `Arrivée — ${place.name}`,
    fields: [{ id: 'time', label: "Heure d'arrivée", value: formatHM(new Date()), placeholder: TIME_HINT, maxLength: 5 }],
  });
}

function leaveModal(session, visit) {
  return buildModal({
    customId: `patrol:leavemodal:${session._id}:${visit._id}`,
    title: `Départ — ${visit.name}`,
    fields: [
      { id: 'time', label: 'Heure de sortie', value: formatHM(new Date()), placeholder: TIME_HINT, maxLength: 5 },
      { id: 'reason', label: 'Raison (optionnel)', placeholder: 'Fin de ronde, appel radio…', required: false, maxLength: 200 },
    ],
  });
}

function editModal(session, visit) {
  return buildModal({
    customId: `patrol:editmodal:${session._id}:${visit._id}`,
    title: `Correction — ${visit.name}`,
    fields: [
      { id: 'arrival', label: "Heure d'arrivée", value: formatHM(visit.arrivedAt), placeholder: TIME_HINT, maxLength: 5 },
      {
        id: 'departure',
        label: 'Heure de sortie',
        description: 'Laisser vide si la patrouille est toujours sur place',
        value: visit.leftAt ? formatHM(visit.leftAt) : '',
        placeholder: TIME_HINT,
        required: false,
        maxLength: 5,
      },
      { id: 'reason', label: 'Raison du départ', value: visit.leaveReason || '', required: false, maxLength: 200 },
      {
        id: 'action',
        label: 'Action',
        select: [
          { label: 'Enregistrer la correction', value: 'save', default: true },
          { label: 'Supprimer ce passage', value: 'delete' },
        ],
      },
    ],
  });
}

function finishModal(session) {
  return buildModal({
    customId: `patrol:finishmodal:${session._id}`,
    title: `Terminer — ${session.unit}`,
    fields: [{ id: 'time', label: 'Heure de fin', value: formatHM(new Date()), placeholder: TIME_HINT, maxLength: 5 }],
  });
}

async function save(interaction, session) {
  await touchSession(interaction.client, session);
  await session.save();
  await refreshPatrolMessage(interaction.client, session);
}

export async function handle(interaction, action, args) {
  const [sessionId, extraId] = args;
  const session = await PatrolSession.findById(sessionId).catch(() => null);
  if (!session) return replyEphemeral(interaction, '❌ Patrouille introuvable.');
  if (session.status !== 'OPEN') return replyEphemeral(interaction, '⚠️ Cette patrouille est déjà terminée.');
  if (!(await canManage(interaction, session))) {
    return replyEphemeral(interaction, '⛔ Seuls le créateur et les agents de la patrouille peuvent la modifier.');
  }
  const now = new Date();

  switch (action) {
    case 'add': {
      const places = await PatrolPlace.find({ guildId: session.guildId, active: true })
        .collation({ locale: 'fr', strength: 2 })
        .sort({ name: 1 })
        .lean();
      if (!places.length) {
        return replyEphemeral(interaction, '⚠️ Aucun lieu configuré. Un super-user doit en ajouter avec `/patrol add`.');
      }
      const board = await getWeekBoard(session.guildId);
      const rows = new Map(board.rows.map((r) => [r.placeId, r]));
      const here = new Set(session.places.filter((v) => !v.leftAt).map((v) => String(v.placeId)));
      const options = places.map((p) => {
        const row = rows.get(String(p._id));
        let description;
        if (here.has(String(p._id))) description = '📍 Patrouille déjà sur place';
        else if (!row || row.unlimited) description = `Cette semaine : ${formatDuration(row?.usedMinutes || 0)} · illimité`;
        else if (row.reached) description = `🚫 Limite hebdomadaire atteinte (${formatDuration(row.maxMinutes)})`;
        else description = `Reste ${formatDuration(row.remaining)} sur ${formatDuration(row.maxMinutes)} cette semaine`;
        return { label: truncate(p.name, 100), value: String(p._id), description, emoji: toComponentEmoji(p.emoji) };
      });
      const more = places.length > 25 ? `\n-# ${places.length - 25} lieu(x) non affiché(s) (limite Discord de 25).` : '';
      return replyEphemeral(interaction, {
        content: `📍 Choisis le lieu où arrive la patrouille **${session.unit}** :${more}`,
        components: [placeSelect(`patrol:addsel:${session._id}`, 'Sélectionner un lieu', options)],
      });
    }

    case 'addsel': {
      const place = await PatrolPlace.findById(interaction.values[0]).lean();
      if (!place || !place.active) return updateEphemeral(interaction, '❌ Ce lieu n’existe plus.');
      if (session.places.some((v) => !v.leftAt && String(v.placeId) === String(place._id))) {
        return updateEphemeral(interaction, `⚠️ La patrouille est déjà sur place à **${place.name}**.`);
      }
      const maxMinutes = Math.round((place.maxHoursPerWeek || 0) * 60);
      if (maxMinutes > 0) {
        const used = await getPlaceUsedMinutes(session.guildId, place._id);
        if (used >= maxMinutes && !(await isSuper(interaction))) {
          return updateEphemeral(
            interaction,
            `🚫 Limite hebdomadaire atteinte pour **${place.name}** (${formatDuration(maxMinutes)}). Choisis un autre lieu.`,
          );
        }
      }
      return interaction.showModal(arrivalModal(session, place));
    }

    case 'addmodal': {
      const place = await PatrolPlace.findById(extraId).lean();
      if (!place) return updateEphemeral(interaction, '❌ Ce lieu n’existe plus.');
      const hm = parseTimeInput(getText(interaction, 'time'));
      if (!hm) return updateEphemeral(interaction, `❌ Heure invalide. ${TIME_HINT}.`);
      const arrivedAt = resolveTimeNear(hm, now);
      if (isInFuture(arrivedAt, now)) return updateEphemeral(interaction, "❌ L'heure d'arrivée ne peut pas être dans le futur.");
      if (arrivedAt < session.startAt) {
        return updateEphemeral(interaction, `❌ L'arrivée ne peut pas être avant le début de la patrouille (${formatHM(session.startAt)}).`);
      }
      if (session.places.some((v) => !v.leftAt && String(v.placeId) === String(place._id))) {
        return updateEphemeral(interaction, `⚠️ La patrouille est déjà sur place à **${place.name}**.`);
      }
      session.places.push({ placeId: place._id, name: place.name, emoji: place.emoji, arrivedAt });
      await save(interaction, session);
      return updateEphemeral(interaction, `✅ **${place.name}** ajouté — arrivée à ${formatHM(arrivedAt)}.`);
    }

    case 'leave': {
      const open = session.places.filter((v) => !v.leftAt);
      if (!open.length) return replyEphemeral(interaction, 'ℹ️ Aucun lieu en cours. Utilise « Ajouter un lieu » d’abord.');
      if (open.length === 1) return interaction.showModal(leaveModal(session, open[0]));
      const options = open.map((v) => ({
        label: truncate(v.name, 100),
        value: String(v._id),
        description: `Arrivé à ${formatHM(v.arrivedAt)}`,
        emoji: toComponentEmoji(v.emoji),
      }));
      return replyEphemeral(interaction, {
        content: '✅ Quel lieu la patrouille quitte-t-elle ?',
        components: [placeSelect(`patrol:leavesel:${session._id}`, 'Sélectionner un lieu', options)],
      });
    }

    case 'leavesel': {
      const visit = session.places.id(interaction.values[0]);
      if (!visit || visit.leftAt) return updateEphemeral(interaction, '⚠️ Ce lieu a déjà été quitté.');
      return interaction.showModal(leaveModal(session, visit));
    }

    case 'leavemodal': {
      const visit = session.places.id(extraId);
      if (!visit) return updateEphemeral(interaction, '❌ Passage introuvable.');
      if (visit.leftAt) return updateEphemeral(interaction, '⚠️ Ce lieu a déjà été quitté.');
      const hm = parseTimeInput(getText(interaction, 'time'));
      if (!hm) return updateEphemeral(interaction, `❌ Heure invalide. ${TIME_HINT}.`);
      const leftAt = resolveTimeNear(hm, now, { notBefore: visit.arrivedAt });
      if (isInFuture(leftAt, now)) return updateEphemeral(interaction, "❌ L'heure de sortie ne peut pas être dans le futur.");
      visit.leftAt = leftAt;
      visit.leaveReason = truncate(getText(interaction, 'reason'), 200);
      await save(interaction, session);
      return updateEphemeral(
        interaction,
        `✅ **${visit.name}** quitté à ${formatHM(leftAt)} (${formatDuration(minutesBetween(visit.arrivedAt, leftAt))} sur place).`,
      );
    }

    case 'edit': {
      if (!session.places.length) return replyEphemeral(interaction, 'ℹ️ Aucun lieu à corriger pour le moment.');
      const visits = session.places.slice(-25).reverse();
      const options = visits.map((v) => ({
        label: truncate(v.name, 100),
        value: String(v._id),
        description: `${formatHM(v.arrivedAt)} → ${v.leftAt ? formatHM(v.leftAt) : 'sur place'}`,
        emoji: toComponentEmoji(v.emoji),
      }));
      return replyEphemeral(interaction, {
        content: '✏️ Quel passage veux-tu corriger ?',
        components: [placeSelect(`patrol:editsel:${session._id}`, 'Sélectionner un passage', options)],
      });
    }

    case 'editsel': {
      const visit = session.places.id(interaction.values[0]);
      if (!visit) return updateEphemeral(interaction, '❌ Passage introuvable.');
      return interaction.showModal(editModal(session, visit));
    }

    case 'editmodal': {
      const visit = session.places.id(extraId);
      if (!visit) return updateEphemeral(interaction, '❌ Passage introuvable.');
      if (getSelect(interaction, 'action')[0] === 'delete') {
        const name = visit.name;
        session.places.pull(visit._id);
        await save(interaction, session);
        return updateEphemeral(interaction, `🗑️ Passage à **${name}** supprimé.`);
      }
      const arrivalHm = parseTimeInput(getText(interaction, 'arrival'));
      if (!arrivalHm) return updateEphemeral(interaction, `❌ Heure d'arrivée invalide. ${TIME_HINT}.`);
      const arrivedAt = resolveTimeNear(arrivalHm, visit.arrivedAt);
      if (arrivedAt < session.startAt) {
        return updateEphemeral(interaction, `❌ L'arrivée ne peut pas être avant le début de la patrouille (${formatHM(session.startAt)}).`);
      }
      if (isInFuture(arrivedAt, now)) return updateEphemeral(interaction, "❌ L'heure d'arrivée ne peut pas être dans le futur.");
      let leftAt = null;
      const departureRaw = getText(interaction, 'departure');
      if (departureRaw) {
        const departureHm = parseTimeInput(departureRaw);
        if (!departureHm) return updateEphemeral(interaction, `❌ Heure de sortie invalide. ${TIME_HINT}.`);
        leftAt = resolveTimeNear(departureHm, visit.leftAt || now, { notBefore: arrivedAt });
        if (isInFuture(leftAt, now)) return updateEphemeral(interaction, "❌ L'heure de sortie ne peut pas être dans le futur.");
      } else if (session.places.some((v) => !v.leftAt && String(v._id) !== String(visit._id) && String(v.placeId) === String(visit.placeId))) {
        return updateEphemeral(interaction, '⚠️ Un autre passage sur ce lieu est déjà en cours.');
      }
      visit.arrivedAt = arrivedAt;
      visit.leftAt = leftAt;
      visit.leaveReason = leftAt ? truncate(getText(interaction, 'reason'), 200) : '';
      await save(interaction, session);
      return updateEphemeral(
        interaction,
        `✏️ **${visit.name}** corrigé : ${formatHM(arrivedAt)} → ${leftAt ? formatHM(leftAt) : 'sur place'}.`,
      );
    }

    case 'finish':
      return interaction.showModal(finishModal(session));

    case 'finishmodal': {
      const hm = parseTimeInput(getText(interaction, 'time'));
      if (!hm) return replyEphemeral(interaction, `❌ Heure invalide. ${TIME_HINT}.`);
      const endAt = resolveTimeNear(hm, now, { notBefore: session.startAt });
      if (isInFuture(endAt, now)) return replyEphemeral(interaction, "❌ L'heure de fin ne peut pas être dans le futur.");
      const lastLeave = session.places.reduce((max, v) => (v.leftAt && v.leftAt > max ? v.leftAt : max), session.startAt);
      if (endAt < lastLeave) {
        return replyEphemeral(interaction, `❌ L'heure de fin doit être après le dernier départ (${formatHM(lastLeave)}).`);
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await finishPatrolSession(interaction.client, session, { endAt, actorId: interaction.user.id });
      await audit({
        guildId: session.guildId,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
        action: 'patrol.finish',
        targetType: 'patrol',
        targetId: session._id,
        summary: `Patrouille ${session.unit} terminée`,
      });
      return interaction.editReply(
        `🛑 Patrouille **${session.unit}** terminée à ${formatHM(endAt)} — durée ${formatDuration(minutesBetween(session.startAt, endAt))}, ${session.places.length} lieu(x) visité(s).`,
      );
    }

    default:
      return replyEphemeral(interaction, '❓ Action inconnue.');
  }
}
