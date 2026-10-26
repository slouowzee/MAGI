import { pickPersona, randomPersona, startsNewTopic } from './router.js';
import { addMessage, answered, awaitingAnswer, closeConversation, followUpConversation, locateConversation, openConversation } from './threads.js';
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

function locate(message, persona, now) {
  return locateConversation(
    {
      channelId: message.channel.id,
      authorId: message.author.id,
      referenceId: message.reference?.messageId,
      mentionIds: [...message.mentions.users.keys()].filter((id) => id !== message.author.id),
      persona,
    },
    now,
  );
}

export async function handleMessage(message) {
  if (!message.inGuild() || message.author.bot || message.webhookId || isMuted(message.channel)) return;
  const now = Date.now();
  const channelId = message.channel.id;
  const detected = await detect(message, message.client);
  const following = detected || addressesSomeoneElse(message) ? null : followUpConversation(channelId, message.author.id, now);
  const trigger = detected ?? (following ? { persona: 'auto', vote: false, text: message.content } : null);
  const line = `${message.member?.displayName ?? message.author.username} : ${message.content}`;
  const found = following ? { conversation: following, by: 'suite' } : locate(message, trigger?.persona, now);
  let { conversation } = found;
  if (!trigger) {
    if (conversation) addMessage(conversation, message.id, message.author.id, now, line);
    else await maybeIntervene(message).catch((err) => console.error('intervention spontanée :', err.message));
    return;
  }

  console.log(`[${message.guild.name} #${message.channel.name}] ${message.author.tag} →`, trigger);
  const quick = quickReaction(message.content);
  if (quick && !awaitingAnswer(conversation, message.author.id, now)) {
    if (conversation) addMessage(conversation, message.id, message.author.id, now, line);
    await message.react(quick.emoji).catch(() => {});
    if (quick.ends) summarizeConversation(message.client, closeConversation(conversation));
    return;
  }

  const flood = floodCheck(message.author.id);
  if (flood !== 'ok') {
    if (flood === 'warn') await speak(message.channel, 'balthasar', 'Doucement. Une question à la fois, je ne vais nulle part.').catch(() => {});
    return;
  }
  const question = trigger.text || message.content;
  const voting = moduleEnabled(message.guild.id, 'vote');
  if (trigger.vote && voting) return runVote(message, question);
  const allowed = activePersonas(message.guild.id);
  const group = addressedPersonas(message.content).filter((p) => allowed.includes(p));
  if (voting && group.length >= 2 && VOTE_INTENT.test(message.content)) {
    console.log(`  vote entre ${group.join(', ')}`);
    return runVote(message, message.content, group);
  }

  const switching = found.by === 'author' && allowed.includes(trigger.persona) && !conversation.personas.has(trigger.persona);
  if (switching && (await startsNewTopic(conversation.lines, message.content))) {
    console.log('  nouveau sujet, nouvelle conversation');
    conversation = null;
  }
  const current = conversation ?? openConversation({ channelId, guildId: message.guild.id }, now);
  addMessage(current, message.id, message.author.id, now, line);
  let persona = allowed.includes(trigger.persona) ? trigger.persona : null;
  if (!persona) {
    const pick = await pickPersona(question, current.persona, allowed);
    if (pick.vote && voting) {
      console.log('  vote détecté');
      return runVote(message, question);
    }
    persona = pick.persona ?? randomPersona(Math.random, allowed);
    console.log(`  persona choisie : ${persona} (${pick.reason})`);
  }
  console.log(`  conversation n°${current.id} (${current.participants.size} participant(s))`);
  const length = wantsDetail(trigger.text) ? 'detaillee' : 'courte';
  const typing = setInterval(() => message.channel.sendTyping().catch(() => {}), 8_000);
  message.channel.sendTyping().catch(() => {});
  try {
    const { turns, participants, target } = await conversationFor(message, persona, message.content, current);
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
    const sent = [];
    for (const [i, part] of parts.entries()) {
      const last = i === parts.length - 1 ? { components: buttonsFor(actions), embeds: previewsFor(actions) } : {};
      const posted = await speak(message.channel, persona, part, { ...last, replyTo: i === 0 ? message : undefined });
      rememberAnswer(posted, target);
      sent.push(posted.id);
    }
    answered(current, { persona, messageIds: sent, userId: message.author.id, asked: cleaned.endsWith('?'), text: cleaned });
  } catch (err) {
    console.error(`[${message.guild.name} #${message.channel.name}] réponse impossible :`, err.message);
    if (err instanceof LLMUnavailable) await speak(message.channel, 'melchior', 'Unité hors ligne.').catch(() => {});
  } finally {
    clearInterval(typing);
  }
}
