import { Client, Events, GatewayIntentBits } from 'discord.js';
import { handleMessage } from './conversation/handle-message.js';
import { handleInteraction } from './discord/buttons.js';
import { warmupOllama } from './llm/client.js';
import { warmupRequests } from './llm/prompts.js';
import { installAndReport } from './server/installation.js';
import { db } from './storage/db.js';

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
client.on(Events.MessageCreate, handleMessage);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await client.destroy();
    db.close();
    process.exit(0);
  });
}

await client.login(token);
