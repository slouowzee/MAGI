import { randomPersona } from '../conversation/router.js';
import { addMessage, answered, openConversation } from '../conversation/threads.js';
import { rememberAnswer } from '../discord/history.js';
import { speak } from '../discord/webhooks.js';
import { chat, forReply } from '../llm/client.js';
import { cleanReply, systemPrompt } from '../llm/prompts.js';
import { findPublication } from '../storage/publications.js';
import { setting } from '../storage/settings.js';
import { activePersonas, moduleEnabled } from './config.js';
import { logChannel } from './installation.js';

const silent = { allowedMentions: { parse: [] } };

function welcomeChannel(guild) {
  return guild.channels.cache.get(setting(guild.id, 'welcome_channel')) ?? guild.systemChannel ?? null;
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
  let text = 'Bienvenue parmi nous. Installe-toi, et n’hésite pas à te présenter.';
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
  const posted = await speak(channel, persona, `<@${member.id}> ${text}`, { mentions: [member.id] }).catch((err) => console.error('bienvenue :', err.message));
  if (!posted) return;
  rememberAnswer(posted, member.displayName);
  const conversation = openConversation({ channelId: channel.id, guildId: guild.id });
  addMessage(conversation, posted.id, member.id);
  answered(conversation, { persona, messageIds: [posted.id], userId: member.id, asked: true, text });
}

export async function farewell(member) {
  const { guild } = member;
  if (!moduleEnabled(guild.id, 'bienvenue')) return;
  const since = member.joinedTimestamp ? `, arrivé <t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : '';
  await logChannel(guild)?.send({ content: `Départ : ${member.user.tag} (${member.id})${since}.`, ...silent }).catch(() => {});
}
