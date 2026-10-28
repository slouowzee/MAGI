import { PermissionFlagsBits as P, PermissionsBitField } from 'discord.js';

const DISCUSSION = [P.ViewChannel, P.SendMessages, P.SendMessagesInThreads, P.ReadMessageHistory, P.EmbedLinks, P.AttachFiles, P.AddReactions, P.UseExternalEmojis, P.ManageWebhooks];
const EXTRAS = { discussion: [P.SendPolls, P.CreatePublicThreads, P.CreatePrivateThreads, P.Connect], gestion: [P.ManageEvents, P.CreateEvents, P.MoveMembers], moderation: [], administrateur: [] };
const GESTION = [...DISCUSSION, P.ManageChannels, P.ManageRoles, P.ManageMessages, P.PinMessages, P.ManageThreads];
const MODERATION = [...GESTION, P.ModerateMembers, P.KickMembers, P.BanMembers, P.ViewAuditLog, P.ManageGuild, P.ManageNicknames, P.MentionEveryone];

export const LEVELS = {
  discussion: { label: 'Discussion', perms: DISCUSSION, text: 'discuter, réagir, voix des personas' },
  gestion: { label: 'Gestion', perms: GESTION, text: "installer MAGI, gérer salons, rôles, messages et publications" },
  moderation: { label: 'Modération', perms: MODERATION, text: 'modération automatique, exclusions, bannissements, anti-nuke' },
  administrateur: { label: 'Administrateur', perms: [P.Administrator], text: 'tout, sans restriction (déconseillé)' },
};

export function currentLevel(permissions) {
  if (permissions.has(P.Administrator)) return 'administrateur';
  return ['moderation', 'gestion', 'discussion'].find((level) => permissions.has(LEVELS[level].perms)) ?? null;
}

export function atLeast(permissions, level) {
  const order = Object.keys(LEVELS);
  const current = currentLevel(permissions);
  return current !== null && order.indexOf(current) >= order.indexOf(level);
}

export function inviteUrl(clientId, guildId, level) {
  const order = Object.keys(LEVELS);
  const extras = order.slice(0, order.indexOf(level) + 1).flatMap((l) => EXTRAS[l]);
  const bits = new PermissionsBitField([...LEVELS[level].perms, ...extras]).bitfield;
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot&permissions=${bits}&guild_id=${guildId}&disable_guild_select=true`;
}
