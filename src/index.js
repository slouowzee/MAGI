import { Client, Events, GatewayIntentBits } from 'discord.js';
import { db } from './db.js';
import { detect, wantsDetail } from './triggers.js';
import { splitMessage } from './split.js';
import { buildMessages, cleanReply, MAX_TOKENS, warmupRequests } from './prompts.js';
import { installAndReport } from './setup.js';
import { respond } from './respond.js';
import { buttonsFor, handleInteraction } from './actions.js';
import { speak } from './webhooks.js';
import { LLMUnavailable, warmupOllama } from './llm.js';
import { activePersona, awaitingAnswer, forgetPersona, pickPersona, rememberPersona } from './router.js';
import { floodCheck, quickReaction } from './rules.js';
import { conversationFor } from './context.js';

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('DISCORD_TOKEN manquant (voir .env.example)');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`MAGI prêt : connecté en tant que ${c.user.tag} sur ${c.guilds.cache.size} serveur(s)`);
  for (const guild of c.guilds.cache.values()) await installAndReport(guild);
  if (process.env.GEMINI_API_KEY) {
    console.log(`LLM : Gemini (${process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'}), Ollama en secours`);
    return;
  }
  console.log('LLM : Ollama seul (pas de GEMINI_API_KEY)');
  const started = Date.now();
  await Promise.all(warmupRequests().map(warmupOllama))
    .then(() => console.log(`Personas préchauffées sur Ollama en ${Math.round((Date.now() - started) / 1000)} s`))
    .catch((err) => console.error('Préchauffage impossible :', err.message));
});

client.on(Events.GuildCreate, installAndReport);
client.on(Events.InteractionCreate, handleInteraction);

client.on(Events.MessageCreate, async (message) => {
  const answering = message.inGuild() && !message.author.bot && awaitingAnswer(message.channel.id, message.author.id);
  const trigger = (await detect(message, client)) ?? (answering ? { persona: activePersona(message.channel.id), vote: false, text: message.content } : null);
  if (!trigger) return;

  console.log(`[${message.guild.name} #${message.channel.name}] ${message.author.tag} →`, trigger);
  const channelId = message.channel.id;

  const quick = quickReaction(message.content);
  if (quick && !awaitingAnswer(channelId, message.author.id)) {
    await message.react(quick.emoji).catch(() => {});
    if (quick.ends) forgetPersona(channelId);
    return;
  }

  const flood = floodCheck(message.author.id);
  if (flood !== 'ok') {
    if (flood === 'warn') await speak(message.channel, 'balthasar', 'Doucement. Une question à la fois, je ne vais nulle part.').catch(() => {});
    return;
  }
  let persona = trigger.persona;
  if (persona === 'auto') persona = activePersona(channelId);
  if (!persona) {
    const pick = await pickPersona(trigger.text || message.content);
    persona = pick.persona;
    console.log(`  persona choisie : ${persona} (${pick.reason})`);
  }
  rememberPersona(channelId, persona);
  const length = wantsDetail(trigger.text) ? 'detaillee' : 'courte';
  const typing = setInterval(() => message.channel.sendTyping().catch(() => {}), 8_000);
  message.channel.sendTyping().catch(() => {});
  try {
    const { content: reply, provider, actions } = await respond({
      messages: buildMessages(persona, await conversationFor(message, persona, message.content), length),
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
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await client.destroy();
    db.close();
    process.exit(0);
  });
}

await client.login(token);
