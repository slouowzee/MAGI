import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ContainerBuilder, MediaGalleryBuilder, MessageFlags, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder } from 'discord.js';
import { activePersonas, channelSetting, moduleEnabled, option } from '../../core/config.js';
import { setSetting, setting } from '../../core/settings.js';
import { editSpoken, personaOf, speak } from '../../core/discord/webhooks.js';
import { describe, displayName } from '../../core/discord/history.js';
import { chat, forReply } from '../../core/llm/client.js';
import { buildMessages, cleanReply, MAX_TOKENS } from '../../core/llm/prompts.js';
import { log } from '../../core/log/log.js';
import { discordTime } from '../../core/util.js';

export const EMOJI_CHOICES = { '🔥': 'Flamme', '⭐': 'Étoile', '🏆': 'Trophée', '💯': 'Cent', '❤️': 'Cœur', '👑': 'Couronne', '✨': 'Étincelles', '😂': 'Rire' };
const DEFAULT = '🔥';
const bare = (text) => String(text ?? '').replace(/\uFE0F/g, '');
const HEAT = [[25, 0xa32d2d], [15, 0xe24b4a], [10, 0xd85a30], [5, 0xef9f27], [0, 0xfac775]];
export const heat = (count) => HEAT.find(([min]) => count >= min)[1];
const MAX_MEDIA = 4;
const REFRESH_DELAY = 3_000;
const CLAIMED = 'en cours';
const CLAIM_TTL = 5 * 60_000;
const refreshing = new Map();
const text = (content) => new TextDisplayBuilder().setContent(content);
const clip = (value, max) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

export const wallEmoji = (guildId) => setting(guildId, 'stars_emoji') ?? DEFAULT;

export function sameEmoji(emoji, configured) {
  const custom = configured.match(/^<a?:\w+:(\d+)>$/);
  return custom ? emoji.id === custom[1] : !emoji.id && bare(emoji.name) === bare(configured);
}

export function parseEmoji(raw) {
  const value = String(raw ?? '').trim();
  if (/^<a?:\w{2,32}:\d{17,20}>$/.test(value)) return value;
  if (/^\p{Extended_Pictographic}/u.test(value) && !/\s/.test(value) && [...value].length <= 8) return value;
  return null;
}

export function starCard(message, { count, emoji, parent = null }) {
  const media = [
    ...[...(message.attachments?.values() ?? [])].filter((a) => /^(image|video)\//.test(a.contentType ?? '')).map((a) => a.url),
    ...(message.embeds ?? []).map((e) => e.image?.url ?? e.thumbnail?.url).filter(Boolean),
  ].slice(0, MAX_MEDIA);
  const content = media.length && /^https?:\/\/\S+$/.test(message.content.trim()) ? '' : message.content.trim();
  const body = content || (media.length ? '' : describe(message));
  const header = `### ${emoji} ${count} · ${displayName(message)}\n-# <#${message.channel.id}> · ${discordTime(message.createdTimestamp, 'f')}`;
  const avatar = message.member?.displayAvatarURL?.({ size: 128 }) ?? message.author.displayAvatarURL?.({ size: 128 });
  const lines = text([header, parent && `-# ↪ ${displayName(parent)} : ${clip(describe(parent).replace(/\s+/g, ' '), 120)}`, body && clip(body, 3000)].filter(Boolean).join('\n'));
  const card = new ContainerBuilder().setAccentColor(heat(count));
  if (avatar) card.addSectionComponents(new SectionBuilder().addTextDisplayComponents(lines).setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar)));
  else card.addTextDisplayComponents(lines);
  if (media.length) card.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(media.map((url) => (item) => item.setURL(url))));
  return card.addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(message.url).setLabel('Aller au message')));
}

export async function refreshCard(guild, message, postedId) {
  const wall = channelSetting(guild, 'stars_channel');
  const posted = wall && (await wall.messages.fetch(postedId).catch(() => null));
  const comment = posted?.components?.[0];
  const persona = posted && personaOf(posted);
  if (!persona || comment?.type !== ComponentType.TextDisplay) return false;
  const fresh = await message.fetch().catch(() => message);
  const emoji = wallEmoji(guild.id);
  const count = fresh.reactions?.cache.find((r) => sameEmoji(r.emoji, emoji))?.count ?? 0;
  const parent = fresh.reference?.messageId ? await fresh.fetchReference().catch(() => null) : null;
  await editSpoken(wall, persona, posted.id, { components: [text(comment.content), starCard(fresh, { count, emoji, parent })] });
  return true;
}

function scheduleRefresh(guild, message, postedId) {
  clearTimeout(refreshing.get(message.id));
  const timer = setTimeout(() => {
    refreshing.delete(message.id);
    refreshCard(guild, message, postedId).catch((err) => log.err('etoiles', `échec de la mise à jour de la carte : ${err.message}`, { guild }));
  }, REFRESH_DELAY);
  refreshing.set(message.id, timer);
}

export async function handleStar(reaction, { added = true } = {}) {
  const guildId = reaction.message.guildId ?? reaction.message.guild?.id;
  if (!guildId || !sameEmoji(reaction.emoji, wallEmoji(guildId))) return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  const guild = message?.guild;
  if (!guild || !moduleEnabled(guild.id, 'etoiles') || message.author?.id === guild.client.user.id) return;
  const entry = setting(guild.id, `star:${message.id}`);
  const claimed = entry?.startsWith(CLAIMED);
  if (entry && !claimed) return scheduleRefresh(guild, message, entry);
  if (claimed && Date.now() - Number(entry.split(':')[1]) < CLAIM_TTL) return;
  const wall = channelSetting(guild, 'stars_channel');
  if (!added || !wall || message.channel.id === wall.id) return;
  if (reaction.count < (setting(guild.id, 'stars_test') ? 1 : Number(option(guild.id, 'stars_threshold')))) return;
  setSetting(guild.id, `star:${message.id}`, `${CLAIMED}:${Date.now()}`);
  const persona = activePersonas(guild.id).includes('casper') ? 'casper' : activePersonas(guild.id)[0];
  const STAR = wallEmoji(guild.id);
  let comment = `${reaction.count} ${STAR} pour ${displayName(message)}.`;
  try {
    const prompt = `Ce message de ${displayName(message)} vient d'entrer au Hall of Fame du serveur avec ${reaction.count} ${STAR} :\n« ${describe(message).slice(0, 800)} »\nCommente-le en une phrase, avec ta voix.`;
    const { content } = await chat({ messages: buildMessages(persona, [{ role: 'user', content: prompt }], 'courte'), options: { num_predict: MAX_TOKENS.courte }, ...forReply() });
    comment = cleanReply(content) || comment;
  } catch (err) {
    log.info('etoiles', `commentaire de repli : ${err.message}`, { guild });
  }
  const parent = message.reference?.messageId ? await message.fetchReference().catch(() => null) : null;
  const card = starCard(message, { count: reaction.count, emoji: STAR, parent });
  const posted = await speak(wall, persona, undefined, { components: [text(comment), card], flags: MessageFlags.IsComponentsV2 }).catch((err) => {
    setSetting(guild.id, `star:${message.id}`, null);
    throw err;
  });
  setSetting(guild.id, `star:${message.id}`, posted.id);
  log.info('etoiles', `message de ${message.author.tag} sur le mur (${reaction.count} ${STAR})`, { channel: message.channel });
}
