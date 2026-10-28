import { randomPersona } from '../conversation/router.js';
import { addMessage, answered, openConversation } from '../conversation/threads.js';
import { rememberAnswer } from '../../core/discord/history.js';
import { speak } from '../../core/discord/webhooks.js';
import { chat, forReply } from '../../core/llm/client.js';
import { cleanReply, systemPrompt } from '../../core/llm/prompts.js';
import { findPublication } from '../admin/publications-store.js';
import { setting } from '../../core/settings.js';
import { activePersonas, moduleEnabled } from '../../core/config.js';
import { log } from '../../core/log/log.js';

function welcomeChannel(guild) {
  return guild.channels.cache.get(setting(guild.id, 'welcome_channel')) ?? guild.systemChannel ?? null;
}

export function logArrival(member) {
  const young = Date.now() - member.user.createdTimestamp < 7 * 86_400_000;
  log.notice('membres', `${member} est arrivé · compte créé <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>${young ? ' ⚠️ compte récent' : ''}`, { guild: member.guild });
}

export async function welcome(member) {
  const { guild } = member;
  if (member.user.bot || !moduleEnabled(guild.id, 'bienvenue')) return;
  const channel = welcomeChannel(guild);
  if (!channel) return;
  const personas = activePersonas(guild.id);
  const persona = personas.includes('balthasar') ? 'balthasar' : randomPersona(Math.random, personas);
  const rules = findPublication(guild.id, 'règlement');
  const hint = rules ? ` Invite la personne à lire le règlement dans <#${rules.channel_id}>.` : '';
  let text = 'Bienvenue parmi nous, installe-toi et présente-toi quand tu veux.';
  try {
    const { content } = await chat({
      messages: [
        { role: 'system', content: systemPrompt(persona, 'courte') },
        { role: 'user', content: `${member.displayName} vient d'arriver sur le serveur ${guild.name}. Souhaite la bienvenue à cette personne avec ta voix et ta longueur habituelle, sans citer son pseudo (il sera mentionné avant ton message).${hint}` },
      ],
      options: { num_predict: 120 },
      ...forReply(),
    });
    text = cleanReply(content) || text;
  } catch {}
  const posted = await speak(channel, persona, `<@${member.id}> ${text}`, { mentions: [member.id] }).catch((err) => log.err('membres', `message de bienvenue non envoyé : ${err.message}`, { guild, channel }));
  if (!posted) return;
  rememberAnswer(posted, member.displayName);
  const conversation = openConversation({ channelId: channel.id, guildId: guild.id });
  addMessage(conversation, posted.id, member.id);
  answered(conversation, { persona, messageIds: [posted.id], userId: member.id, asked: true, text });
}

export async function farewell(member) {
  const { guild } = member;
  const since = member.joinedTimestamp ? ` · membre depuis <t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : '';
  log.notice('membres', `${member.user.tag} est parti${since}`, { guild });
}
