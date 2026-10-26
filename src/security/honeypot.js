import { ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { setSetting, setting } from '../storage/settings.js';

const NAME = '🍯・honeypot';
const OLD_NAMES = ['ne-pas-écrire-ici', '⛔・ne-pas-écrire'];
const TOPIC = '🍯 Piège à bots : tout message envoyé ici entraîne un bannissement automatique.';
const VERSION = '4';

export function warning(guild) {
  return new EmbedBuilder()
    .setColor(0xd65c62)
    .setTitle("N'écrivez rien ici")
    .setDescription('Ce salon est un piège à bots. Tout message posté ici entraîne un bannissement immédiat et la suppression des messages des dernières 24 heures.');
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
