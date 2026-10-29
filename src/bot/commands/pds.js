import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { AtmMission, PdsSession } from '../../db/models/index.js';
import { audit } from '../../db/services/audit.js';
import { requirePermission } from '../utils/auth.js';
import { replyEphemeral } from '../utils/replies.js';
import { messageLink } from '../utils/messages.js';
import { renderPds } from '../renderers/missions.js';
import { formatDayLabel, formatHM } from '../../utils/times.js';

export const data = new SlashCommandBuilder()
  .setName('pds')
  .setDescription("Démarrer une prise de service ATM (nécessite une mission ATM en cours)")
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) =>
    o.setName('immatriculation').setDescription('Immatriculation du véhicule (ex : ZJR 325)').setRequired(true).setMaxLength(12),
  )
  .addStringOption((o) =>
    o.setName('mission').setDescription('Mission ATM concernée (par défaut : la tienne ou la plus récente)').setAutocomplete(true),
  );

function missionLabel(m) {
  return `ATM ${formatDayLabel(m.scheduledAt)} ${formatHM(m.scheduledAt)} · ${m.frequency} · ${m.participants.length} agent(s)`;
}

export async function autocomplete(interaction) {
  const missions = await AtmMission.find({ guildId: interaction.guildId, status: 'OPEN' }).sort({ scheduledAt: 1 }).limit(25).lean();
  await interaction.respond(missions.map((m) => ({ name: missionLabel(m).slice(0, 100), value: String(m._id) })));
}

/** Choisit la mission ATM : celle demandée, sinon celle où l'utilisateur est impliqué, sinon la plus récente. */
async function resolveMission(interaction) {
  const requested = interaction.options.getString('mission');
  const open = await AtmMission.find({ guildId: interaction.guildId, status: 'OPEN' }).sort({ createdAt: -1 });
  if (requested) return open.find((m) => String(m._id) === requested) || null;
  const userId = interaction.user.id;
  return open.find((m) => m.createdBy === userId || m.participants.some((p) => p.userId === userId)) || open[0] || null;
}

export async function execute(interaction) {
  if (!(await requirePermission(interaction, 'pds', "⛔ Tu n'as pas la permission de démarrer une PDS."))) return;
  const plate = interaction.options.getString('immatriculation', true).trim().toUpperCase().replace(/\s+/g, ' ');
  const mission = await resolveMission(interaction);
  if (!mission) {
    return replyEphemeral(interaction, '❌ Aucune session ATM en cours. Crée d’abord une mission avec `/atm`.');
  }
  const existing = await PdsSession.findOne({ atmMissionId: mission._id, plate, status: 'OPEN' });
  if (existing) {
    const link = existing.messageId ? ` : ${messageLink(existing.guildId, existing.channelId, existing.messageId)}` : '.';
    return replyEphemeral(interaction, `⚠️ Une PDS est déjà ouverte pour le véhicule **${plate}** sur cette mission${link}`);
  }
  const pds = await PdsSession.create({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    atmMissionId: mission._id,
    createdBy: interaction.user.id,
    plate,
    participants: mission.participants.map((p) => ({ userId: p.userId, roles: [...p.roles] })),
  });
  try {
    await interaction.reply(renderPds(pds, mission));
    const message = await interaction.fetchReply();
    pds.messageId = message.id;
    await pds.save();
  } catch (err) {
    await PdsSession.deleteOne({ _id: pds._id });
    throw err;
  }
  await audit({
    guildId: interaction.guildId,
    actorId: interaction.user.id,
    actorName: interaction.user.username,
    action: 'pds.create',
    targetType: 'pds',
    targetId: pds._id,
    summary: `PDS ${plate} ouverte`,
  });
}
