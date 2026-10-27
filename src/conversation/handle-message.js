import { pickPersona, randomPersona, startsNewTopic } from './router.js';
import { addMessage, answered, awaitingAnswer, closeConversation, followUpConversation, isClaimed, locateConversation, openConversation } from './threads.js';
import { activePersonas, isMuted, moduleEnabled } from '../server/config.js';
import { memoryContext, summarizeConversation } from './memory.js';
import { floodCheck, quickReaction } from './rules.js';
import { runVote } from './vote.js';
import { runDebate, wantsDebate } from './debate.js';
import { maybeIntervene } from './spontaneous.js';
import { addressedPersonas, detect, VOTE_INTENT, wantsDetail, wantsSummary } from './triggers.js';
import { buttonsFor, previewsFor } from '../discord/buttons.js';
import { conversationFor, conversationPrompt, rememberAnswer } from '../discord/history.js';
import { splitMessage } from '../discord/split.js';
import { speak } from '../discord/webhooks.js';
import { LLMUnavailable } from '../llm/client.js';
import { buildMessages, cleanReply, MAX_TOKENS } from '../llm/prompts.js';
import { respond } from '../llm/respond.js';
import { log } from '../logging/log.js';

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

export async function handleMessage(message, { catchUp = false } = {}) {
  if (!message.inGuild() || message.author.bot || message.webhookId || isMuted(message.channel)) return;
  const now = Date.now();
  const channelId = message.channel.id;
  const detected = await detect(message, message.client);
  const following = detected || catchUp || addressesSomeoneElse(message) ? null : followUpConversation(channelId, message.author.id, now);
  const trigger = detected ?? (following ? { persona: 'auto', vote: false, text: message.content } : null);
  const line = `${message.member?.displayName ?? message.author.username} : ${message.content}`;
  const found = following ? { conversation: following, by: 'suite' } : locate(message, trigger?.persona, now);
  let { conversation } = found;
  if (!trigger) {
    if (conversation) addMessage(conversation, message.id, message.author.id, now, line);
    else if (!catchUp) await maybeIntervene(message).catch((err) => log.err('conversation', `échec intervention : ${err.message}`, { channel: message.channel }));
    return;
  }

  const started = Date.now();
  const where = { channel: message.channel };
  log.debug('conversation', `${message.author.tag} → ${trigger.persona}${trigger.vote ? ' (vote)' : ''}${catchUp ? ' (rattrapage)' : ''} : ${message.content.slice(0, 120)}`, where);
  const quick = quickReaction(message.content);
  if (quick && !awaitingAnswer(conversation, message.author.id, now)) {
    if (conversation) addMessage(conversation, message.id, message.author.id, now, line);
    await message.react(quick.emoji).catch(() => {});
    if (quick.ends) summarizeConversation(message.client, closeConversation(conversation));
    return;
  }

  const flood = floodCheck(message.author.id, message.createdTimestamp);
  if (flood !== 'ok') {
    if (flood === 'warn') await speak(message.channel, 'balthasar', 'Doucement. Une question à la fois, je ne vais nulle part.').catch(() => {});
    return;
  }
  const question = trigger.text || message.content;
  const voting = moduleEnabled(message.guild.id, 'vote');
  if (trigger.vote && voting) return runVote(message, question);
  const allowed = activePersonas(message.guild.id);
  const group = addressedPersonas(message.content).filter((p) => allowed.includes(p));
  if (moduleEnabled(message.guild.id, 'debat') && wantsDebate(question) && allowed.length >= 2) {
    return runDebate(message, question, group.length >= 2 ? group : allowed, { vote: voting && VOTE_INTENT.test(message.content) });
  }
  if (voting && group.length >= 2 && VOTE_INTENT.test(message.content)) {
    log.info('vote', `demandé par ${message.author.tag} : ${group.join(', ')}`, where);
    return runVote(message, message.content, group);
  }

  const switching = found.by === 'author' && allowed.includes(trigger.persona) && !conversation.personas.has(trigger.persona);
  if (switching && (await startsNewTopic(conversation.lines, message.content))) {
    log.debug('conversation', `nouveau sujet, conversation ouverte pour ${message.author.tag}`, where);
    conversation = null;
  }
  const current = conversation ?? openConversation({ channelId, guildId: message.guild.id }, now);
  addMessage(current, message.id, message.author.id, now, line);
  let persona = allowed.includes(trigger.persona) ? trigger.persona : following && allowed.includes(following.persona) ? following.persona : null;
  if (!persona) {
    const pick = await pickPersona(question, current.persona, allowed);
    if (pick.vote && voting) {
      log.info('vote', `détecté chez ${message.author.tag}`, where);
      return runVote(message, question);
    }
    persona = pick.persona ?? randomPersona(Math.random, allowed);
    log.debug('conversation', `routage : ${persona} (${pick.reason})`, where);
  }
  const length = wantsDetail(trigger.text) ? 'detaillee' : 'courte';
  const typing = setInterval(() => message.channel.sendTyping().catch(() => {}), 8_000);
  message.channel.sendTyping().catch(() => {});
  try {
    const { turns, participants, target, included } = await conversationFor(message, persona, message.content, current, (id) => isClaimed(channelId, id));
    for (const id of included) addMessage(current, id, null, Date.now());
    const summary = wantsSummary(trigger.text);
    const { content: reply, model, actions } = await respond({
      messages: buildMessages(persona, summary ? [{ role: 'user', content: conversationPrompt([`${target} : ${message.content}`], target) }] : turns, length, await memoryContext(message.guild.id, participants, message.content)),
      options: { num_predict: MAX_TOKENS[length] },
      member: message.member,
      message,
      force: summary ? 'resumer' : null,
    });
    clearInterval(typing);
    log.info('conversation', `${message.author.tag} → ${persona}, conv ${current.id}, ${model}, ${((Date.now() - started) / 1000).toFixed(1)} s`, where);
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
    log.err('conversation', `échec ${persona} → ${message.author.tag} : ${err.message}`, where);
    if (err instanceof LLMUnavailable) await speak(message.channel, 'melchior', 'Unité hors ligne.').catch(() => {});
  } finally {
    clearInterval(typing);
  }
}
