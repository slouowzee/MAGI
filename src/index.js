import { Client, Events, GatewayIntentBits } from 'discord.js';
import { db } from './db.js';
import { detect, wantsDetail, wantsInstall } from './triggers.js';
import { splitMessage } from './split.js';
import { buildMessages, cleanReply, MAX_TOKENS, warmupRequests } from './prompts.js';
import { install, installReport, logChannel } from './setup.js';
import { speak } from './webhooks.js';
import { chat, LLMUnavailable, warmupOllama } from './llm.js';
import { activePersona, forgetPersona, pickPersona, rememberPersona } from './router.js';
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

const silent = { allowedMentions: { parse: [] } };

async function installAndReport(guild) {
  try {
    const result = await install(guild);
    if (result.created.length || !result.ok) {
      await logChannel(guild)?.send({ content: installReport(result, guild), ...silent });
    }
    console.log(`[${guild.name}] installation : ${result.created.length ? result.created.join(', ') : 'rien à créer'}, admin ${result.ok ? 'activé' : 'désactivé'}`);
    return result;
  } catch (err) {
    console.error(`[${guild.name}] installation impossible :`, err.message);
    return null;
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`MAGI prêt : connecté en tant que ${c.user.tag} sur ${c.guilds.cache.size} serveur(s)`);
  for (const guild of c.guilds.cache.values()) await installAndReport(guild);
  const started = Date.now();
  await Promise.all(warmupRequests().map(warmupOllama))
    .then(() => console.log(`Personas préchauffées sur Ollama en ${Math.round((Date.now() - started) / 1000)} s`))
    .catch((err) => console.error('Préchauffage impossible :', err.message));
});

client.on(Events.GuildCreate, installAndReport);

client.on(Events.MessageCreate, async (message) => {
  const trigger = await detect(message, client);
  if (!trigger) return;

  if (wantsInstall(trigger.text) && message.author.id === message.guild.ownerId) {
    const result = await installAndReport(message.guild);
    await message.reply({ content: result ? installReport(result, message.guild) : 'Installation impossible, voir les logs.', ...silent });
    return;
  }

  console.log(`[${message.guild.name} #${message.channel.name}] ${message.author.tag} →`, trigger);
  const channelId = message.channel.id;

  const quick = quickReaction(message.content);
  if (quick) {
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
    const { content: reply, provider } = await chat({
      messages: buildMessages(persona, await conversationFor(message, persona, message.content), length),
      options: { num_predict: MAX_TOKENS[length], repeat_penalty: 1.1 },
    });
    clearInterval(typing);
    console.log(`  réponse ${persona} via ${provider}`);
    for (const part of splitMessage(cleanReply(reply))) if (part) await speak(message.channel, persona, part);
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
