import { pickPersona, randomPersona, startsNewTopic } from './router.js';
import { addMessage, answered, awaitingAnswer, closeConversation, endFollowUp, followUpConversation, isClaimed, locateConversation, openConversation } from './threads.js';
import { activePersonas, isMuted, moduleEnabled, personaForChannel } from '../../core/config.js';
import { memoryContext, summarizeConversation } from '../memory/context.js';
import { floodCheck, moodReaction, quickReaction, unitReaction } from './rules.js';
import { unitEmote } from '../../core/discord/emotes.js';
import { PERSONAS } from '../../core/personas.js';
import { runVote } from '../vote/vote.js';
import { announce } from '../presence/presence.js';
import { runDebate, wantsDebate } from '../vote/debate.js';
import { maybeIntervene } from './spontaneous.js';
import { addressedPersonas, detect, notForMagi, VOTE_INTENT, wantsDetail, wantsSummary } from './triggers.js';
import { buttonsFor, previewsFor } from '../../core/discord/buttons.js';
import { conversationFor, conversationPrompt, rememberAnswer } from '../../core/discord/history.js';
import { splitMessage } from '../../core/discord/split.js';
import { speak } from '../../core/discord/webhooks.js';
import { chat, forReply, LLMUnavailable } from '../../core/llm/client.js';
import { acceptable, examplesNote, registerOf, rememberReply, repetitionNote, staleness, toneNote } from './examples.js';
import { buildMessages, cleanReply, MAX_TOKENS } from '../../core/llm/prompts.js';
import { respond } from '../../core/llm/respond.js';
import { log } from '../../core/log/log.js';

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

export async function handleMessage(message, { catchUp = false, force = false } = {}) {
  if (!message.inGuild() || message.author.bot || message.webhookId || isMuted(message.channel)) return;
  const now = Date.now();
  const channelId = message.channel.id;
  const detected = await detect(message, message.client);
  const following = detected || catchUp || addressesSomeoneElse(message) ? null : followUpConversation(channelId, message.author.id, now);
  if (following && notForMagi(message.content)) {
    endFollowUp(following);
    addMessage(following, message.id, message.author.id, now, `${message.member?.displayName ?? message.author.username} : ${message.content}`);
    await message.react(unitReaction(following.persona, 'ignore', '👌')).catch(() => {});
    log.debug('conversation', `${message.author.tag} : pas pour MAGI, suite arrêtée`, { channel: message.channel });
    return;
  }
  const trigger = detected ?? (following || force ? { persona: 'auto', vote: false, text: message.content } : null);
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
  if (quick && (quick.always || !awaitingAnswer(conversation, message.author.id, now))) {
    if (conversation) addMessage(conversation, message.id, message.author.id, now, line);
    await message.react(unitReaction(PERSONAS[trigger.persona] ? trigger.persona : conversation?.persona, quick.kind, quick.emoji)).catch(() => {});
    if (quick.ends) summarizeConversation(message.client, closeConversation(conversation));
    return;
  }

  const flood = floodCheck(message.author.id, message.createdTimestamp);
  if (flood !== 'ok') {
    if (flood === 'warn') {
      const facepalm = unitEmote('casper', 'facepalm');
      await (facepalm ? message.react(facepalm) : speak(message.channel, 'balthasar', 'Doucement. Une question à la fois, je ne vais nulle part.')).catch(() => {});
    }
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
  const channelPersona = current.persona ? null : personaForChannel(message.channel);
  let persona = allowed.includes(trigger.persona) ? trigger.persona : following && allowed.includes(following.persona) ? following.persona : allowed.includes(channelPersona) ? channelPersona : null;
  if (!persona) {
    const pick = await pickPersona(question, current.persona, allowed);
    if (pick.vote && voting) {
      log.info('vote', `détecté chez ${message.author.tag}`, where);
      return runVote(message, question);
    }
    persona = pick.persona ?? randomPersona(Math.random, allowed);
    log.debug('conversation', `routage : ${persona} (${pick.reason})`, where);
  }
  if (catchUp) {
    const dodo = unitEmote(persona, 'dodo');
    if (dodo) message.react(dodo).catch(() => {});
  }
  const length = wantsDetail(trigger.text) ? 'detaillee' : 'courte';
  const typing = setInterval(() => message.channel.sendTyping().catch(() => {}), 8_000);
  message.channel.sendTyping().catch(() => {});
  const live = announce(message.channel, `${PERSONAS[persona].name} répond à ${message.member?.displayName ?? message.author.username}`);
  try {
    const { turns, participants, target, included } = await conversationFor(message, persona, message.content, current, (id) => isClaimed(channelId, id));
    for (const id of included) addMessage(current, id, null, Date.now());
    const summary = wantsSummary(trigger.text);
    const guildId = message.guild.id;
    const extra = [await memoryContext(guildId, participants, message.content), !summary && examplesNote(guildId, persona, registerOf(trigger.text), Math.random, trigger.text), !summary && toneNote(guildId), repetitionNote(guildId, persona)].filter(Boolean).join('\n');
    const messages = buildMessages(persona, summary ? [{ role: 'user', content: conversationPrompt([`${target} : ${message.content}`], target) }] : turns, length, extra);
    const first = await respond({
      messages,
      options: { num_predict: MAX_TOKENS[length] },
      member: message.member,
      message,
      persona,
      force: summary ? 'resumer' : null,
    });
    const { actions } = first;
    let { content: reply, model } = first;
    const stale = !actions.length && staleness(guildId, persona, cleanReply(reply));
    if (stale) {
      const retry = await chat({ messages: [...messages, { role: 'assistant', content: reply }, { role: 'user', content: `Réécris ta réponse autrement : ${stale}. Même idée si elle est bonne, mais d'autres mots et une autre construction, sans reprendre aucune de tes réponses précédentes.` }], options: { num_predict: MAX_TOKENS[length] }, ...forReply() }).catch(() => null);
      if (retry?.content?.trim() && acceptable(guildId, persona, cleanReply(retry.content))) ({ content: reply, model } = retry);
      log.debug('conversation', `${persona} : réponse réécrite, ${stale}`, where);
    }
    clearInterval(typing);
    log.info('conversation', `${message.author.tag} → ${persona}, conv ${current.id}, ${model}${stale ? ', réécrite' : ''}, ${((Date.now() - started) / 1000).toFixed(1)} s`, where);
    const cleaned = cleanReply(reply);
    rememberReply(guildId, persona, cleaned);
    const parts = splitMessage(cleaned).filter(Boolean);
    const sent = [];
    for (const [i, part] of parts.entries()) {
      const last = i === parts.length - 1 ? { components: buttonsFor(actions), embeds: previewsFor(actions) } : {};
      const posted = await speak(message.channel, persona, part, { ...last, replyTo: i === 0 ? message : undefined });
      rememberAnswer(posted, target);
      sent.push(posted.id);
    }
    answered(current, { persona, messageIds: sent, userId: message.author.id, asked: cleaned.endsWith('?'), text: cleaned });
    const mood = !catchUp && moodReaction(persona, registerOf(trigger.text), trigger.text);
    if (mood) message.react(mood).catch(() => {});
  } catch (err) {
    log.err('conversation', `échec ${persona} → ${message.author.tag} : ${err.message}`, where);
    if (err instanceof LLMUnavailable) {
      const offline = unitEmote('melchior', 'erreur');
      await (offline ? message.react(offline) : speak(message.channel, 'melchior', 'Unité hors ligne.')).catch(() => {});
    }
  } finally {
    clearInterval(typing);
    live.done();
  }
}
