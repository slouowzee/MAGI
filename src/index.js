import { Client, Events, GatewayIntentBits } from 'discord.js';
import { db } from './db.js';
import { detect, wantsDetail, wantsInstall } from './triggers.js';
import { splitMessage } from './split.js';
import { buildMessages, cleanReply, MAX_TOKENS, warmupRequests } from './prompts.js';
import { install, installReport, logChannel } from './setup.js';
import { speak } from './webhooks.js';
import { chat, OllamaUnavailable } from './ollama.js';

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
  await Promise.all(warmupRequests().map((messages) => chat({ messages, options: { num_predict: 1 } })))
    .then(() => console.log(`Personas préchauffées en ${Math.round((Date.now() - started) / 1000)} s`))
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
  const persona = trigger.persona === 'auto' ? 'melchior' : trigger.persona;
  const length = wantsDetail(trigger.text) ? 'detaillee' : 'courte';
  const typing = setInterval(() => message.channel.sendTyping().catch(() => {}), 8_000);
  message.channel.sendTyping().catch(() => {});
  try {
    const reply = await chat({
      messages: buildMessages(persona, trigger.text || message.content, length),
      options: { num_predict: MAX_TOKENS[length], repeat_penalty: 1.1 },
    });
    clearInterval(typing);
    for (const part of splitMessage(cleanReply(reply))) if (part) await speak(message.channel, persona, part);
  } catch (err) {
    console.error(`[${message.guild.name} #${message.channel.name}] réponse impossible :`, err.message);
    if (err instanceof OllamaUnavailable) await speak(message.channel, 'melchior', 'Unité hors ligne.').catch(() => {});
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
