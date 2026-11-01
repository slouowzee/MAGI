import { activePersonas, channelSetting, moduleEnabled } from '../../core/config.js';
import { birthdaysToday } from './store.js';
import { setSetting, setting } from '../../core/settings.js';
import { speak } from '../../core/discord/webhooks.js';
import { unitEmote } from '../../core/discord/emotes.js';
import { chat, forReply } from '../../core/llm/client.js';
import { buildMessages, cleanReply, MAX_TOKENS } from '../../core/llm/prompts.js';
import { log } from '../../core/log/log.js';
import { parisDate, parisParts } from '../../core/util.js';

const CHECK_EVERY = 10 * 60_000;
const HOUR = 9;

export function parisDay(now = Date.now()) {
  const { year, month, day, hour } = parisParts(now);
  return { key: parisDate(now), year, month, day, hour };
}

export function datesToCelebrate({ year, month, day }) {
  const leap = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1;
  return month === 2 && day === 28 && !leap ? [[2, 28], [2, 29]] : [[month, day]];
}

export async function celebrate(guild, now = Date.now(), { force = false } = {}) {
  const today = parisDay(now);
  if (!force && (!moduleEnabled(guild.id, 'anniversaires') || today.hour < HOUR || setting(guild.id, 'birthday_done') === today.key)) return 0;
  setSetting(guild.id, 'birthday_done', today.key);
  const channel = channelSetting(guild, 'birthday_channel') ?? channelSetting(guild, 'welcome_channel') ?? guild.systemChannel;
  if (!channel) return 0;
  const persona = activePersonas(guild.id).includes('balthasar') ? 'balthasar' : activePersonas(guild.id)[0];
  let sent = 0;
  for (const userId of datesToCelebrate(today).flatMap(([month, day]) => birthdaysToday(guild.id, month, day))) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    let text = 'Joyeux anniversaire.';
    try {
      const { content } = await chat({ messages: buildMessages(persona, [{ role: 'user', content: `C'est l'anniversaire de ${member.displayName} aujourd'hui. Souhaite-le-lui en une phrase, sans citer son pseudo (il sera mentionné avant ton message).` }], 'courte'), options: { num_predict: MAX_TOKENS.courte }, ...forReply() });
      text = cleanReply(content) || text;
    } catch (err) {
      log.info('anniversaires', `message de repli : ${err.message}`, { guild });
    }
    const posted = await speak(channel, persona, `<@${member.id}> ${text}`, { mentions: [member.id] });
    for (const emote of [unitEmote('balthasar', 'bisou', '🎂'), unitEmote('casper', 'fete', '🎉')]) await posted.react?.(emote).catch(() => {});
    log.info('anniversaires', `anniversaire de ${member.user.tag} souhaité`, { guild });
    sent++;
  }
  return sent;
}

export function startBirthdays(client) {
  const tick = () => {
    for (const guild of client.guilds.cache.values()) celebrate(guild).catch((err) => log.err('anniversaires', `échec : ${err.message}`, { guild }));
  };
  tick();
  setInterval(tick, CHECK_EVERY);
}
