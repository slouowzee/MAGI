import { activePersona, awaitingAnswer, forgetPersona, joinConversation, pickPersona, rememberPersona } from './router.js';
import { memoryContext, summarizeConversation } from './memory.js';
import { floodCheck, quickReaction } from './rules.js';
import { runVote } from './vote.js';
import { detect, wantsDetail } from './triggers.js';
import { buttonsFor } from '../discord/buttons.js';
import { conversationFor } from '../discord/history.js';
import { splitMessage } from '../discord/split.js';
import { speak } from '../discord/webhooks.js';
import { LLMUnavailable } from '../llm/client.js';
import { buildMessages, cleanReply, MAX_TOKENS } from '../llm/prompts.js';
import { respond } from '../llm/respond.js';

export async function handleMessage(message) {
  const answering = message.inGuild() && !message.author.bot && awaitingAnswer(message.channel.id, message.author.id);
  const trigger = (await detect(message, message.client)) ?? (answering ? { persona: activePersona(message.channel.id), vote: false, text: message.content } : null);
  if (!trigger) return;

  console.log(`[${message.guild.name} #${message.channel.name}] ${message.author.tag} →`, trigger);
  const channelId = message.channel.id;
  joinConversation(channelId, message.guild.id, message.author.id);

  const quick = quickReaction(message.content);
  if (quick && !awaitingAnswer(channelId, message.author.id)) {
    await message.react(quick.emoji).catch(() => {});
    if (quick.ends) summarizeConversation(message.client, forgetPersona(channelId));
    return;
  }

  const flood = floodCheck(message.author.id);
  if (flood !== 'ok') {
    if (flood === 'warn') await speak(message.channel, 'balthasar', 'Doucement. Une question à la fois, je ne vais nulle part.').catch(() => {});
    return;
  }
  const question = trigger.text || message.content;
  if (trigger.vote) {
    rememberPersona(channelId, null);
    return runVote(message, question);
  }
  let persona = trigger.persona;
  if (persona === 'auto') persona = activePersona(channelId);
  if (!persona) {
    const pick = await pickPersona(question);
    if (pick.vote) {
      console.log('  vote détecté');
      return runVote(message, question);
    }
    persona = pick.persona;
    console.log(`  persona choisie : ${persona} (${pick.reason})`);
  }
  rememberPersona(channelId, persona);
  const length = wantsDetail(trigger.text) ? 'detaillee' : 'courte';
  const typing = setInterval(() => message.channel.sendTyping().catch(() => {}), 8_000);
  message.channel.sendTyping().catch(() => {});
  try {
    const { turns, participants } = await conversationFor(message, persona, message.content);
    const { content: reply, provider, actions } = await respond({
      messages: buildMessages(persona, turns, length, memoryContext(message.guild.id, participants)),
      options: { num_predict: MAX_TOKENS[length], repeat_penalty: 1.1 },
      member: message.member,
      message,
    });
    clearInterval(typing);
    console.log(`  réponse ${persona} via ${provider}`);
    const cleaned = cleanReply(reply);
    const parts = splitMessage(cleaned).filter(Boolean);
    for (const [i, part] of parts.entries()) {
      await speak(message.channel, persona, part, i === parts.length - 1 ? buttonsFor(actions) : undefined);
    }
    rememberPersona(channelId, persona, Date.now(), cleaned.endsWith('?') ? message.author.id : null);
  } catch (err) {
    console.error(`[${message.guild.name} #${message.channel.name}] réponse impossible :`, err.message);
    if (err instanceof LLMUnavailable) await speak(message.channel, 'melchior', 'Unité hors ligne.').catch(() => {});
  } finally {
    clearInterval(typing);
  }
}
