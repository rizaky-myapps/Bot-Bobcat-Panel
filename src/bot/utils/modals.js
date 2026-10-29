import {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  FileUploadBuilder,
} from 'discord.js';
import { truncate } from './messages.js';

/**
 * Construit un modal à partir d'une liste de champs.
 * Champ texte : { id, label, description?, value?, placeholder?, required?, paragraph?, maxLength? }
 * Menu :        { id, label, select: [{ label, value, default? }], required? }
 * Fichiers :    { id, label, files: { max }, required? }
 */
export function buildModal({ customId, title, fields }) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(truncate(title, 45));
  for (const f of fields) {
    const label = new LabelBuilder().setLabel(truncate(f.label, 45));
    if (f.description) label.setDescription(truncate(f.description, 100));
    if (f.select) {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(f.id)
        .setRequired(f.required ?? true)
        .addOptions(f.select.map((o) => ({ label: o.label, value: o.value, default: Boolean(o.default) })));
      label.setStringSelectMenuComponent(menu);
    } else if (f.files) {
      const upload = new FileUploadBuilder()
        .setCustomId(f.id)
        .setRequired(f.required ?? false)
        .setMinValues(f.required ? 1 : 0)
        .setMaxValues(f.files.max || 1);
      label.setFileUploadComponent(upload);
    } else {
      const input = new TextInputBuilder()
        .setCustomId(f.id)
        .setStyle(f.paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(f.required ?? true);
      if (f.value) input.setValue(String(f.value));
      if (f.placeholder) input.setPlaceholder(truncate(f.placeholder, 100));
      if (f.maxLength) input.setMaxLength(f.maxLength);
      label.setTextInputComponent(input);
    }
    modal.addLabelComponents(label);
  }
  return modal;
}

export function getText(interaction, id) {
  try {
    return interaction.fields.getTextInputValue(id)?.trim() || '';
  } catch {
    return '';
  }
}

export function getSelect(interaction, id) {
  try {
    return interaction.fields.getStringSelectValues(id) || [];
  } catch {
    return [];
  }
}

export function getFiles(interaction, id) {
  try {
    return [...(interaction.fields.getUploadedFiles(id)?.values() || [])];
  } catch {
    return [];
  }
}
