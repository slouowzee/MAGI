import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { magiChannelIds, operatorRole } from '../../core/installation.js';
import { findMember, findRole, PERMISSION_NAMES, permissionBits, targetChannel } from './resolve.js';

const channelArg = { salon: { type: 'string', description: 'Mention, identifiant ou nom. Par défaut, le salon actuel.' } };
const permList = { type: 'array', items: { type: 'string', enum: PERMISSION_NAMES } };
const TYPES = { texte: ChannelType.GuildText, vocal: ChannelType.GuildVoice, categorie: ChannelType.GuildCategory };

function category(guild, ref) {
  if (!ref) return null;
  const cat = targetChannel(guild, ref);
  if (cat.type !== ChannelType.GuildCategory) throw new Error(`${cat.name} n'est pas une catégorie`);
  return cat;
}

function renamable(guild, member, channel) {
  if (magiChannelIds(guild).includes(channel.id) && member.id !== guild.ownerId) throw new Error(`#${channel.name} appartient à MAGI : seul le propriétaire du serveur peut le renommer`);
  return channel;
}

function notLogs(guild, channel) {
  if (magiChannelIds(guild).includes(channel.id)) throw new Error(`#${channel.name} appartient à MAGI et ne peut pas être modifié par un outil`);
  return channel;
}

async function recentMessages(message, args) {
  const count = Math.min(Math.max(Number(args.nombre) || 10, 1), 100);
  const target = args.membre ? await findMember(message.guild, args.membre) : null;
  if (args.membre && !target) throw new Error(`membre introuvable : ${args.membre}`);
  const fetched = await message.channel.messages.fetch({ limit: 100, before: message.id });
  return [...fetched.values()].filter((m) => !target || m.author.id === target.id).slice(0, count);
}

