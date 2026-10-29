import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { ATM_ROLES, BRAND_NAME, COLORS, CONVOI_ROLES, EMOJIS, STATUS_LABELS } from '../../utils/constants.js';
import { discordTs, formatDayLabel, formatDuration, formatHM, minutesBetween } from '../../utils/times.js';
import { truncate } from '../utils/messages.js';

const NO_MENTIONS = { parse: [] };

export function statusColor(status) {
  if (status === 'OPEN') return COLORS.open;
  if (status === 'CANCELLED') return COLORS.cancelled;
  return COLORS.finished;
}

export function statusBadge(status) {
  if (status === 'OPEN') return '🟢 Ouverte';
  if (status === 'CANCELLED') return '🔴 Annulée';
  return `⚫ ${STATUS_LABELS[status] || status}`;
}

function mentionList(ids, max = 1024) {
  if (!ids.length) return '—';
  return truncate(ids.map((id) => `<@${id}>`).join(', '), max);
}

/** Lignes du dispatch, groupées par rôle. */
export function dispatchLines(participants, roles) {
  const lines = [];
  for (const role of roles) {
    const users = participants.filter((p) => p.roles.includes(role.key)).map((p) => `<@${p.userId}>`);
    if (users.length) lines.push(`${role.emoji} **${role.label}** : ${users.join(', ')}`);
  }
  return lines;
}

export function rolesLabel(roleKeys, roles) {
  return roleKeys
    .map((key) => roles.find((r) => r.key === key))
    .filter(Boolean)
    .map((r) => `${r.emoji} ${r.label}`)
    .join(', ');
}

function availabilityFields(mission) {
  const available = mission.availability.filter((a) => a.status === 'AVAILABLE').map((a) => a.userId);
  const unavailable = mission.availability.filter((a) => a.status === 'UNAVAILABLE').map((a) => a.userId);
  return [
    { name: `${EMOJIS.available} Disponibles (${available.length})`, value: mentionList(available), inline: true },
    { name: `${EMOJIS.unavailable} Indisponibles (${unavailable.length})`, value: mentionList(unavailable), inline: true },
  ];
}

function dispatchField(mission, roles) {
  const lines = dispatchLines(mission.participants, roles);
  return { name: `🧩 Dispatch (${mission.participants.length})`, value: truncate(lines.join('\n'), 1024) || '*Dispatch non défini*' };
}

function closingNote(mission) {
  if (mission.status === 'CANCELLED') {
    return `🔴 Annulée${mission.closedBy ? ` par <@${mission.closedBy}>` : ''}${mission.cancelReason ? ` — *${truncate(mission.cancelReason, 300)}*` : ''}`;
  }
  if (mission.status === 'FINISHED') return `⚫ Terminée${mission.closedBy ? ` par <@${mission.closedBy}>` : ''}`;
  return null;
}

export function renderAtm(mission, { withMention = false } = {}) {
  const id = String(mission._id);
  const open = mission.status === 'OPEN';
  const embed = new EmbedBuilder()
    .setColor(statusColor(mission.status))
    .setAuthor({ name: `${BRAND_NAME} • Mission ATM` })
    .setTitle(`📦 Mission ATM — ${formatDayLabel(mission.scheduledAt)} à ${formatHM(mission.scheduledAt)}`)
    .addFields(
      { name: '📅 Date', value: formatDayLabel(mission.scheduledAt), inline: true },
      { name: '⏰ Heure', value: `${formatHM(mission.scheduledAt)} (${discordTs(mission.scheduledAt, 'R')})`, inline: true },
      { name: '📻 Fréquence', value: mission.frequency || '—', inline: true },
      { name: '👤 Responsable', value: `<@${mission.createdBy}>`, inline: true },
      { name: '📊 Statut', value: statusBadge(mission.status), inline: true },
      { name: '​', value: '​', inline: true },
      ...availabilityFields(mission),
      dispatchField(mission, ATM_ROLES),
    )
    .setFooter({ text: open ? 'Réagis avec ✅ ou ❌ pour indiquer ta disponibilité' : BRAND_NAME })
    .setTimestamp(mission.createdAt || new Date());
  const note = closingNote(mission);
  if (note) embed.setDescription(note);

  const components = open
    ? [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`atm:dispatch:${id}`).setLabel('Gérer le dispatch').setEmoji('🧩').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`atm:finish:${id}`).setLabel('Terminer').setEmoji('🏁').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`atm:cancel:${id}`).setLabel('Annuler').setEmoji('✖️').setStyle(ButtonStyle.Danger),
        ),
      ]
    : [];

  const payload = { embeds: [embed], components, allowedMentions: NO_MENTIONS };
  if (withMention && mission.mentionRoleId) {
    payload.content = `<@&${mission.mentionRoleId}> — nouvelle mission ATM !`;
    payload.allowedMentions = { roles: [mission.mentionRoleId] };
  }
  return payload;
}

