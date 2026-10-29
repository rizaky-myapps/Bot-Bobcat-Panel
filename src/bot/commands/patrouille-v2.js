import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { startPatrol } from '../handlers/patrouille-interactions.js';
import { patrolCommandOptions } from './patrouille.js';

export const data = patrolCommandOptions(
  new SlashCommandBuilder().setName('patrouille-v2').setDescription('Créer une patrouille (interface moderne)').setContexts(InteractionContextType.Guild),
);

export async function execute(interaction) {
  return startPatrol(interaction, 'v2');
}
