import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { db } from '../storage/db.js';

const OPERATOR_ROLE = 'Opérateur MAGI';
const LOG_CHANNEL = 'magi-logs';
const REASON = 'Installation de MAGI';
const silent = { allowedMentions: { parse: [] } };

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
  const me = guild.members.me;
  const created = [];

  let role = operatorRole(guild);
  if (!role) {
    role = await guild.roles.create({ name: OPERATOR_ROLE, permissions: [], mentionable: false, reason: REASON });
    created.push(`rôle ${role}`);
  }

  let channel = logChannel(guild);
  if (!channel) {
    channel = await guild.channels.create({
      name: LOG_CHANNEL,
      type: ChannelType.GuildText,
      reason: REASON,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
        { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] },
      ],
    });
    created.push(`salon ${channel}`);
  }

  saveConfig.run(guild.id, role.id, channel.id);

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
    { step: 'rôle Opérateur MAGI créé', done: Boolean(role), manual: false },
    { step: 'salon #magi-logs créé', done: Boolean(logChannel(guild)), manual: false },
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
    missing.some((s) => !s.manual)
      ? 'Les étapes non manuelles peuvent être faites par l\'outil installer_magi, après accord de la personne.'
      : 'Il ne reste que l\'étape manuelle : outils d\'administration désactivés en attendant.',
  ].join('\n');
}

export async function installAndReport(guild) {
  try {
    const result = await install(guild);
    if (result.created.length || !result.ok) {
      await logChannel(guild)?.send({ content: installReport(result, guild), ...silent });
    }
    console.log(`[${guild.name}] installation : ${result.created.length ? result.created.join(', ') : 'rien à créer'}, admin ${result.ok ? 'activé' : 'désactivé'}`);
    return result;
  } catch (err) {
    console.error(`[${guild.name}] installation impossible :`, err.message);
    return null;
  }
}
