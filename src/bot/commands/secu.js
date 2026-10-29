import { ChannelType, InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { SecuMission } from '../../db/models/index.js';
import { audit } from '../../db/services/audit.js';
import { buildSecuDays } from '../../db/services/secuPlanning.js';
import { SECU_BRIEF_OFFSETS, SECU_RADIOS, SECU_TENUES, SECU_VEHICULES } from '../../utils/constants.js';
import { requirePermission } from '../utils/auth.js';
import { messageLink } from '../utils/messages.js';
import { syncSecuMessages } from '../services/secu.js';

const choices = (map) => Object.entries(map).map(([value, name]) => ({ name, value }));
const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

export const data = new SlashCommandBuilder()
  .setName('secu')
  .setDescription('Créer une mission de sécurisation avec créneaux horaires')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) => o.setName('lieu').setDescription('Nom du lieu sécurisé').setRequired(true).setMaxLength(100))
  .addStringOption((o) =>
    o.setName('date_et_jours').setDescription('Ex : "17/08:3" (3 jours dès le 17/08) ou "14/08,17/08"').setRequired(true).setMaxLength(100),
  )
  .addIntegerOption((o) => o.setName('capacite').setDescription("Nombre d'agents par créneau").setRequired(true).setMinValue(1).setMaxValue(50))
  .addStringOption((o) => o.setName('tenue').setDescription('Tenue des agents').setRequired(true).addChoices(...choices(SECU_TENUES)))
  .addStringOption((o) => o.setName('vehicule').setDescription('Véhicule utilisé').setRequired(true).addChoices(...choices(SECU_VEHICULES)))
  .addStringOption((o) => o.setName('radio').setDescription('Radio à utiliser').setRequired(true).addChoices(...choices(SECU_RADIOS)))
  .addStringOption((o) =>
    o
      .setName('template')
      .setDescription('Plage(s) par défaut : "19h-00h", "19h-21h,21h-23h" ou "19h-01h/2h" (découpage)')
      .setRequired(true)
      .setMaxLength(200),
  )
  .addStringOption((o) =>
    o.setName('planning').setDescription('Exceptions : "18/08=20h-23h; 19/08 off" (séparer par ;)').setMaxLength(1000),
  )
  .addStringOption((o) => o.setName('vehicule_custom').setDescription('Véhicule (si « personnalisé »)').setMaxLength(100))
  .addChannelOption((o) => o.setName('salon_info').setDescription("Salon d'annonce de la mission").addChannelTypes(...TEXT_CHANNELS))
  .addChannelOption((o) => o.setName('salon_pds').setDescription('Salon des rappels de prise de service').addChannelTypes(...TEXT_CHANNELS))
  .addIntegerOption((o) =>
    o
      .setName('brief_offset')
      .setDescription('Brief TEAM 1 : minutes avant le début')
      .addChoices(...SECU_BRIEF_OFFSETS.map((m) => ({ name: m ? `${m} minutes avant` : 'Au début du créneau', value: m }))),
  );

export async function execute(interaction) {
  if (!(await requirePermission(interaction, 'secu', '⛔ Création de sécurisation réservée aux super-users et rôles autorisés.'))) return;
  if (!interaction.channel?.isSendable?.()) {
    return interaction.reply({ content: '❌ Je ne peux pas écrire dans ce salon.', flags: MessageFlags.Ephemeral });
  }
  const o = interaction.options;
  const vehicule = o.getString('vehicule', true);
  const vehiculeCustom = o.getString('vehicule_custom') || '';
  if (vehicule === 'custom' && !vehiculeCustom) {
    return interaction.reply({ content: '❌ Indique le véhicule dans `vehicule_custom`.', flags: MessageFlags.Ephemeral });
  }
  const capacity = o.getInteger('capacite', true);
  const daysSpec = o.getString('date_et_jours', true);
  const template = o.getString('template', true);
  const planning = o.getString('planning') || '';
  const { days, error } = buildSecuDays({ daysSpec, template, planning, capacity });
  if (error) return interaction.reply({ content: `❌ ${error}`, flags: MessageFlags.Ephemeral });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const mission = await SecuMission.create({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    createdBy: interaction.user.id,
    lieu: o.getString('lieu', true).trim(),
    tenue: o.getString('tenue', true),
    vehicule,
    vehiculeCustom,
    radio: o.getString('radio', true),
    capacity,
    daysSpec,
    template,
    planning,
    briefOffset: o.getInteger('brief_offset') || 0,
    infoChannelId: o.getChannel('salon_info')?.id || null,
    pdsChannelId: o.getChannel('salon_pds')?.id || null,
    days,
  });
  try {
    await syncSecuMessages(interaction.client, mission);
  } catch (err) {
    await SecuMission.deleteOne({ _id: mission._id });
    throw err;
  }
  const slots = days.reduce((n, d) => n + d.slots.length, 0);
  await audit({
    guildId: interaction.guildId,
    actorId: interaction.user.id,
    actorName: interaction.user.username,
    action: 'secu.create',
    targetType: 'secu',
    targetId: mission._id,
    summary: `Sécurisation ${mission.lieu} créée (${days.length} jour(s), ${slots} créneau(x))`,
  });
  return interaction.editReply(
    `✅ Sécurisation **${mission.lieu}** publiée : ${days.length} jour(s), ${slots} créneau(x).\n${messageLink(mission.guildId, mission.channelId, mission.headerMessageId)}`,
  );
}
