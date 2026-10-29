import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  SeparatorSpacingSize,
} from 'discord.js';
import { BRAND_NAME, COLORS, EMOJIS } from '../../utils/constants.js';
import { discordTs, formatDateShort, formatDuration, formatHM, minutesBetween, addDays } from '../../utils/times.js';
import { progressBar, visitMinutes } from '../../db/services/patrolTime.js';
import { truncate } from '../utils/messages.js';

const NO_MENTIONS = { parse: [] };

function visitLine(visit, session) {
  const icon = visit.emoji || '📍';
  const start = formatHM(visit.arrivedAt);
  if (!visit.leftAt && session.status === 'OPEN') {
    return `${icon} **${visit.name}** — arrivé à ${start} · *sur place*`;
  }
  const end = visit.leftAt || session.endAt;
  let line = `${icon} **${visit.name}** — ${start} → ${formatHM(end)} · ${formatDuration(visitMinutes(visit, session.endAt))}`;
  if (visit.leaveReason) line += `\n　↳ *${visit.leaveReason}*`;
  return line;
}

function placesText(session, max = 3000) {
  if (!session.places?.length) return '*Aucun lieu visité pour le moment.*';
  const lines = session.places.map((v) => visitLine(v, session));
  let text = '';
  for (let i = 0; i < lines.length; i++) {
    const next = text ? `${text}\n${lines[i]}` : lines[i];
    if (next.length > max) {
      text += `\n*… et ${lines.length - i} autre(s) lieu(x)*`;
      break;
    }
    text = next;
  }
  return text;
}

function agentsText(session) {
  return session.agents?.length ? session.agents.join(', ') : '—';
}

function statusText(session) {
  return session.status === 'OPEN' ? '🟢 En cours' : '⚫ Terminée';
}

export function patrolButtons(session) {
  const id = String(session._id);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`patrol:add:${id}`).setLabel('Ajouter un lieu').setEmoji('➕').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`patrol:leave:${id}`).setLabel('Quitter un lieu').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`patrol:edit:${id}`).setLabel('Corriger un lieu').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`patrol:finish:${id}`).setLabel('Terminer').setEmoji('🛑').setStyle(ButtonStyle.Danger),
  );
}

function durationText(session) {
  if (session.status !== 'FINISHED' || !session.endAt) return null;
  return formatDuration(minutesBetween(session.startAt, session.endAt));
}

function renderV1(session) {
  const open = session.status === 'OPEN';
  const embed = new EmbedBuilder()
    .setColor(open ? COLORS.open : COLORS.finished)
    .setAuthor({ name: `${BRAND_NAME} • Patrouille` })
    .setTitle(truncate(`🛡️ Patrouille — ${session.unit}`, 256))
    .setDescription(`**📍 Lieux visités (${session.places.length})**\n${placesText(session, 3800)}`)
    .addFields(
      { name: '📅 Date', value: session.dateLabel || formatDateShort(session.startAt), inline: true },
      { name: '🕒 Début', value: formatHM(session.startAt), inline: true },
      { name: '🏁 Fin', value: session.endAt ? formatHM(session.endAt) : '—', inline: true },
      { name: '👮 Agents', value: truncate(agentsText(session), 1024) },
      { name: '👤 Créée par', value: `<@${session.authorId}>`, inline: true },
      { name: '📊 Statut', value: statusText(session), inline: true },
    )
    .setFooter({ text: open ? 'Formats d’heure acceptés : 21h, 21h30, 21:30, 2130' : `Durée totale : ${durationText(session)}` })
    .setTimestamp(session.endAt || session.startAt);
  return {
    embeds: [embed],
    components: open ? [patrolButtons(session)] : [],
    allowedMentions: NO_MENTIONS,
  };
}