export function renderConvoi(mission) {
  const id = String(mission._id);
  const open = mission.status === 'OPEN';
  const embed = new EmbedBuilder()
    .setColor(statusColor(mission.status))
    .setAuthor({ name: `${BRAND_NAME} • Ordre de mission` })
    .setTitle(`🚛 Convoi de fonds — ${formatDayLabel(mission.scheduledAt)} à ${formatHM(mission.scheduledAt)}`)
    .addFields(
      { name: '📅 Date', value: formatDayLabel(mission.scheduledAt), inline: true },
      { name: '⏰ Heure', value: `${formatHM(mission.scheduledAt)} (${discordTs(mission.scheduledAt, 'R')})`, inline: true },
      { name: '👤 Responsable', value: `<@${mission.createdBy}>`, inline: true },
      ...availabilityFields(mission),
      dispatchField(mission, CONVOI_ROLES),
    )
    .setFooter({ text: open ? 'Réagis avec ✅ ou ❌ pour indiquer ta disponibilité' : BRAND_NAME })
    .setTimestamp(mission.createdAt || new Date());
  const description = [closingNote(mission) || statusBadge(mission.status)];
  if (mission.notes) description.push(`📝 ${truncate(mission.notes, 1000)}`);
  if (mission.reschedules?.length) {
    const last = mission.reschedules[mission.reschedules.length - 1];
    description.push(`🗓️ Reprogrammé (initialement le ${formatDayLabel(last.from)} à ${formatHM(last.from)})`);
  }
  embed.setDescription(description.join('\n'));

  const components = open
    ? [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`convoi:dispatch:${id}`).setLabel('Gérer le dispatch').setEmoji('🧩').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`convoi:reschedule:${id}`).setLabel('Reprogrammer').setEmoji('🗓️').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`convoi:finish:${id}`).setLabel('Terminer').setEmoji('🏁').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`convoi:cancel:${id}`).setLabel('Annuler').setEmoji('✖️').setStyle(ButtonStyle.Danger),
        ),
      ]
    : [];
  return { embeds: [embed], components, allowedMentions: NO_MENTIONS };
}

export function renderPds(pds, mission) {
  const id = String(pds._id);
  const open = pds.status === 'OPEN';
  const participants = open && mission ? mission.participants : pds.participants;
  const agentLines = participants.map((p) => `<@${p.userId}> — ${rolesLabel(p.roles, ATM_ROLES) || 'sans rôle'}`);
  const atmLines = pds.atms.map((a, i) => {
    const photos = a.photos?.length ? ` · ${a.photos.map((p, j) => `[📸 ${j + 1}](${p.url})`).join(' ')}` : '';
    return `**${i + 1}.** ${truncate(a.label, 80)} — ${formatHM(a.at)}${photos}${a.note ? `\n　↳ *${truncate(a.note, 150)}*` : ''}`;
  });
  const embed = new EmbedBuilder()
    .setColor(open ? COLORS.info : COLORS.finished)
    .setAuthor({ name: `${BRAND_NAME} • Prise de service ATM` })
    .setTitle(`📋 PDS ATM — ${pds.plate}`)
    .setDescription(`**🏧 ATM effectués (${pds.atms.length})**\n${truncate(atmLines.join('\n'), 3500) || '*Aucun ATM pour le moment.*'}`)
    .addFields(
      {
        name: '📦 Mission',
        value: mission
          ? `${formatDayLabel(mission.scheduledAt)} à ${formatHM(mission.scheduledAt)} · 📻 ${mission.frequency}`
          : '*Mission introuvable*',
        inline: true,
      },
      { name: '🚙 Véhicule', value: pds.plate, inline: true },
      {
        name: '🕒 Horaires',
        value: `${formatHM(pds.startAt)} → ${pds.endAt ? `${formatHM(pds.endAt)} (${formatDuration(minutesBetween(pds.startAt, pds.endAt))})` : 'en cours'}`,
        inline: true,
      },
      { name: `👮 Équipage (${participants.length})`, value: truncate(agentLines.join('\n'), 1024) || '*Aucun agent dispatché*' },
      { name: '📊 Statut', value: open ? '🟢 En service' : `⚫ Terminée${pds.finishedBy ? ` par <@${pds.finishedBy}>` : ''}`, inline: true },
      { name: '👤 Ouverte par', value: `<@${pds.createdBy}>`, inline: true },
    )
    .setFooter({ text: BRAND_NAME })
    .setTimestamp(pds.startAt);
  const lastPhoto = [...pds.atms].reverse().find((a) => a.photos?.length)?.photos[0];
  if (lastPhoto?.url) embed.setImage(lastPhoto.url);

  const components = open
    ? [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`pds:addatm:${id}`).setLabel('Ajouter un ATM').setEmoji('➕').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`pds:finish:${id}`).setLabel('Terminer la PDS').setEmoji('🛑').setStyle(ButtonStyle.Danger),
        ),
      ]
    : [];
  return { embeds: [embed], components, allowedMentions: NO_MENTIONS };
}
