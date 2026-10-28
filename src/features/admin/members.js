import { targetMember, targetRole } from './resolve.js';

const memberArg = { membre: { type: 'string', description: 'Mention, identifiant ou pseudo.' } };
const reasonArg = { raison: { type: 'string' } };
const why = (reason, args) => (args.raison ? `${reason} : ${args.raison}` : reason);

export const MEMBER_TOOLS = [
  {
    name: 'exclure_temporairement',
    description: 'Exclut temporairement un membre (il ne peut plus écrire ni parler), de 1 minute à 28 jours.',
    parameters: { type: 'object', properties: { ...memberArg, duree_minutes: { type: 'integer' }, ...reasonArg }, required: ['membre', 'duree_minutes'] },
    access: 'operator',
    async run({ guild, args, reason }) {
      const m = await targetMember(guild, args.membre);
      const minutes = Math.min(Math.max(Number(args.duree_minutes) || 10, 1), 28 * 24 * 60);
      await m.timeout(minutes * 60_000, why(reason, args));
      return `${m.displayName} est exclu temporairement pour ${minutes} minute(s).`;
    },
  },
  {
    name: 'lever_exclusion',
    description: "Lève l'exclusion temporaire d'un membre.",
    parameters: { type: 'object', properties: memberArg, required: ['membre'] },
    access: 'operator',
    async run({ guild, args, reason }) {
      const m = await targetMember(guild, args.membre);
      await m.timeout(null, reason);
      return `Exclusion de ${m.displayName} levée.`;
    },
  },
  {
    name: 'expulser',
    description: 'Expulse un membre du serveur (il peut revenir avec une invitation). Demande une confirmation.',
    parameters: { type: 'object', properties: { ...memberArg, ...reasonArg }, required: ['membre'] },
    access: 'operator',
    async confirm({ guild, args }) {
      return `Expulser ${(await targetMember(guild, args.membre)).displayName}`;
    },
    async run({ guild, args, reason }) {
      const m = await targetMember(guild, args.membre);
      await m.kick(why(reason, args));
      return `${m.displayName} a été expulsé.`;
    },
  },
  {
    name: 'bannir',
    description: 'Bannit un membre du serveur, en supprimant éventuellement ses messages des derniers jours (0 à 7). Demande une confirmation.',
    parameters: { type: 'object', properties: { ...memberArg, ...reasonArg, supprimer_messages_jours: { type: 'integer' } }, required: ['membre'] },
    access: 'operator',
    async confirm({ guild, args }) {
      return `Bannir ${(await targetMember(guild, args.membre)).displayName}`;
    },
    async run({ guild, args, reason }) {
      const m = await targetMember(guild, args.membre);
      const days = Math.min(Math.max(Number(args.supprimer_messages_jours) || 0, 0), 7);
      await guild.members.ban(m, { reason: why(reason, args), deleteMessageSeconds: days * 86_400 });
      return `${m.displayName} a été banni${days ? `, messages des ${days} derniers jours supprimés` : ''}.`;
    },
  },
  {
    name: 'debannir',
    description: "Lève le bannissement d'un utilisateur (identifiant ou nom d'utilisateur).",
    parameters: { type: 'object', properties: { utilisateur: { type: 'string' } }, required: ['utilisateur'] },
    access: 'operator',
    async run({ guild, args, reason }) {
      const bans = await guild.bans.fetch();
      const ref = String(args.utilisateur).replace(/^@/, '').toLowerCase();
      const ban = bans.find((b) => b.user.id === ref.match(/\d{17,20}/)?.[0] || b.user.username.toLowerCase() === ref || b.user.globalName?.toLowerCase() === ref);
      if (!ban) return `Aucun bannissement trouvé pour ${args.utilisateur}.`;
      await guild.members.unban(ban.user, reason);
      return `${ban.user.username} n'est plus banni.`;
    },
  },
  {
    name: 'renommer_membre',
    description: "Change le pseudo d'un membre sur le serveur (vide pour revenir à son nom).",
    parameters: { type: 'object', properties: { ...memberArg, pseudo: { type: 'string' } }, required: ['membre', 'pseudo'] },
    access: 'operator',
    async run({ guild, args, reason }) {
      const m = await targetMember(guild, args.membre);
      await m.setNickname(String(args.pseudo).slice(0, 32) || null, reason);
      return `Pseudo de ${m.user.username} : ${args.pseudo || '(par défaut)'}.`;
    },
  },
  {
    name: 'donner_role',
    description: 'Donne un rôle à un membre.',
    parameters: { type: 'object', properties: { ...memberArg, role: { type: 'string' } }, required: ['membre', 'role'] },
    access: 'operator',
    async run({ guild, args, reason }) {
      const m = await targetMember(guild, args.membre);
      const role = targetRole(guild, args.role);
      await m.roles.add(role, reason);
      return `${m.displayName} a maintenant le rôle ${role.name}.`;
    },
  },
  {
    name: 'retirer_role',
    description: 'Retire un rôle à un membre.',
    parameters: { type: 'object', properties: { ...memberArg, role: { type: 'string' } }, required: ['membre', 'role'] },
    access: 'operator',
    async run({ guild, args, reason }) {
      const m = await targetMember(guild, args.membre);
      const role = targetRole(guild, args.role);
      await m.roles.remove(role, reason);
      return `${m.displayName} n'a plus le rôle ${role.name}.`;
    },
  },
];
