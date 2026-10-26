import { EmbedBuilder } from 'discord.js';

export const COLOR = 0xd65c62;
export const SIGNATURE = 'Publié par MAGI';

export function framed(guild, { label, title, text }) {
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor({ name: `${label} · ${guild.name}`.slice(0, 256), iconURL: guild.iconURL?.() ?? undefined })
    .setDescription(text.slice(0, 4000))
    .setFooter({ text: SIGNATURE, iconURL: guild.client?.user?.displayAvatarURL?.() })
    .setTimestamp();
  if (title) embed.setTitle(title.slice(0, 256));
  return embed;
}
