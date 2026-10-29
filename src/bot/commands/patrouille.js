import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { startPatrol } from '../handlers/patrouille-interactions.js';

export function patrolCommandOptions(builder) {
  return builder
    .addStringOption((o) => o.setName('unité').setDescription("Nom de l'unité de patrouille").setRequired(true).setMaxLength(100))
    .addStringOption((o) =>
      o.setName('agents').setDescription('Agents : matricules ou mentions (ex : @Agent1 @Agent2, 1234)').setRequired(true).setMaxLength(1000),
    )
    .addStringOption((o) =>
      o.setName('heure_debut').setDescription('Heure de début si différente de maintenant (21h, 21:30, 2130)').setMaxLength(5),
    );
}

export const data = patrolCommandOptions(
  new SlashCommandBuilder().setName('patrouille').setDescription('Créer une patrouille (interface classique)').setContexts(InteractionContextType.Guild),
);

export async function execute(interaction) {
  return startPatrol(interaction, 'v1');
}
