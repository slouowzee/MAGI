import { Client, Events, GatewayIntentBits } from 'discord.js';
import { db } from './db.js';
import { detect, wantsInstall } from './triggers.js';
import { install, installReport, logChannel } from './setup.js';

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
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await client.destroy();
    db.close();
    process.exit(0);
  });
}

await client.login(token);
