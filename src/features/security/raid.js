import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } from 'discord.js';
import { moduleEnabled, option, setSettingList, settingList } from '../../core/config.js';
import { magiChannelIds, operatorRole } from '../../core/installation.js';
import { setSetting, setting } from '../../core/settings.js';
import { gateChannel } from './gate.js';
import { log } from '../../core/log/log.js';

const WINDOW = 60_000;
const LOCK = 30 * 60_000;
const TEXT = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum];
const joins = new Map();
const timers = new Map();

export const isLocked = (guild, now = Date.now()) => Number(setting(guild.id, 'raid_lock_until') ?? 0) > now;

export async function trackJoin(member, now = Date.now()) {
  const { guild } = member;
  if (!moduleEnabled(guild.id, 'anti_raid')) return false;
  const recent = (joins.get(guild.id) ?? []).filter((t) => now - t < WINDOW);
  recent.push(now);
  joins.set(guild.id, recent);
  if (isLocked(guild, now)) return true;
  if (recent.length < Number(option(guild.id, 'raid_threshold'))) return false;
  await lockdown(guild, recent.length, now);
  return true;
}

export async function lockdown(guild, count, now = Date.now()) {
  const everyone = guild.roles.everyone;
  const spared = new Set([...magiChannelIds(guild), gateChannel(guild)?.id].filter(Boolean));
  const locked = [];
  for (const channel of guild.channels.cache.values()) {
    if (!TEXT.includes(channel.type) || spared.has(channel.id) || spared.has(channel.parentId)) continue;
    if (channel.permissionOverwrites.cache.get(everyone.id)?.deny.has('SendMessages')) continue;
    const ok = await channel.permissionOverwrites
      .edit(everyone, { SendMessages: false, SendMessagesInThreads: false, CreatePublicThreads: false }, { reason: `MAGI anti-raid : ${count} arrivées en 1 min` })
      .then(() => true)
      .catch(() => false);
    if (ok) locked.push(channel.id);
  }
  setSettingList(guild.id, 'raid_locked', locked);
  setSetting(guild.id, 'raid_lock_until', now + LOCK);
  schedule(guild, LOCK);
  const operators = operatorRole(guild);
  log.alert('antiraid', `${count} arrivées en moins d'1 min : ${locked.length} salon(s) verrouillé(s) 30 min, nouveaux membres envoyés au filtre s'il est actif`, {
    guild,
    mention: { users: [guild.ownerId], roles: operators ? [operators.id] : [] },
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('magi-sec:deverrouiller').setLabel('Lever le verrouillage').setStyle(ButtonStyle.Secondary))],
  });
}

function schedule(guild, delay) {
  clearTimeout(timers.get(guild.id));
  timers.set(guild.id, setTimeout(() => unlock(guild, 'fin des 30 min').catch(() => {}), Math.max(delay, 0)));
}

export async function unlock(guild, by) {
  clearTimeout(timers.get(guild.id));
  const ids = settingList(guild.id, 'raid_locked');
  if (!ids.length && !setting(guild.id, 'raid_lock_until')) return 0;
  for (const id of ids) {
    await guild.channels.cache.get(id)?.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null, SendMessagesInThreads: null, CreatePublicThreads: null }, { reason: `MAGI anti-raid levé (${by})` }).catch(() => {});
  }
  setSettingList(guild.id, 'raid_locked', []);
  setSetting(guild.id, 'raid_lock_until', null);
  log.notice('antiraid', `verrouillage levé (${by}), ${ids.length} salon(s) rouvert(s)`, { guild });
  return ids.length;
}

export function resumeLockdowns(client, now = Date.now()) {
  for (const guild of client.guilds.cache.values()) {
    const until = Number(setting(guild.id, 'raid_lock_until') ?? 0);
    if (until) schedule(guild, until - now);
  }
}
