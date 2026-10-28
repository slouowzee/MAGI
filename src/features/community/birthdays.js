import { activePersonas, channelSetting, moduleEnabled } from '../../core/config.js';
import { birthdaysToday } from './store.js';
import { setSetting, setting } from '../../core/settings.js';
import { speak } from '../../core/discord/webhooks.js';
import { chat, forReply } from '../../core/llm/client.js';
import { buildMessages, cleanReply, MAX_TOKENS } from '../../core/llm/prompts.js';
import { log } from '../../core/log/log.js';

const CHECK_EVERY = 10 * 60_000;
const HOUR = 9;
const PARIS = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });

export function parisDay(now = Date.now()) {
  const p = Object.fromEntries(PARIS.formatToParts(now).map(({ type, value }) => [type, value]));
  return { key: `${p.year}-${p.month}-${p.day}`, month: Number(p.month), day: Number(p.day), hour: Number(p.hour) };
}

export async function celebrate(guild, now = Date.now()) {
  const today = parisDay(now);
  if (!moduleEnabled(guild.id, 'anniversaires') || today.hour < HOUR || setting(guild.id, 'birthday_done') === today.key) return 0;
  setSetting(guild.id, 'birthday_done', today.key);
  const channel = channelSetting(guild, 'birthday_channel') ?? channelSetting(guild, 'welcome_channel') ?? guild.systemChannel;
  if (!channel) return 0;
  const persona = activePersonas(guild.id).includes('balthasar') ? 'balthasar' : activePersonas(guild.id)[0];
  let sent = 0;
  for (const userId of birthdaysToday(guild.id, today.month, today.day)) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    let text = 'Joyeux anniversaire.';
    try {
      const { content } = await chat({ messages: buildMessages(persona, [{ role: 'user', content: `C'est l'anniversaire de ${member.displayName} aujourd'hui. Souhaite-le-lui en une phrase, sans citer son pseudo (il sera mentionné avant ton message).` }], 'courte'), options: { num_predict: MAX_TOKENS.courte }, ...forReply() });
      text = cleanReply(content) || text;
    } catch {}
    await speak(channel, persona, `<@${member.id}> ${text}`, { mentions: [member.id] });
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
