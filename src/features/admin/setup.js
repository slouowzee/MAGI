import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { channelSetting, moduleEnabled } from '../../core/config.js';
import { setSetting } from '../../core/settings.js';
import { interventionChannels } from '../conversation/interventions.js';
import { postTicketPanel } from '../community/tickets.js';
import { createHub } from '../community/voice.js';

const SETUPS = {
  etoiles: { label: 'Hall of Fame', key: 'stars_channel', name: '🏆・hall-of-fame', topic: 'Les messages qui reçoivent assez de réactions entrent ici.' },
  tickets: { label: 'Tickets', key: 'tickets_channel', name: '🎫・support', topic: 'Ouvre un ticket pour parler aux opérateurs en privé.' },
  bienvenue: { label: 'Bienvenue', key: 'welcome_channel', name: '👋・bienvenue', topic: 'Arrivées et départs.', skip: (guild) => guild.systemChannel },
  vocal_temporaire: { label: 'Salons vocaux temporaires', key: 'voice_hub', hub: true },
};

export function setupPlan(guild, only = []) {
  return Object.entries(SETUPS)
    .filter(([module, s]) => moduleEnabled(guild.id, module) && !channelSetting(guild, s.key) && !s.skip?.(guild))
    .filter(([module]) => !only.length || only.includes(module))
    .map(([module, s]) => ({ module, ...s }));
}

async function create(guild, step, parent, reason) {
  if (step.hub) return createHub(guild);
  const channel = await guild.channels.create({
    name: step.name,
    type: ChannelType.GuildText,
    parent: parent ?? undefined,
    topic: step.topic,
    reason,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [P.SendMessages] },
      { id: guild.members.me.id, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ManageWebhooks, P.CreatePrivateThreads, P.ManageThreads] },
    ],
  });
  setSetting(guild.id, step.key, channel.id);
  if (step.module === 'tickets') await postTicketPanel(guild);
  return channel;
}

export const SETUP_TOOLS = [
  {
    name: 'preparer_salons',
    description:
      "Crée les salons qui manquent aux fonctions actives de MAGI et les relie à la configuration : Hall of Fame, salon des tickets avec son panneau, salon de bienvenue (s'il n'y a pas de salon système), salon vocal générateur. Pour « finis de mettre en place les salons », « crée le salon des tickets », etc. Un bouton de confirmation est affiché.",
    parameters: {
      type: 'object',
      properties: { fonctions: { type: 'array', items: { type: 'string', enum: Object.keys(SETUPS) }, description: 'À limiter à ces fonctions, toutes celles qui manquent sinon.' } },
    },
    access: 'operator',
    panel: true,
    confirm({ guild, args }) {
      const plan = setupPlan(guild, args.fonctions ?? []);
      if (!plan.length) throw new Error("rien à créer : chaque fonction active a déjà son salon. Une fonction coupée s'active dans le panneau, page de la fonction");
      return `Créer : ${plan.map((s) => s.label).join(', ')}`.slice(0, 80);
    },
    async run({ guild, message, args, reason }) {
      const done = [];
      for (const step of setupPlan(guild, args.fonctions ?? [])) {
        const channel = await create(guild, step, message.channel.parentId, reason).catch((err) => err);
        done.push(channel instanceof Error ? `${step.label} : échec, ${channel.message}` : `${step.label} : ${channel} créé${step.module === 'tickets' ? ', panneau publié' : ''}`);
      }
      if (moduleEnabled(guild.id, 'interventions') && !interventionChannels(guild.id).length) done.push('Interventions spontanées : choisis les salons dans le panneau, page Conversation');
      return done.join('\n');
    },
  },
];
