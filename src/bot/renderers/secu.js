import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { BRAND_NAME, COLORS, SECU_RADIOS, SECU_TENUES, SECU_VEHICULES } from '../../utils/constants.js';
import { formatDayLabel, formatHM, formatLongDate } from '../../utils/times.js';
import { slotTimeLabel } from '../../db/services/secuPlanning.js';
import { truncate } from '../utils/messages.js';
import { statusBadge, statusColor } from './missions.js';

const NO_MENTIONS = { parse: [] };

export function vehiculeLabel(mission) {
  if (mission.vehicule === 'custom') return mission.vehiculeCustom || SECU_VEHICULES.custom;
  return SECU_VEHICULES[mission.vehicule] || mission.vehicule;
}

export function secuSummary(mission) {
  return {
    tenue: SECU_TENUES[mission.tenue] || mission.tenue,
    vehicule: vehiculeLabel(mission),
    radio: SECU_RADIOS[mission.radio] || mission.radio,
  };
}

function datesLabel(mission) {
  if (!mission.days.length) return '—';
  const first = mission.days[0].date;
  const last = mission.days[mission.days.length - 1].date;
  if (mission.days.length === 1) return formatLongDate(first);
  return `${formatDayLabel(first)} → ${formatDayLabel(last)} (${mission.days.length} jours)`;
}

function infoFields(mission) {
  const s = secuSummary(mission);
  const slots = mission.days.reduce((n, d) => n + d.slots.length, 0);
  return [
    { name: '📅 Dates', value: datesLabel(mission) },
    { name: '👕 Tenue', value: s.tenue, inline: true },
    { name: '🚗 Véhicule', value: truncate(s.vehicule, 1024), inline: true },
    { name: '📻 Radio', value: s.radio, inline: true },
    { name: '👥 Capacité', value: `${mission.capacity} agent(s) / créneau · ${slots} créneau(x)`, inline: true },
    {
      name: '🧠 Brief TEAM 1',
      value: mission.briefOffset ? `${mission.briefOffset} min avant le début` : 'Au début du créneau',
      inline: true,
    },
    { name: '👤 Responsable', value: `<@${mission.createdBy}>`, inline: true },
  ];
}

export function renderSecuHeader(mission) {
  const embed = new EmbedBuilder()
    .setColor(mission.status === 'OPEN' ? COLORS.brand : statusColor(mission.status))
    .setAuthor({ name: `${BRAND_NAME} • Mission de sécurisation` })
    .setTitle(truncate(`🔒 Sécurisation — ${mission.lieu}`, 256))
    .setDescription(
      `${statusBadge(mission.status)}${mission.pdsChannelId ? `\n📣 Rappels de prise de service dans <#${mission.pdsChannelId}>` : ''}`,
    )
    .addFields(infoFields(mission))
    .setFooter({ text: mission.status === 'OPEN' ? 'Inscris-toi sur les créneaux ci-dessous (clique à nouveau pour te désinscrire)' : BRAND_NAME });
  return { embeds: [embed], components: [], allowedMentions: NO_MENTIONS };
}

export function renderSecuInfo(mission, link) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setAuthor({ name: `${BRAND_NAME} • Information` })
    .setTitle(truncate(`📢 Sécurisation — ${mission.lieu}`, 256))
    .setDescription(`${statusBadge(mission.status)}${link ? `\n👉 **Inscriptions :** ${link}` : ''}`)
    .addFields(infoFields(mission));
  return { embeds: [embed], components: [], allowedMentions: NO_MENTIONS };
}

export function renderSecuDay(mission, day, now = new Date()) {
  const open = mission.status === 'OPEN';
  const embed = new EmbedBuilder()
    .setColor(open ? COLORS.brand : statusColor(mission.status))
    .setTitle(truncate(`📅 ${formatLongDate(day.date)} — ${mission.lieu}`, 256))
    .setFooter({ text: `${BRAND_NAME} • ${mission.capacity} agent(s) par créneau` });

  const fields = day.slots.slice(0, 25).map((slot) => {
    const count = slot.registrations.length;
    const ended = now >= new Date(slot.endAt);
    const flags = [count >= slot.capacity ? 'COMPLET' : null, ended ? 'terminé' : null].filter(Boolean).join(' · ');
    return {
      name: truncate(`${slot.label} · ${formatHM(slot.startAt)} → ${formatHM(slot.endAt)} · ${count}/${slot.capacity}${flags ? ` · ${flags}` : ''}`, 256),
      value: truncate(slot.registrations.map((r) => `<@${r.userId}>`).join(', '), 1024) || '*Aucun inscrit*',
    };
  });
  if (fields.length) embed.addFields(fields);
  else embed.setDescription('*Aucun créneau ce jour.*');

  const components = [];
  if (open) {
    const buttons = day.slots.slice(0, 20).map((slot) => {
      const ended = now >= new Date(slot.endAt);
      const full = slot.registrations.length >= slot.capacity;
      return new ButtonBuilder()
        .setCustomId(`secu:toggle:${mission._id}:${day._id}:${slot._id}`)
        .setLabel(truncate(`${slot.label} · ${slotTimeLabel(slot)}`, 80))
        .setStyle(ended ? ButtonStyle.Secondary : full ? ButtonStyle.Danger : ButtonStyle.Success)
        .setDisabled(ended);
    });
    for (let i = 0; i < buttons.length; i += 5) components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }
  return { embeds: [embed], components, allowedMentions: NO_MENTIONS };
}
