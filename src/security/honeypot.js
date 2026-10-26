import { ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { setSetting, setting } from '../storage/settings.js';

const NAME = '🍯・honeypot';
const OLD_NAMES = ['ne-pas-écrire-ici', '⛔・ne-pas-écrire'];
const TOPIC = '🍯 Piège à bots : tout message envoyé ici entraîne un bannissement automatique.';
const VERSION = '3';

export function warning(guild) {
  return new EmbedBuilder()
    .setColor(0xd65c62)
    .setAuthor({ name: 'Protection de MAGI', iconURL: guild.client.user.displayAvatarURL() })
    .setTitle('🍯 Honeypot')
    .setDescription(
      [
        "🚫 **N'écris rien dans ce salon.**",
        '',
        '🤖 Il sert à repérer les comptes automatiques, qui publient dans tous les salons à la fois.',
        '',
        '⚠️ Un message envoyé ici entraîne :',
        "🔨 le bannissement immédiat de l'auteur ;",
        '🧹 la suppression de ses messages des dernières 24 heures, sur tout le serveur.',
      ].join('\n'),
    )
    .setFooter({ text: '👋 Rien à faire de ton côté : passe simplement ton chemin.' });
}

export function honeypotOf(guild) {
  return guild.channels.cache.get(setting(guild.id, 'honeypot')) ?? null;
}

export async function enableHoneypot(guild, reason) {
  const current = honeypotOf(guild);
  if (current) return current;
  const channel = await guild.channels.create({
    name: NAME,
    type: ChannelType.GuildText,
    topic: TOPIC,
    reason,
    permissionOverwrites: [{ id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }],
  });
  await channel.setPosition(0).catch(() => {});
  await channel.send({ embeds: [warning(guild)] });
  setSetting(guild.id, 'honeypot', channel.id);
  setSetting(guild.id, 'honeypot_version', VERSION);
  return channel;
}

export async function refreshHoneypot(guild) {
  const channel = honeypotOf(guild);
  if (!channel) return;
  if (OLD_NAMES.includes(channel.name)) await channel.edit({ name: NAME, topic: TOPIC, reason: 'MAGI : nouveau nom du salon piège' });
  if (setting(guild.id, 'honeypot_version') === VERSION) return;
  const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  for (const message of recent?.values() ?? []) if (message.author.id === guild.client.user.id) await message.delete().catch(() => {});
  await channel.send({ embeds: [warning(guild)] });
  setSetting(guild.id, 'honeypot_version', VERSION);
}

export async function disableHoneypot(guild, reason) {
  const current = honeypotOf(guild);
  setSetting(guild.id, 'honeypot', null);
  setSetting(guild.id, 'honeypot_version', null);
  await current?.delete(reason).catch(() => {});
}
