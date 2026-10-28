import { PERSONAS } from '../../core/personas.js';
import { speak } from '../../core/discord/webhooks.js';
import { chat, forReply } from '../../core/llm/client.js';
import { buildMessages, cleanReply, MAX_TOKENS } from '../../core/llm/prompts.js';
import { runVote } from './vote.js';
import { announce } from '../presence/presence.js';
import { log } from '../../core/log/log.js';

const DEBATE = /(?<![\p{L}])d[ée]bat(?:s|tez|tre|tons|ez)?(?![\p{L}])/iu;
const ROUNDS = 2;

export const wantsDebate = (text) => DEBATE.test(text ?? '');

export function debatePrompt(topic, persona, round, said) {
  const names = [...new Set(said.map((s) => PERSONAS[s.persona].name))];
  if (round === 1) {
    const before = said.length ? `\nDéjà dit :\n${said.map((s) => `${PERSONAS[s.persona].name} : ${s.text}`).join('\n')}` : '';
    return `Débat MAGI sur : « ${topic} ».${before}\nDonne ta position en une ou deux phrases, avec ta voix.`;
  }
  const others = said.filter((s) => s.persona !== persona).map((s) => `${PERSONAS[s.persona].name} : ${s.text}`);
  return `Débat MAGI sur : « ${topic} ». Ce que les autres unités ont dit :\n${others.join('\n')}\nRéponds-leur en une phrase : appuie, nuance ou contredis ${names.filter((n) => n !== PERSONAS[persona].name).join(' ou ')}, sans répéter ta position.`;
}

export async function runDebate(message, topic, personas, { vote = false } = {}) {
  const typing = setInterval(() => message.channel.sendTyping().catch(() => {}), 8_000);
  message.channel.sendTyping().catch(() => {});
  const said = [];
  const live = announce(message.channel, `Débat en cours : ${topic.replace(/\s+/g, ' ')}`);
  try {
    for (let round = 1; round <= ROUNDS; round++) {
      for (const persona of personas) {
        const { content } = await chat({ messages: buildMessages(persona, [{ role: 'user', content: debatePrompt(topic, persona, round, said) }], 'courte'), options: { num_predict: MAX_TOKENS.courte }, ...forReply() });
        const text = cleanReply(content);
        if (!text) continue;
        said.push({ persona, round, text });
        await speak(message.channel, persona, text, { replyTo: said.length === 1 ? message : undefined });
      }
    }
    log.info('debat', `${personas.join(', ')} sur « ${topic.slice(0, 80)} » demandé par ${message.author.tag}${vote ? ', puis vote' : ''}`, { channel: message.channel });
  } finally {
    clearInterval(typing);
    live.done();
  }
  if (vote) await runVote(message, topic, personas);
}
