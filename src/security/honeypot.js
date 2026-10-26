import { ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { setSetting, setting } from '../storage/settings.js';

const WARNING =
  "Ce salon est un piège à bots. **N'écris rien ici.**\nLes comptes de spam écrivent dans tous les salons à la fois : tout message envoyé ici entraîne un bannissement automatique et la suppression des messages des dernières 24 heures.";

export function honeypotOf(guild) {
  return guild.channels.cache.get(setting(guild.id, 'honeypot')) ?? null;
}

export async function enableHoneypot(guild, reason) {
  const current = honeypotOf(guild);
  if (current) return current;
  const channel = await guild.channels.create({
    name: 'ne-pas-écrire-ici',
    type: ChannelType.GuildText,
    topic: 'Piège à bots : tout message envoyé ici entraîne un bannissement automatique.',
    reason,
    permissionOverwrites: [{ id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }],
  });
  await channel.setPosition(0).catch(() => {});
  await channel.send({ embeds: [new EmbedBuilder().setColor(0xd65c62).setTitle('Ne pas écrire ici').setDescription(WARNING)] });
  setSetting(guild.id, 'honeypot', channel.id);
  return channel;
}

export async function disableHoneypot(guild, reason) {
  const current = honeypotOf(guild);
  setSetting(guild.id, 'honeypot', null);
  await current?.delete(reason).catch(() => {});
}
