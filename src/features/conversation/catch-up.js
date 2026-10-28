import { SnowflakeUtil } from 'discord.js';
import { personaOf } from '../../core/discord/webhooks.js';
import { moderate } from '../moderation/index.js';
import { handleMessage } from './handle-message.js';
import { log } from '../../core/log/log.js';

const WINDOW = 2 * 60_000;

export async function catchUp(client, now = Date.now()) {
  const since = now - WINDOW;
  const after = SnowflakeUtil.generate({ timestamp: since }).toString();
  let handled = 0;
  for (const guild of client.guilds.cache.values()) {
    for (const channel of guild.channels.cache.values()) {
      if (!channel.isTextBased?.() || !channel.lastMessageId || SnowflakeUtil.timestampFrom(channel.lastMessageId) < since) continue;
      const fetched = await channel.messages.fetch({ limit: 20, after }).catch(() => null);
      const messages = [...(fetched?.values() ?? [])].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      const lastAnswer = messages.findLastIndex((m) => personaOf(m) || m.author.id === client.user.id);
      for (const message of messages.slice(lastAnswer + 1)) {
        if (message.author.bot || message.webhookId) continue;
        if (!message.member) await guild.members.fetch(message.author.id).catch(() => null);
        if (!message.member) continue;
        handled++;
        if (await moderate(message).catch(() => false)) continue;
        await handleMessage(message, { catchUp: true }).catch((err) => log.err('rattrapage', err.message, { channel }));
      }
    }
  }
  if (handled) log.notice('rattrapage', `${handled} message(s) reçu(s) pendant le redémarrage`);
}
