import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder } from 'discord.js';
import { audit } from '../../db/services/audit.js';
import { getDisplayNames } from '../utils/members.js';
import { replyEphemeral } from '../utils/replies.js';
import { toComponentEmoji } from '../utils/emoji.js';
import { truncate } from '../utils/messages.js';
import { dispatchLines, rolesLabel } from '../renderers/missions.js';

export const DISPATCH_ACTIONS = new Set(['dispatch', 'dsel', 'dusr', 'droles', 'dremove', 'dback']);

/**
 * Gestion générique du dispatch (attribution de rôles aux agents) pour les missions ATM et convoi.
 * @param {object} cfg { prefix, roles, title(mission), refresh(client, mission), entity }
 */
async function dispatchPanel(interaction, mission, cfg, notice) {
  const available = mission.availability.filter((a) => a.status === 'AVAILABLE').map((a) => a.userId);
  const dispatched = mission.participants.map((p) => p.userId);
  const ids = [...new Set([...dispatched, ...available])];
  const names = await getDisplayNames(interaction.guild, ids);
  const lines = dispatchLines(mission.participants, cfg.roles);

  const content = [
    notice,
    `🧩 **Dispatch — ${cfg.title(mission)}**`,
    lines.length ? lines.join('\n') : '*Aucun agent dispatché pour le moment.*',
    '',
    ids.length
      ? 'Choisis un agent (disponibles ✅ et déjà dispatchés) ou un autre membre pour lui attribuer des rôles :'
      : 'Aucun agent disponible pour le moment. Choisis un membre :',
  ]
    .filter((l) => l !== undefined && l !== null)
    .join('\n');

  const rows = [];
  if (ids.length) {
    const options = ids.slice(0, 25).map((id) => {
      const participant = mission.participants.find((p) => p.userId === id);
      return {
        label: truncate(names.get(id), 100),
        value: id,
        description: truncate(participant ? rolesLabel(participant.roles, cfg.roles) || 'Dispatché' : '✅ Disponible', 100),
      };
    });
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`${cfg.prefix}:dsel:${mission._id}`).setPlaceholder('Agents disponibles / dispatchés').addOptions(options),
      ),
    );
  }
  rows.push(
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId(`${cfg.prefix}:dusr:${mission._id}`).setPlaceholder('Ou choisir un autre membre…'),
    ),
  );
  return { content: truncate(content, 2000), components: rows, allowedMentions: { parse: [] } };
}

function rolesPanel(mission, cfg, userId) {
  const participant = mission.participants.find((p) => p.userId === userId);
  const current = new Set(participant?.roles || []);
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${cfg.prefix}:droles:${mission._id}:${userId}`)
    .setPlaceholder('Rôles attribués')
    .setMinValues(0)
    .setMaxValues(cfg.roles.length)
    .addOptions(
      cfg.roles.map((r) => ({ label: r.label, value: r.key, emoji: toComponentEmoji(r.emoji), default: current.has(r.key) })),
    );
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${cfg.prefix}:dback:${mission._id}`).setLabel('Retour').setEmoji('⬅️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${cfg.prefix}:dremove:${mission._id}:${userId}`)
      .setLabel('Retirer du dispatch')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!participant),
  );
  return {
    content: `🎭 Rôles de <@${userId}> pour **${cfg.title(mission)}**.\nSélectionne un ou plusieurs rôles puis valide (aucun rôle = retirer du dispatch).`,
    components: [new ActionRowBuilder().addComponents(select), buttons],
    allowedMentions: { parse: [] },
  };
}

function setParticipantRoles(mission, userId, roles) {
  const existing = mission.participants.find((p) => p.userId === userId);
  if (!roles.length) {
    mission.participants = mission.participants.filter((p) => p.userId !== userId);
  } else if (existing) {
    existing.roles = roles;
  } else {
    mission.participants.push({ userId, roles });
  }
}

export async function handleDispatch(interaction, action, mission, cfg) {
  switch (action) {
    case 'dispatch':
      return replyEphemeral(interaction, await dispatchPanel(interaction, mission, cfg));

    case 'dback':
      return interaction.update(await dispatchPanel(interaction, mission, cfg));

    case 'dsel':
    case 'dusr': {
      const userId = interaction.values[0];
      if (!userId) return interaction.update(await dispatchPanel(interaction, mission, cfg));
      if (action === 'dusr' && interaction.users?.get(userId)?.bot) {
        return interaction.update(await dispatchPanel(interaction, mission, cfg, '⚠️ Impossible de dispatcher un bot.'));
      }
      return interaction.update(rolesPanel(mission, cfg, userId));
    }

    case 'droles':
    case 'dremove': {
      const userId = interaction.customId.split(':')[3];
      const validKeys = new Set(cfg.roles.map((r) => r.key));
      const roles = action === 'dremove' ? [] : interaction.values.filter((v) => validKeys.has(v));
      setParticipantRoles(mission, userId, roles);
      await mission.save();
      await cfg.refresh(interaction.client, mission);
      await audit({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
        action: `${cfg.entity}.dispatch`,
        targetType: cfg.entity,
        targetId: mission._id,
        summary: roles.length ? `Rôles attribués à ${userId} : ${roles.join(', ')}` : `${userId} retiré du dispatch`,
      });
      const notice = roles.length
        ? `✅ <@${userId}> : ${rolesLabel(roles, cfg.roles)}`
        : `🗑️ <@${userId}> retiré du dispatch.`;
      return interaction.update(await dispatchPanel(interaction, mission, cfg, notice));
    }

    default:
      return replyEphemeral(interaction, '❓ Action inconnue.');
  }
}
