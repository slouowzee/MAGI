import { ActivityType, GuildScheduledEventStatus, PermissionFlagsBits as P } from 'discord.js';
import { activePersonas, moduleEnabled, option, settingList } from '../../core/config.js';
import { llmStatus, onLlmActivity } from '../../core/llm/client.js';
import { PERSONAS } from '../../core/personas.js';
import { countSettings } from '../../core/settings.js';
import { synchroTop } from '../community/store.js';
import { rateOf } from '../community/synchro.js';

const DEBOUNCE = 1_500;
const ROTATE = 180_000;
const SLOW = 15_000;
const SLEEPING = 'En veille, écris « magi » pour me réveiller';
export const PRESENCE_ITEMS = { unites: 'Unités actives', synchro: 'Meilleure synchro', hall: 'Hall of Fame', evenement: 'Prochain événement', membres: 'Nombre de membres', astuces: 'Astuces' };

const live = new Map();
const lastMessages = new Map();
const started = Date.now();
let refresh = () => {};

const paris = (now, options) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', ...options }).format(now);
export const parisHour = (now) => Number(paris(now, { hour: 'numeric', hourCycle: 'h23' }).replace(/\D/g, ''));

export function inNight(hour, range) {
  if (!/^\d+-\d+$/.test(range ?? '')) return false;
  const [from, to] = range.split('-').map(Number);
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

export function presenceState({ live: current, status, now, night, idleAfter, lastMessage, rotation }) {
  if (current) return { status: 'online', text: current };
  const available = status.filter((s) => !s.paused);
  if (status.length && !available.length) return { status: 'dnd', text: `Unités hors ligne, reprise vers ${paris(Math.min(...status.map((s) => s.paused)), { timeStyle: 'short' })}` };
  if (inNight(parisHour(now), night) || (idleAfter > 0 && now - lastMessage > idleAfter)) return { status: 'idle', text: SLEEPING };
  return { status: 'online', text: rotation ?? null };
}

const isPublic = (channel) => Boolean(channel.permissionsFor?.(channel.guild.roles.everyone)?.has(P.ViewChannel));

export function announce(channel, text) {
  const key = Symbol();
  const set = (value) => {
    live.set(key, { guildId: channel.guild.id, text: isPublic(channel) ? value.slice(0, 120) : 'En délibération…' });
    refresh();
  };
  set(text);
  return {
    set,
    done: () => {
      live.delete(key);
      refresh();
    },
  };
}

export function noteMessage(message) {
  if (!message.guild || message.author.bot) return;
  lastMessages.set(message.guild.id, Date.now());
  refresh();
}

function tips(guildId) {
  const on = (name) => moduleEnabled(guildId, name);
  return [
    'Écris « magi, … » pour me parler',
    on('commandes') && 'Clic droit sur un message → Applications → Avis de Casper',
    on('commandes') && '/chuchoter pour parler en privé à une unité',
    on('etoiles') && '🔥 sur un message pour l’envoyer au Hall of Fame',
    on('vote') && '« magi, votez : … » pour un vote des trois unités',
    on('debat') && '« débattez : … » pour lancer un débat',
    on('rappels') && '« rappelle-moi dans 10 min de … »',
  ].filter(Boolean);
}

async function nextEvent(guild, now) {
  const events = await guild.scheduledEvents.fetch().catch(() => null);
  const next = [...(events?.values() ?? [])].filter((e) => e.status === GuildScheduledEventStatus.Scheduled && e.scheduledStartTimestamp > now).sort((a, b) => a.scheduledStartTimestamp - b.scheduledStartTimestamp)[0];
  return next && `Prochain événement : ${next.name}, ${paris(next.scheduledStartTimestamp, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
}

export async function rotationTexts(guild, status = llmStatus(), now = Date.now()) {
  const chosen = settingList(guild.id, 'presence_items').filter((key) => PRESENCE_ITEMS[key]);
  const wanted = new Set(chosen.length ? chosen : Object.keys(PRESENCE_ITEMS));
  const top = moduleEnabled(guild.id, 'synchro') ? synchroTop(guild.id, 1)[0] : null;
  const topName = top && (guild.members.cache.get(top.user_id) ?? (await guild.members.fetch(top.user_id).catch(() => null)))?.displayName;
  const hall = moduleEnabled(guild.id, 'etoiles') ? countSettings(guild.id, 'star:') : 0;
  const slow = status.find((s) => !s.paused)?.latency > SLOW;
  return [
    slow && 'Unités saturées, réponses plus lentes',
    wanted.has('unites') && `Système MAGI · ${activePersonas(guild.id).length}/${Object.keys(PERSONAS).length} unités actives`,
    wanted.has('synchro') && topName && `Meilleure synchro : ${topName}, ${rateOf(top.points)} %`,
    wanted.has('hall') && hall > 0 && `Hall of Fame : ${hall} message${hall > 1 ? 's' : ''}`,
    wanted.has('evenement') && (await nextEvent(guild, now)),
    wanted.has('membres') && `Veille sur ${guild.memberCount} membres`,
    ...(wanted.has('astuces') ? tips(guild.id) : []),
  ].filter(Boolean);
}

export function startPresence(client) {
  let last = null;
  let timer = null;
  let texts = [];
  let index = 0;
  const main = () => [...client.guilds.cache.values()].filter((g) => moduleEnabled(g.id, 'statut')).sort((a, b) => b.memberCount - a.memberCount)[0] ?? null;
  const apply = () => {
    const guild = main();
    const now = Date.now();
    const next = guild
      ? presenceState({
          live: [...live.values()].filter((l) => l.guildId === guild.id).at(-1)?.text,
          status: llmStatus(),
          now,
          night: option(guild.id, 'presence_night'),
          idleAfter: Number(option(guild.id, 'presence_idle')) * 60_000,
          lastMessage: lastMessages.get(guild.id) ?? started,
          rotation: texts.length ? texts[index % texts.length] : null,
        })
      : { status: 'online', text: null };
    const key = `${next.status} ${next.text}`;
    if (key === last) return;
    last = key;
    client.user.setPresence({ status: next.status, activities: next.text ? [{ type: ActivityType.Custom, name: 'statut', state: next.text }] : [] });
  };
  refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(apply, DEBOUNCE);
  };
  const rotate = async () => {
    const guild = main();
    texts = guild ? await rotationTexts(guild).catch(() => texts) : [];
    index++;
    refresh();
  };
  onLlmActivity(refresh);
  rotate();
  setInterval(rotate, ROTATE).unref();
  setInterval(refresh, 60_000).unref();
}
