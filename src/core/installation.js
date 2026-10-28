import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { db } from './db.js';
import { log } from './log/log.js';
import { setSetting, setting } from './settings.js';
import { atLeast } from './permissions.js';

const OPERATOR_ROLE = 'Opérateur MAGI';
const CATEGORY = 'MAGI';
const LOG_CHANNELS = { logs: 'magi-logs', moderation: 'magi-modération', securite: 'magi-sécurité', systeme: 'magi-système' };
const REASON = 'Installation de MAGI';

const getConfig = db.query('SELECT operator_role_id, log_channel_id FROM guilds WHERE guild_id = ?');
const saveConfig = db.query(`INSERT INTO guilds (guild_id, operator_role_id, log_channel_id) VALUES (?1, ?2, ?3)
  ON CONFLICT(guild_id) DO UPDATE SET operator_role_id = ?2, log_channel_id = ?3`);

export function operatorRole(guild) {
  const id = getConfig.get(guild.id)?.operator_role_id;
  return id ? guild.roles.cache.get(id) ?? null : null;
}

export function logChannel(guild) {
  const id = getConfig.get(guild.id)?.log_channel_id;
  return id ? guild.channels.cache.get(id) ?? null : null;
}

const channelSetting = (guild, key) => guild.channels.cache.get(setting(guild.id, key)) ?? null;

export function magiCategory(guild) {
  return channelSetting(guild, 'category');
}

export function logChannels(guild) {
  return {
    logs: logChannel(guild),
    moderation: channelSetting(guild, 'log_channel:moderation'),
    securite: channelSetting(guild, 'log_channel:securite'),
    systeme: channelSetting(guild, 'log_channel:systeme'),
  };
}

export function magiChannelIds(guild) {
  return [magiCategory(guild), ...Object.values(logChannels(guild)), channelSetting(guild, 'config_channel')].filter(Boolean).map((c) => c.id);
}

export function isOperator(member) {
  if (member.id === member.guild.ownerId) return true;
  const role = operatorRole(member.guild);
  return Boolean(role && member.roles.cache.has(role.id));
}

export function adminEnabled(guild) {
  const role = operatorRole(guild);
  return Boolean(role && role.position > guild.members.me.roles.highest.position);
}

export async function install(guild) {
  if (!atLeast(guild.members.me.permissions, 'gestion')) throw new Error("MAGI n'a pas encore le niveau de permissions Gestion");
  const me = guild.members.me;
  const created = [];

  let role = operatorRole(guild);
  if (!role) {
    role = await guild.roles.create({ name: OPERATOR_ROLE, permissions: [], mentionable: false, reason: REASON });
    created.push(`rôle ${role}`);
  }

  const permissionOverwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
    { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] },
  ];
  let category = magiCategory(guild);
  if (!category) {
    category = await guild.channels.create({ name: CATEGORY, type: ChannelType.GuildCategory, reason: REASON, permissionOverwrites });
    setSetting(guild.id, 'category', category.id);
    created.push(`catégorie ${category.name}`);
  }

  const existing = logChannels(guild);
  for (const [source, name] of Object.entries(LOG_CHANNELS)) {
    let channel = existing[source];
    if (!channel) {
      channel = await guild.channels.create({ name, type: ChannelType.GuildText, parent: category.id, reason: REASON, permissionOverwrites });
      created.push(`salon ${channel}`);
    } else if (channel.parentId !== category.id) {
      await channel.setParent(category.id, { lockPermissions: false, reason: REASON });
    }
    if (source === 'logs') saveConfig.run(guild.id, role.id, channel.id);
    else setSetting(guild.id, `log_channel:${source}`, channel.id);
  }
  const channel = logChannel(guild);

  const owner = await guild.fetchOwner();
  if (!owner.roles.cache.has(role.id) && role.position < me.roles.highest.position) {
    await owner.roles.add(role, REASON);
    created.push(`rôle attribué à ${owner}`);
  }

  return { created, role, channel, ok: adminEnabled(guild) };
}

export function installReport({ created, role, ok }, guild) {
  const lines = [created.length ? `**Installation de MAGI** : ${created.join(', ')}.` : '**MAGI** est déjà installé.'];
  if (ok) {
    lines.push('Hiérarchie correcte : outils d\'administration **activés**.');
    lines.push('Réglages de MAGI : salon #magi-config.');
  } else {
    lines.push(
      `Dernière étape, à faire à la main : **Paramètres du serveur → Rôles**, glisser ${role} au-dessus du rôle ${guild.members.me.roles.highest}.`,
      'Tant que ce n\'est pas fait, les outils d\'administration restent **désactivés**.',
    );
  }
  return lines.join('\n');
}

export async function installStatus(guild) {
  const role = operatorRole(guild);
  const owner = await guild.fetchOwner();
  return [
    { step: 'accorder à MAGI le niveau de permissions Gestion (gérer les rôles et les salons)', done: atLeast(guild.members.me.permissions, 'gestion'), manual: true, permissions: true },
    { step: 'rôle Opérateur MAGI créé', done: Boolean(role), manual: false },
    { step: 'catégorie MAGI et salons de logs créés', done: Boolean(magiCategory(guild)) && Object.values(logChannels(guild)).every(Boolean), manual: false },
    { step: 'rôle Opérateur MAGI attribué au propriétaire', done: Boolean(role && owner.roles.cache.has(role.id)), manual: false },
    { step: 'glisser le rôle Opérateur MAGI au-dessus du rôle du bot MAGI, dans Paramètres du serveur → Rôles', done: adminEnabled(guild), manual: true },
  ];
}

export function statusReport(steps) {
  const missing = steps.filter((s) => !s.done);
  if (!missing.length) return 'Installation complète. Outils d\'administration activés.';
  return [
    'État de l\'installation :',
    ...steps.map((s) => `- ${s.done ? 'fait' : 'manquant'} : ${s.step}${!s.done && s.manual ? ' (à faire à la main)' : ''}`),
    missing.some((s) => s.permissions)
      ? 'Il faut d\'abord accorder ce niveau : un bouton-lien sera affiché sous ta réponse, la personne n\'a qu\'à cliquer et valider. L\'installation se termine ensuite toute seule.'
      : missing.some((s) => !s.manual)
      ? 'Les étapes non manuelles peuvent être faites par l\'outil installer_magi, après accord de la personne.'
      : 'Il ne reste que l\'étape manuelle : outils d\'administration désactivés en attendant.',
  ].join('\n');
}

export async function installAndReport(guild) {
  if (!atLeast(guild.members.me.permissions, 'gestion')) {
    log.info('installation', 'en attente du niveau Gestion', { guild });
    return null;
  }
  try {
    const result = await install(guild);
    const admin = result.ok ? 'administration activée' : `administration désactivée : placer ${result.role} au-dessus de ${guild.members.me.roles.highest} (Paramètres → Rôles)`;
    if (result.created.length || !result.ok) log.notice('installation', `${result.created.length ? `créé : ${result.created.join(', ')}` : 'à jour'}, ${admin}`, { guild });
    else log.info('installation', `à jour, ${admin}`, { guild });
    return result;
  } catch (err) {
    log.err('installation', `échec : ${err.message}`, { guild });
    return null;
  }
}
