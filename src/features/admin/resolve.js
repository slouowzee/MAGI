import { PermissionFlagsBits } from 'discord.js';
import { operatorRole } from '../../core/installation.js';

export const PERMISSIONS = {
  voir_salon: PermissionFlagsBits.ViewChannel,
  envoyer_messages: PermissionFlagsBits.SendMessages,
  envoyer_dans_fils: PermissionFlagsBits.SendMessagesInThreads,
  lire_historique: PermissionFlagsBits.ReadMessageHistory,
  ajouter_reactions: PermissionFlagsBits.AddReactions,
  joindre_fichiers: PermissionFlagsBits.AttachFiles,
  integrer_liens: PermissionFlagsBits.EmbedLinks,
  se_connecter_vocal: PermissionFlagsBits.Connect,
  parler_vocal: PermissionFlagsBits.Speak,
  gerer_messages: PermissionFlagsBits.ManageMessages,
  gerer_fils: PermissionFlagsBits.ManageThreads,
  exclure_temporairement: PermissionFlagsBits.ModerateMembers,
  expulser: PermissionFlagsBits.KickMembers,
  bannir: PermissionFlagsBits.BanMembers,
  gerer_pseudos: PermissionFlagsBits.ManageNicknames,
  rendre_muet_vocal: PermissionFlagsBits.MuteMembers,
  deplacer_vocal: PermissionFlagsBits.MoveMembers,
};

export const PERMISSION_NAMES = Object.keys(PERMISSIONS);

export function permissionBits(names = []) {
  const unknown = names.filter((n) => !PERMISSIONS[n]);
  if (unknown.length) throw new Error(`permission non autorisée : ${unknown.join(', ')}. Permissions possibles : ${PERMISSION_NAMES.join(', ')}.`);
  return names.map((n) => PERMISSIONS[n]);
}

const idOf = (ref) => String(ref ?? '').match(/\d{17,20}/)?.[0] ?? null;
const clean = (ref) => String(ref ?? '').replace(/^[@#]/, '').trim().toLowerCase();

export async function findMember(guild, ref) {
  const id = idOf(ref);
  if (id) return guild.members.fetch(id).catch(() => null);
  const query = clean(ref);
  if (!query) return null;
  const found = await guild.members.search({ query, limit: 10 }).catch(() => null);
  if (!found?.size) return null;
  return found.find((m) => [m.displayName, m.user.username, m.user.globalName].some((n) => n?.toLowerCase() === query)) ?? found.first();
}

export function findRole(guild, ref) {
  const id = idOf(ref);
  if (id) return guild.roles.cache.get(id) ?? null;
  const name = clean(ref);
  return guild.roles.cache.find((r) => r.name.toLowerCase() === name) ?? null;
}

export function findChannel(guild, ref, fallback = null) {
  if (ref === undefined || ref === null || ref === '') return fallback;
  const id = idOf(ref);
  if (id) return guild.channels.cache.get(id) ?? null;
  const name = clean(ref);
  return guild.channels.cache.find((c) => c.name.toLowerCase() === name) ?? null;
}

export async function targetMember(guild, ref) {
  const member = await findMember(guild, ref);
  if (!member) throw new Error(`membre introuvable : ${ref}`);
  if (member.id === guild.ownerId) throw new Error('impossible d’agir sur le propriétaire du serveur');
  if (member.user.bot) throw new Error('impossible d’agir sur un bot');
  const operator = operatorRole(guild);
  if (operator && member.roles.cache.has(operator.id)) throw new Error('impossible d’agir sur un Opérateur MAGI');
  if (member.roles.highest.position >= guild.members.me.roles.highest.position) throw new Error(`le rôle le plus haut de ${member.displayName} est au-dessus de celui de MAGI`);
  return member;
}

export function targetRole(guild, ref) {
  const role = findRole(guild, ref);
  if (!role) throw new Error(`rôle introuvable : ${ref}`);
  if (role.id === guild.id) throw new Error('impossible de modifier @everyone');
  if (role.managed) throw new Error(`${role.name} est géré par une intégration`);
  if (role.id === operatorRole(guild)?.id) throw new Error('le rôle Opérateur MAGI ne peut être modifié que par le propriétaire, à la main');
  if (role.position >= guild.members.me.roles.highest.position) throw new Error(`${role.name} est au-dessus du rôle de MAGI`);
  return role;
}

export function targetChannel(guild, ref, fallback = null) {
  const channel = findChannel(guild, ref, fallback);
  if (!channel) throw new Error(`salon introuvable : ${ref}`);
  return channel;
}
