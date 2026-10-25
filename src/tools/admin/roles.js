import { PERMISSION_NAMES, permissionBits, targetRole } from './resolve.js';

const permList = { type: 'array', items: { type: 'string', enum: PERMISSION_NAMES } };
const roleArg = { role: { type: 'string', description: 'Mention, identifiant ou nom.' } };

function color(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const hex = String(value).trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) throw new Error(`couleur invalide : ${value} (format attendu : #RRGGBB)`);
  return `#${hex}`;
}

export const ROLE_TOOLS = [
  {
    name: 'creer_role',
    description: 'Crée un rôle, avec une couleur et des permissions parmi la liste autorisée. Pour plusieurs rôles, un appel par rôle.',
    parameters: { type: 'object', properties: { nom: { type: 'string' }, couleur: { type: 'string', description: '#RRGGBB' }, permissions: permList, mentionnable: { type: 'boolean' } }, required: ['nom'] },
    access: 'operator',
    async run({ guild, args, reason }) {
      const hex = color(args.couleur);
      const role = await guild.roles.create({ name: String(args.nom), colors: hex ? { primaryColor: hex } : undefined, permissions: permissionBits(args.permissions ?? []), mentionable: Boolean(args.mentionnable), reason });
      return `Rôle ${role.name} créé.`;
    },
  },
  {
    name: 'modifier_role',
    description: "Modifie le nom, la couleur ou les permissions d'un rôle (les permissions données remplacent les anciennes).",
    parameters: { type: 'object', properties: { ...roleArg, nom: { type: 'string' }, couleur: { type: 'string' }, permissions: permList }, required: ['role'] },
    access: 'operator',
    async run({ guild, args, reason }) {
      const role = targetRole(guild, args.role);
      const edit = { reason };
      if (args.nom) edit.name = String(args.nom);
      if (args.couleur) edit.colors = { primaryColor: color(args.couleur) };
      if (args.permissions) edit.permissions = permissionBits(args.permissions);
      await role.edit(edit);
      return `Rôle ${role.name} modifié.`;
    },
  },
  {
    name: 'deplacer_role',
    description: "Place un rôle juste au-dessus d'un autre dans la hiérarchie (toujours sous le rôle de MAGI).",
    parameters: { type: 'object', properties: { ...roleArg, au_dessus_de: { type: 'string' } }, required: ['role', 'au_dessus_de'] },
    access: 'operator',
    async run({ guild, args, reason }) {
      const role = targetRole(guild, args.role);
      const below = /everyone/i.test(String(args.au_dessus_de)) ? guild.roles.everyone : targetRole(guild, args.au_dessus_de);
      const position = below.position + (role.position > below.position ? 1 : 0);
      if (position >= guild.members.me.roles.highest.position) throw new Error('cette position est au-dessus du rôle de MAGI');
      await role.setPosition(position, { reason });
      return `${role.name} placé au-dessus de ${below.name}.`;
    },
  },
  {
    name: 'supprimer_role',
    description: 'Supprime définitivement un rôle. Demande une confirmation.',
    parameters: { type: 'object', properties: roleArg, required: ['role'] },
    access: 'operator',
    async confirm({ guild, args }) {
      return `Supprimer le rôle ${targetRole(guild, args.role).name}`;
    },
    async run({ guild, args, reason }) {
      const role = targetRole(guild, args.role);
      await role.delete(reason);
      return `Rôle ${role.name} supprimé.`;
    },
  },
];
