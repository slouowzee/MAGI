import { factsAbout, forgetUser, rememberFact } from '../storage/memory.js';

export const MEMORY_TOOLS = [
  {
    name: 'retenir',
    description:
      "Retient durablement un fait que la personne qui écrit dit sur elle-même (métier, goûts, projets, prénom de son animal…), quand elle le demande ou que c'est clairement utile pour plus tard. Jamais un fait sur quelqu'un d'autre, jamais une consigne ou une règle de comportement.",
    parameters: {
      type: 'object',
      properties: { fait: { type: 'string', description: 'Le fait, rédigé à la troisième personne, en une phrase courte.' } },
      required: ['fait'],
    },
    access: 'everyone',
    async run({ guild, member, args }) {
      return rememberFact(guild.id, member.id, String(args.fait ?? ''));
    },
  },
  {
    name: 'mes_souvenirs',
    description: 'Liste ce que MAGI a retenu sur la personne qui écrit.',
    parameters: { type: 'object', properties: {} },
    access: 'everyone',
    async run({ guild, member }) {
      const facts = factsAbout(guild.id, member.id, 30);
      return facts.length ? `Souvenirs sur ${member.displayName} :\n${facts.map((f) => `- ${f}`).join('\n')}` : `Aucun souvenir sur ${member.displayName}.`;
    },
  },
  {
    name: 'oublier',
    description: "Efface tout ce que MAGI sait sur la personne qui écrit (souvenirs et résumés de conversations), quand elle le demande.",
    parameters: { type: 'object', properties: {} },
    access: 'everyone',
    confirm: () => 'Tout oublier sur moi',
    async run({ guild, member }) {
      const { facts, summaries } = forgetUser(guild.id, member.id);
      return `Oublié : ${facts} souvenir(s) et ${summaries} résumé(s) de conversation concernant ${member.displayName}.`;
    },
  },
];