function renderV2(session) {
  const open = session.status === 'OPEN';
  const info = [
    `📅 **Date :** ${session.dateLabel || formatDateShort(session.startAt)}`,
    `🕒 **Début :** ${formatHM(session.startAt)}${session.endAt ? `　🏁 **Fin :** ${formatHM(session.endAt)}` : ''}`,
    durationText(session) ? `⏱️ **Durée :** ${durationText(session)}` : null,
    `👮 **Agents :** ${truncate(agentsText(session), 500)}`,
    `👤 **Créée par :** <@${session.authorId}>`,
  ]
    .filter(Boolean)
    .join('\n');

  const container = new ContainerBuilder()
    .setAccentColor(open ? COLORS.open : COLORS.finished)
    .addTextDisplayComponents((t) => t.setContent(`## 🛡️ Patrouille — ${truncate(session.unit, 100)}\n${statusText(session)}`))
    .addTextDisplayComponents((t) => t.setContent(info))
    .addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents((t) =>
      t.setContent(`### 📍 Lieux visités (${session.places.length})\n${placesText(session, 2800)}`),
    );
  if (open) {
    container
      .addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addActionRowComponents(patrolButtons(session));
  }
  container.addTextDisplayComponents((t) => t.setContent(`-# ${BRAND_NAME} • ${open ? 'Heures : 21h, 21h30, 21:30, 2130' : 'Patrouille clôturée'}`));
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: NO_MENTIONS };
}

export function renderPatrol(session) {
  return session.version === 'v2' ? renderV2(session) : renderV1(session);
}

function boardLine(row) {
  const icon = row.emoji || '📍';
  if (row.unlimited) return `${icon} **${row.name}** — ${formatDuration(row.usedMinutes)} · ♾️ illimité`;
  if (row.reached) return `${icon} ~~${row.name}~~ — ${formatDuration(row.usedMinutes)} / ${formatDuration(row.maxMinutes)}`;
  return `${icon} **${row.name}** — ${formatDuration(row.usedMinutes)} / ${formatDuration(row.maxMinutes)} · reste **${formatDuration(row.remaining)}**\n\`${progressBar(row.percent)}\``;
}

function joinLimited(lines, max) {
  let text = '';
  for (let i = 0; i < lines.length; i++) {
    const next = text ? `${text}\n${lines[i]}` : lines[i];
    if (next.length > max) return `${text}\n*… et ${lines.length - i} autre(s)*`;
    text = next;
  }
  return text;
}

/** Tableau /patrol-time (Components v2). */
export function renderPatrolTimeBoard(board, now = new Date()) {
  const { start, end } = board.range;
  const container = new ContainerBuilder()
    .setAccentColor(COLORS.brand)
    .addTextDisplayComponents((t) =>
      t.setContent(
        `## ⏱️ Temps de patrouille — Semaine ${board.week}\n-# Du lundi ${formatDateShort(start)} au dimanche ${formatDateShort(addDays(end, -1))} · ${EMOJIS.bobcat} ${BRAND_NAME}`,
      ),
    )
    .addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  if (!board.rows.length) {
    container.addTextDisplayComponents((t) => t.setContent('*Aucun lieu configuré. Utilise `/patrol add` pour en créer.*'));
  } else {
    container.addTextDisplayComponents((t) =>
      t.setContent(
        `### 🟢 Lieux disponibles (${board.available.length})\n${board.available.length ? joinLimited(board.available.map(boardLine), 2200) : '*Aucun*'}`,
      ),
    );
    if (board.reached.length) {
      container
        .addSeparatorComponents((s) => s.setDivider(false).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents((t) =>
          t.setContent(`### 🚫 Limite atteinte (${board.reached.length})\n${joinLimited(board.reached.map(boardLine), 1000)}`),
        );
    }
  }
  container
    .addSeparatorComponents((s) => s.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents((t) =>
      t.setContent(
        `-# Total de la semaine : ${formatDuration(board.totalMinutes)} · Mis à jour ${discordTs(now, 'R')} · actualisation automatique toutes les 15 min`,
      ),
    );
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: NO_MENTIONS };
}
