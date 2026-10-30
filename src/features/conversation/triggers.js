import { personaOf } from '../../core/discord/webhooks.js';

const NAME = /(?<![\p{L}\p{N}])(magi|melchior|balthasar|casper)(?![\p{L}\p{N}])/giu;
const MENTIONED_ABOUT = /(?:^|[^\p{L}])(?:le|la|les|des|du|de|d'|d’|l'|l’|un|une|ce|cet|cette|ces|au|aux|avec|sur|sans|pour|par|chez|mon|ma|mes|ton|ta|tes|son|sa|ses|notre|nos|votre|vos|leur|leurs)\s*$/iu;
const SEPARATORS = /^[\s,:;!?.-]*/;
const VOTE = /^vote(?![\p{L}\p{N}])[\s,:;!?.-]*/iu;

export const VOTE_INTENT = /(?<![\p{L}])vot(?:e|es|ez|ons|er)(?![\p{L}])/iu;

export function addressedPersonas(content) {
  const names = [];
  for (const m of content.matchAll(NAME)) {
    const name = m[1].toLowerCase();
    if (name !== 'magi' && !MENTIONED_ABOUT.test(content.slice(0, m.index)) && !names.includes(name)) names.push(name);
  }
  return names;
}

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

const SUMMARY = /(?<![\p{L}])(?:r[ée]sum[ée]s?|r[ée]sumer|r[ée]cap\p{L}*)(?![\p{L}])/iu;
const ABOUT_CHAT = /discussion|conv|salon|ici|hier|aujourd'hui|ce matin|cette nuit|messages?|ce qu[i']|rat[ée]/iu;
const MISSED = /ce que j'?ai rat[ée]|ce qu[i']\s*(?:s'est|on a|vous avez|ils ont) (?:dit|pass[ée]|racont[ée])/iu;

export function wantsSummary(text) {
  const clean = (text ?? '').replace(/[’‘]/g, "'");
  return MISSED.test(clean) || (SUMMARY.test(clean) && ABOUT_CHAT.test(clean));
}

const NOT_FOR_ME = new RegExp(
  [
    "\\b(?:c'?est|c'?[ée]tait|ce n'est|ce n'[ée]tait)\\s+pas\\s+(?:à|a|pour)\\s+toi\\b",
    "\\bpas\\s+(?:à|a)\\s+toi\\s+que\\b",
    "\\bje\\s+(?:ne\\s+)?(?:te\\s+)?parl(?:e|ais)\\s+pas\\s+(?:à|a)\\s+toi\\b",
    "\\bje\\s+(?:ne\\s+)?te\\s+parl(?:e|ais)\\s+pas\\b",
    "\\bje\\s+parl(?:e|ais)\\s+(?:à|a|avec)\\s+(?!toi\\b|magi\\b|melchior\\b|balthasar\\b|casper\\b)[\\p{L}@<]",
    "\\bon\\s+(?:ne\\s+)?te\\s+parl(?:e|ait)\\s+pas\\b",
    "\\bpersonne\\s+(?:ne\\s+)?te\\s+parl(?:e|ait)\\b",
    "\\bon\\s+t'?a\\s+rien\\s+demand[ée](?![\\p{L}])",
  ].join('|'),
  'iu',
);

export function notForMagi(text) {
  return NOT_FOR_ME.test((text ?? '').replace(/[’‘]/g, "'"));
}

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
    const persona = ref && personaOf(ref);
    if (persona) return { persona, vote: false, text: message.content.trim() };
  }

  return null;
}
