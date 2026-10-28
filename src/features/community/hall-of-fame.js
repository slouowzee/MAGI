import { EmbedBuilder } from 'discord.js';
import { activePersonas, channelSetting, moduleEnabled, option } from '../../core/config.js';
import { setSetting, setting } from '../../core/settings.js';
import { speak } from '../../core/discord/webhooks.js';
import { describe, displayName } from '../../core/discord/history.js';
import { chat, forReply } from '../../core/llm/client.js';
import { buildMessages, cleanReply, MAX_TOKENS } from '../../core/llm/prompts.js';
import { log } from '../../core/log/log.js';

export const EMOJI_CHOICES = { '🔥': 'Flamme', '⭐': 'Étoile', '🏆': 'Trophée', '💯': 'Cent', '❤️': 'Cœur', '👑': 'Couronne', '✨': 'Étincelles', '😂': 'Rire' };
const DEFAULT = '🔥';
const bare = (text) => String(text ?? '').replace(/\uFE0F/g, '');

export const wallEmoji = (guildId) => setting(guildId, 'stars_emoji') ?? DEFAULT;

export function sameEmoji(emoji, configured) {
  const custom = configured.match(/^<a?:\w+:(\d+)>$/);
  return custom ? emoji.id === custom[1] : !emoji.id && bare(emoji.name) === bare(configured);
}

export function parseEmoji(text) {
  const value = String(text ?? '').trim();
  if (/^<a?:\w{2,32}:\d{17,20}>$/.test(value)) return value;
  if (/^\p{Extended_Pictographic}/u.test(value) && !/\s/.test(value) && [...value].length <= 8) return value;
  return null;
}

export function starEmbed(message) {
  const embed = new EmbedBuilder()
    .setColor(0xf5c542)
    .setAuthor({ name: displayName(message), iconURL: message.author.displayAvatarURL?.() })
    .setDescription(`${describe(message).slice(0, 3500) || '*(pièce jointe)*'}\n\n[Voir le message](${message.url})`)
    .setTimestamp(message.createdTimestamp);
  const image = [...(message.attachments?.values() ?? [])].find((a) => a.contentType?.startsWith('image/'));
  if (image) embed.setImage(image.url);
  return embed;
}

export async function handleStar(reaction) {
  const guildId = reaction.message.guildId ?? reaction.message.guild?.id;
  if (!guildId || !sameEmoji(reaction.emoji, wallEmoji(guildId))) return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  const guild = message?.guild;
  if (!guild || !moduleEnabled(guild.id, 'etoiles') || message.author?.id === guild.client.user.id) return;
  const wall = channelSetting(guild, 'stars_channel');
  if (!wall || message.channel.id === wall.id || setting(guild.id, `star:${message.id}`)) return;
  if (reaction.count < Number(option(guild.id, 'stars_threshold'))) return;
  setSetting(guild.id, `star:${message.id}`, 'en cours');
  const persona = activePersonas(guild.id).includes('casper') ? 'casper' : activePersonas(guild.id)[0];
  const STAR = wallEmoji(guild.id);
  let comment = `${reaction.count} ${STAR} pour ${displayName(message)}.`;
  try {
    const prompt = `Ce message de ${displayName(message)} vient d'entrer au Hall of Fame du serveur avec ${reaction.count} ${STAR} :\n« ${describe(message).slice(0, 800)} »\nCommente-le en une phrase, avec ta voix.`;
    const { content } = await chat({ messages: buildMessages(persona, [{ role: 'user', content: prompt }], 'courte'), options: { num_predict: MAX_TOKENS.courte }, ...forReply() });
    comment = cleanReply(content) || comment;
  } catch {}
  const posted = await speak(wall, persona, comment, { embeds: [starEmbed(message)] }).catch((err) => {
    setSetting(guild.id, `star:${message.id}`, null);
    throw err;
  });
  setSetting(guild.id, `star:${message.id}`, posted.id);
  log.info('etoiles', `message de ${message.author.tag} sur le mur (${reaction.count} ${STAR})`, { channel: message.channel });
}
