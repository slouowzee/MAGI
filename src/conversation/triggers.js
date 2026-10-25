import { personaByName } from '../personas.js';

const NAME = /(?<![\p{L}\p{N}])(magi|melchior|balthasar|casper)(?![\p{L}\p{N}])/giu;
const MENTIONED_ABOUT = /(?:^|[^\p{L}])(?:le|la|les|des|du|de|d'|d’|l'|l’|un|une|ce|cet|cette|ces|au|aux|avec|sur|sans|pour|par|chez|mon|ma|mes|ton|ta|tes|son|sa|ses|notre|nos|votre|vos|leur|leurs)\s*$/iu;
const SEPARATORS = /^[\s,:;!?.-]*/;
const VOTE = /^vote(?![\p{L}\p{N}])[\s,:;!?.-]*/iu;

export function parseName(content) {
  for (const m of content.matchAll(NAME)) {
    const before = content.slice(0, m.index);
    if (MENTIONED_ABOUT.test(before)) continue;
    const name = m[1].toLowerCase();
    const after = content.slice(m.index + m[0].length).replace(SEPARATORS, '');
    const vote = name === 'magi' && VOTE.test(after);
    const text = before.trim() ? content : vote ? after.replace(VOTE, '') : after;
    return { persona: name === 'magi' ? 'auto' : name, vote, text: text.trim() };
  }
  return null;
}

const DETAIL = /\b(?:r[ée]sum\w*|expli(?:que|quer|cation|cations)|d[ée]taill\w*|en d[ée]tail|d[ée]veloppe\w*|approfondi\w*|tuto\w*|[ée]tape par [ée]tape|pas [àa] pas)\b/i;

export function wantsDetail(text) {
  return DETAIL.test(text);
}

export async function detect(message, client) {
  if (!message.inGuild() || message.author.bot || message.webhookId) return null;

  const named = parseName(message.content);
  if (named) return named;

  if (message.mentions.users.has(client.user.id)) {
    const text = message.content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
    return { persona: 'auto', vote: false, text };
  }

  if (message.reference?.messageId) {
    const ref = await message.fetchReference().catch(() => null);
    const persona = ref?.webhookId && personaByName(ref.author.username);
    if (persona) return { persona, vote: false, text: message.content.trim() };
  }

  return null;
}
