import { activePersona, awaitingAnswer, canFollowUp, forgetPersona, joinConversation, pickPersona, randomPersona, rememberPersona } from './router.js';
import { activePersonas, isMuted, moduleEnabled } from '../server/config.js';
import { memoryContext, summarizeConversation } from './memory.js';
import { floodCheck, quickReaction } from './rules.js';
import { runVote } from './vote.js';
import { maybeIntervene } from './spontaneous.js';
import { addressedPersonas, detect, VOTE_INTENT, wantsDetail } from './triggers.js';
import { buttonsFor, previewsFor } from '../discord/buttons.js';
import { conversationFor, rememberAnswer } from '../discord/history.js';
import { splitMessage } from '../discord/split.js';
import { speak } from '../discord/webhooks.js';
import { LLMUnavailable } from '../llm/client.js';
import { buildMessages, cleanReply, MAX_TOKENS } from '../llm/prompts.js';
import { respond } from '../llm/respond.js';

function addressesSomeoneElse(message) {
  const others = message.mentions.users.filter((u) => !u.bot && u.id !== message.author.id);
  const replied = message.mentions.repliedUser;
  return others.size > 0 || Boolean(replied && !replied.bot && replied.id !== message.author.id);
}

export async function handleMessage(message) {
  if (message.inGuild() && isMuted(message.channel)) return;
  const answering =
    message.inGuild() && !message.author.bot && canFollowUp(message.channel.id, message.author.id) && !addressesSomeoneElse(message);
  const trigger = (await detect(message, message.client)) ?? (answering ? { persona: 'auto', vote: false, text: message.content } : null);
  if (!trigger) {
    if (message.inGuild() && !message.author.bot && !message.webhookId) await maybeIntervene(message).catch((err) => console.error('intervention spontanée :', err.message));
    return;
  }

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
  const voting = moduleEnabled(message.guild.id, 'vote');
  if (trigger.vote && voting) {
    rememberPersona(channelId, null);
    return runVote(message, question);
  }
  const allowed = activePersonas(message.guild.id);
  const group = addressedPersonas(message.content).filter((p) => allowed.includes(p));
  if (voting && group.length >= 2 && VOTE_INTENT.test(message.content)) {
    console.log(`  vote entre ${group.join(', ')}`);
    rememberPersona(channelId, null);
    return runVote(message, message.content, group);
  }
  let persona = allowed.includes(trigger.persona) ? trigger.persona : null;
  if (!persona) {
    const pick = await pickPersona(question, activePersona(channelId), allowed);
    if (pick.vote && voting) {
      console.log('  vote détecté');
      return runVote(message, question);
    }
    persona = pick.persona ?? randomPersona(Math.random, allowed);
    console.log(`  persona choisie : ${persona} (${pick.reason})`);
  }
  rememberPersona(channelId, persona);
  const length = wantsDetail(trigger.text) ? 'detaillee' : 'courte';
  const typing = setInterval(() => message.channel.sendTyping().catch(() => {}), 8_000);
  message.channel.sendTyping().catch(() => {});
  try {
    const { turns, participants, target } = await conversationFor(message, persona, message.content);
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
      const last = i === parts.length - 1 ? { components: buttonsFor(actions), embeds: previewsFor(actions) } : {};
      rememberAnswer(await speak(message.channel, persona, part, { ...last, replyTo: i === 0 ? message : undefined }), target);
    }
    rememberPersona(channelId, persona, Date.now(), { followUserId: message.author.id, asked: cleaned.endsWith('?') });
  } catch (err) {
    console.error(`[${message.guild.name} #${message.channel.name}] réponse impossible :`, err.message);
    if (err instanceof LLMUnavailable) await speak(message.channel, 'melchior', 'Unité hors ligne.').catch(() => {});
  } finally {
    clearInterval(typing);
  }
}