export const CHANNEL_ADMIN_TOOLS = [
  {
    name: 'supprimer_messages',
    description: "Supprime les derniers messages du salon actuel (1 à 100), éventuellement seulement ceux d'un membre. Discord ne permet pas de supprimer en masse des messages de plus de 14 jours. Demande une confirmation.",
    parameters: { type: 'object', properties: { nombre: { type: 'integer' }, membre: { type: 'string' } }, required: ['nombre'] },
    access: 'operator',
    cleanup: true,
    async confirm({ message, args }) {
      const n = (await recentMessages(message, args)).length;
      if (!n) throw new Error('aucun message à supprimer');
      return `Supprimer ${n} message(s)`;
    },
    async run({ message, args }) {
      const deleted = await message.channel.bulkDelete(await recentMessages(message, args), true);
      return `${deleted.size} message(s) supprimé(s).`;
    },
  },
  {
    name: 'epingler',
    description: 'Épingle le message auquel la personne répond (reply).',
    parameters: { type: 'object', properties: {} },
    access: 'operator',
    async run({ message }) {
      if (!message.reference?.messageId) return "Il faut répondre (reply) au message à épingler.";
      await (await message.fetchReference()).pin();
      return 'Message épinglé.';
    },
  },
  {
    name: 'mode_lent',
    description: "Règle le mode lent d'un salon (délai entre deux messages d'un même membre, 0 pour le désactiver, 6 heures au maximum).",
    parameters: { type: 'object', properties: { ...channelArg, secondes: { type: 'integer' } }, required: ['secondes'] },
    access: 'operator',
    async run({ guild, message, args, reason }) {
      const channel = targetChannel(guild, args.salon, message.channel);
      const seconds = Math.min(Math.max(Number(args.secondes) || 0, 0), 21_600);
      await channel.setRateLimitPerUser(seconds, reason);
      return seconds ? `Mode lent de ${seconds} s sur #${channel.name}.` : `Mode lent désactivé sur #${channel.name}.`;
    },
  },
  {
    name: 'creer_salon',
    description: 'Crée un salon texte, un salon vocal ou une catégorie, éventuellement privé (visible seulement des Opérateurs MAGI, à ouvrir ensuite avec permissions_salon). Pour plusieurs salons, un appel par salon.',
    parameters: {
      type: 'object',
      properties: { nom: { type: 'string' }, type: { type: 'string', enum: Object.keys(TYPES) }, categorie: { type: 'string' }, prive: { type: 'boolean' } },
      required: ['nom'],
    },
    access: 'operator',
    async run({ guild, args, reason }) {
      const type = TYPES[args.type] ?? ChannelType.GuildText;
      const overwrites = args.prive
        ? [
            { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel] },
            ...(operatorRole(guild) ? [{ id: operatorRole(guild).id, allow: [PermissionFlagsBits.ViewChannel] }] : []),
          ]
        : undefined;
      const channel = await guild.channels.create({ name: String(args.nom), type, parent: type === ChannelType.GuildCategory ? null : category(guild, args.categorie), permissionOverwrites: overwrites, reason });
      return `Créé : ${channel}${args.prive ? ' (privé)' : ''}.`;
    },
  },
  {
    name: 'renommer_salon',
    description:
      "Renomme un salon ou une catégorie. Salons texte : minuscules, chiffres, tirets, emojis et « ・ » ; Discord retire les points, espaces et majuscules. Pour aligner un salon sur le style du serveur, reprends le motif des autres noms vus avec liste_salons (par exemple « 📜・reglement »).",
    parameters: { type: 'object', properties: { ...channelArg, nom: { type: 'string' } }, required: ['nom'] },
    access: 'operator',
    async run({ guild, member, message, args, reason }) {
      const channel = renamable(guild, member, targetChannel(guild, args.salon, message.channel));
      const old = channel.name;
      const wanted = String(args.nom);
      await channel.setName(wanted, reason);
      if (channel.name === old) return `Nom inchangé : Discord a transformé « ${wanted} » en « ${channel.name} », identique à l'ancien. Choisis un autre nom.`;
      return `#${old} renommé en #${channel.name}${channel.name === wanted ? '' : ` (Discord a transformé « ${wanted} »)`}.`;
    },
  },
  {
    name: 'deplacer_salon',
    description: 'Déplace un salon dans une catégorie.',
    parameters: { type: 'object', properties: { ...channelArg, categorie: { type: 'string' } }, required: ['categorie'] },
    access: 'operator',
    async run({ guild, message, args, reason }) {
      const channel = notLogs(guild, targetChannel(guild, args.salon, message.channel));
      const cat = category(guild, args.categorie);
      await channel.setParent(cat, { lockPermissions: false, reason });
      return `${channel} déplacé dans ${cat.name}.`;
    },
  },
  {
    name: 'archiver_salon',
    description: "Archive un salon : il passe dans la catégorie Archives (créée si besoin) et plus personne ne peut y écrire.",
    parameters: { type: 'object', properties: channelArg },
    access: 'operator',
    async run({ guild, message, args, reason }) {
      const channel = notLogs(guild, targetChannel(guild, args.salon, message.channel));
      const archives =
        guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === 'archives') ??
        (await guild.channels.create({ name: 'Archives', type: ChannelType.GuildCategory, reason }));
      await channel.setParent(archives, { lockPermissions: false, reason });
      await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false, SendMessagesInThreads: false, CreatePublicThreads: false, AddReactions: false }, { reason });
      return `${channel} archivé.`;
    },
  },
  {
    name: 'supprimer_salon',
    description: 'Supprime définitivement un salon ou une catégorie vide. Demande une confirmation.',
    parameters: { type: 'object', properties: { salon: { type: 'string' } }, required: ['salon'] },
    access: 'operator',
    async confirm({ guild, args }) {
      return `Supprimer #${notLogs(guild, targetChannel(guild, args.salon)).name}`;
    },
    async run({ guild, args, reason }) {
      const channel = notLogs(guild, targetChannel(guild, args.salon));
      await channel.delete(reason);
      return `#${channel.name} supprimé.`;
    },
  },
  {
    name: 'permissions_salon',
    description: "Règle les permissions d'un rôle (ou de @everyone, ou d'un membre) sur un salon : permissions autorisées, refusées, ou remises par défaut.",
    parameters: {
      type: 'object',
      properties: { ...channelArg, cible: { type: 'string', description: 'Rôle, @everyone ou membre.' }, autoriser: permList, refuser: permList, par_defaut: permList },
      required: ['cible'],
    },
    access: 'operator',
    async run({ guild, message, args, reason }) {
      const channel = notLogs(guild, targetChannel(guild, args.salon, message.channel));
      const ref = String(args.cible);
      const target = /everyone/i.test(ref) ? guild.roles.everyone : findRole(guild, ref) ?? (await findMember(guild, ref));
      if (!target) throw new Error(`cible introuvable : ${ref}`);
      const edit = {};
      for (const [list, value] of [[args.autoriser, true], [args.refuser, false], [args.par_defaut, null]]) {
        permissionBits(list ?? []);
        for (const name of list ?? []) edit[flagName(name)] = value;
      }
      if (!Object.keys(edit).length) return 'Aucune permission à modifier.';
      await channel.permissionOverwrites.edit(target, edit, { reason });
      return `Permissions de ${target.name ?? target.displayName} sur ${channel} mises à jour.`;
    },
  },
];

function flagName(name) {
  const bit = permissionBits([name])[0];
  return Object.keys(PermissionFlagsBits).find((k) => PermissionFlagsBits[k] === bit);
}
