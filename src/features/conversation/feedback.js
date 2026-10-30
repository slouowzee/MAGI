import { setting } from '../../core/settings.js';
import { isOperator } from '../../core/installation.js';
import { PERSONAS } from '../../core/personas.js';
import { personaOf, REPLY_HEADER } from '../../core/discord/webhooks.js';
import { displayName } from '../../core/discord/history.js';
import { log } from '../../core/log/log.js';
import { sameEmoji } from '../community/hall-of-fame.js';
import { learn, unlearn } from './examples.js';

export const GOOD_CHOICES = { '👍': 'Pouce levé', '⭐': 'Étoile', '💯': 'Cent', '🧠': 'Cerveau', '✅': 'Validé' };
export const BAD_CHOICES = { '👎': 'Pouce baissé', '❌': 'Croix', '🗑️': 'Corbeille', '🚫': 'Interdit' };
const LINK = /\]\(https:\/\/discord\.com\/channels\/\d+\/(\d+)\/(\d+)\)/;

export const goodEmoji = (guildId) => setting(guildId, 'examples_good') ?? '👍';
export const badEmoji = (guildId) => setting(guildId, 'examples_bad') ?? '👎';

async function sourceOf(message) {
  const [, channelId, messageId] = message.content.match(LINK) ?? [];
  const channel = channelId && message.guild.channels.cache.get(channelId);
  return channel ? channel.messages.fetch(messageId).catch(() => null) : null;
}

export async function handleExampleReaction(reaction, user) {
  const guildId = reaction.message.guildId ?? reaction.message.guild?.id;
  if (!guildId || user.bot) return null;
  const good = sameEmoji(reaction.emoji, goodEmoji(guildId));
  if (!good && !sameEmoji(reaction.emoji, badEmoji(guildId))) return null;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  const persona = message && personaOf(message);
  if (!persona) return null;
  const member = await message.guild.members.fetch(user.id).catch(() => null);
  if (!member || !isOperator(member)) return null;
  const output = message.content.replace(REPLY_HEADER, '').trim();
  if (!output) return null;
  const { guild } = message;
  if (!good) {
    if (!unlearn(guildId, output)) return null;
    log.notice('exemples', `${member} a retiré une réponse de ${PERSONAS[persona].name} de la banque d'exemples`, { guild });
    return 'retiree';
  }
  const source = await sourceOf(message);
  if (!source?.content?.trim()) return null;
  if (!learn(guildId, { persona, input: `${displayName(source)} : ${source.content.trim()}`, output, by: user.id })) return null;
  log.notice('exemples', `${member} a ajouté une réponse de ${PERSONAS[persona].name} à la banque d'exemples : « ${output.slice(0, 80)} »`, { guild });
  return 'ajoutee';
}
