import { interventionChannels, setInterventions } from '../../storage/interventions.js';
import { targetChannel } from './resolve.js';

export const INTERVENTION_TOOLS = [
  {
    name: 'autoriser_interventions',
    description: "Autorise ou interdit à MAGI d'intervenir de lui-même (sans être appelé) dans un salon. Au plus une intervention par salon toutes les 30 minutes, seulement quand c'est bienvenu.",
    parameters: {
      type: 'object',
      properties: { salon: { type: 'string', description: 'Par défaut, le salon actuel.' }, actif: { type: 'boolean' } },
      required: ['actif'],
    },
    access: 'operator',
    async run({ guild, message, args }) {
      const channel = targetChannel(guild, args.salon, message.channel);
      setInterventions(guild.id, channel.id, Boolean(args.actif));
      const all = interventionChannels(guild.id).map((id) => `<#${id}>`);
      return `Interventions spontanées ${args.actif ? 'autorisées' : 'désactivées'} dans ${channel}. Salons autorisés : ${all.join(', ') || 'aucun'}.`;
    },
  },
];
