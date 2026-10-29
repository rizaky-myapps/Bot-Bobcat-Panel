import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { AtmMission, PdsSession } from '../../db/models/index.js';
import { audit } from '../../db/services/audit.js';
import { cloudinaryEnabled } from '../../utils/config.js';
import { can } from '../utils/auth.js';
import { replyEphemeral, updateEphemeral } from '../utils/replies.js';
import { buildModal, getFiles, getText } from '../utils/modals.js';
import { fetchChannel, truncate } from '../utils/messages.js';
import { refreshPdsMessage } from '../services/missions.js';
import { storeImage } from '../services/uploads.js';
import { createLogger } from '../../utils/logger.js';

export const prefix = 'pds';
const log = createLogger('pds');
const MAX_PHOTOS = 5;

async function canManage(interaction, pds, mission) {
  const userId = interaction.user.id;
  if (pds.createdBy === userId) return true;
  if (mission?.participants.some((p) => p.userId === userId)) return true;
  return can(interaction, 'pds');
}

/** Sans Cloudinary, on republie les photos dans le salon pour les conserver dans l'historique Discord. */
async function repostPhotos(client, pds, label, files) {
  const channel = await fetchChannel(client, pds.channelId);
  if (!channel?.isSendable?.()) return files.map((f) => ({ url: f.url, publicId: null }));
  const message = await channel.send({
    content: `📸 Photos — **${truncate(label, 80)}** (PDS ${pds.plate})`,
    files: files.map((f) => new AttachmentBuilder(f.url, { name: f.name || 'photo.png' })),
    reply: pds.messageId ? { messageReference: pds.messageId, failIfNotExists: false } : undefined,
    allowedMentions: { parse: [] },
  });
  return [...message.attachments.values()].map((a) => ({ url: a.url, publicId: null }));
}

export async function handle(interaction, action, args) {
  if (action === 'abort') return updateEphemeral(interaction, 'Action annulée.');
  const pds = await PdsSession.findById(args[0]).catch(() => null);
  if (!pds) return replyEphemeral(interaction, '❌ PDS introuvable.');
  if (pds.status !== 'OPEN') return replyEphemeral(interaction, '⚠️ Cette PDS est terminée.');
  const mission = await AtmMission.findById(pds.atmMissionId);
  if (!(await canManage(interaction, pds, mission))) {
    return replyEphemeral(interaction, "⛔ Seuls l'équipage et les rôles autorisés peuvent modifier cette PDS.");
  }

  switch (action) {
    case 'addatm':
      return interaction.showModal(
        buildModal({
          customId: `pds:atmmodal:${pds._id}`,
          title: `Ajouter un ATM — ${pds.plate}`,
          fields: [
            { id: 'label', label: "Lieu / numéro de l'ATM", placeholder: 'Ex : ATM Legion Square', maxLength: 80 },
            { id: 'note', label: 'Remarque (optionnel)', required: false, paragraph: true, maxLength: 300 },
            { id: 'photos', label: `Photo(s) de l'ATM (${MAX_PHOTOS} max)`, files: { max: MAX_PHOTOS }, required: false },
          ],
        }),
      );

    case 'atmmodal': {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const label = getText(interaction, 'label');
      if (!label) return interaction.editReply("❌ Indique le lieu ou le numéro de l'ATM.");
      const files = getFiles(interaction, 'photos').filter((f) => !f.contentType || f.contentType.startsWith('image/'));
      let photos = [];
      let warning = '';
      if (files.length) {
        try {
          if (cloudinaryEnabled()) {
            for (const file of files) photos.push(await storeImage(file.url, { folder: 'pds', name: file.name }));
          } else {
            photos = await repostPhotos(interaction.client, pds, label, files);
          }
        } catch (err) {
          log.error('Upload des photos impossible :', err);
          warning = '\n⚠️ Les photos n’ont pas pu être enregistrées.';
        }
      }
      await PdsSession.updateOne(
        { _id: pds._id },
        {
          $push: {
            atms: {
              label,
              note: getText(interaction, 'note'),
              photos: photos.map((p) => ({ url: p.url, publicId: p.publicId })),
              addedBy: interaction.user.id,
              at: new Date(),
            },
          },
        },
      );
      const fresh = await PdsSession.findById(pds._id);
      await refreshPdsMessage(interaction.client, fresh, mission);
      return interaction.editReply(`✅ ATM **${label}** ajouté${photos.length ? ` avec ${photos.length} photo(s)` : ''}.${warning}`);
    }

    case 'finish':
      return replyEphemeral(interaction, {
        content: `🛑 Terminer la PDS du véhicule **${pds.plate}** (${pds.atms.length} ATM) ?`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`pds:confirmfinish:${pds._id}`).setLabel('Terminer la PDS').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`pds:abort:${pds._id}`).setLabel('Retour').setStyle(ButtonStyle.Secondary),
          ),
        ],
      });

    case 'confirmfinish': {
      pds.status = 'FINISHED';
      pds.endAt = new Date();
      pds.finishedBy = interaction.user.id;
      if (mission) pds.participants = mission.participants.map((p) => ({ userId: p.userId, roles: [...p.roles] }));
      await pds.save();
      await refreshPdsMessage(interaction.client, pds, mission);
      await audit({
        guildId: pds.guildId,
        actorId: interaction.user.id,
        actorName: interaction.user.username,
        action: 'pds.finish',
        targetType: 'pds',
        targetId: pds._id,
        summary: `PDS ${pds.plate} terminée (${pds.atms.length} ATM)`,
      });
      return updateEphemeral(
        interaction,
        `🛑 PDS **${pds.plate}** terminée. Pense à clôturer la mission ATM avec le bouton « Terminer » si elle est finie.`,
      );
    }

    default:
      return replyEphemeral(interaction, '❓ Action inconnue.');
  }
}
