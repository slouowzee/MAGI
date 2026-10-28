import { ChannelType, OverwriteType } from 'discord.js';
import { latestBackup, saveBackup } from './backup-store.js';
import { setSetting, setting } from '../../core/settings.js';
import { moduleEnabled } from '../../core/config.js';

const DAY = 24 * 3600_000;
const RESTORABLE = new Set([ChannelType.GuildCategory, ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildStageVoice]);

export function snapshot(guild) {
  const roles = [...guild.roles.cache.values()]
    .filter((r) => r.id !== guild.id && !r.managed)
    .map((r) => ({ id: r.id, name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: r.permissions.bitfield.toString(), position: r.position }));
  const channels = [...guild.channels.cache.values()]
    .filter((c) => RESTORABLE.has(c.type))
    .map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      parentId: c.parentId,
      position: c.rawPosition,
      topic: c.topic ?? null,
      nsfw: Boolean(c.nsfw),
      rateLimitPerUser: c.rateLimitPerUser ?? 0,
      overwrites: [...c.permissionOverwrites.cache.values()].map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() })),
    }));
  return { roles, channels };
}

export function missingFrom(data, guild) {
  const roleNames = new Set(guild.roles.cache.map((r) => r.name));
  const channelKeys = new Set(guild.channels.cache.map((c) => `${c.type}:${c.name}`));
  return {
    roles: data.roles.filter((r) => !guild.roles.cache.has(r.id) && !roleNames.has(r.name)),
    channels: data.channels.filter((c) => !guild.channels.cache.has(c.id) && !channelKeys.has(`${c.type}:${c.name}`)),
  };
}

export function backupGuild(guild, now = Date.now()) {
  saveBackup(guild.id, snapshot(guild), now);
}

export function freezeBackups(guild, now = Date.now()) {
  setSetting(guild.id, 'backup_frozen_until', now + 7 * DAY);
}

export function startBackups(client) {
  const run = () => {
    for (const guild of client.guilds.cache.values()) {
      const last = latestBackup(guild.id);
      const frozen = Date.now() < Number(setting(guild.id, 'backup_frozen_until'));
      if (!frozen && moduleEnabled(guild.id, 'sauvegardes') && (!last || Date.now() - last.createdAt >= DAY)) backupGuild(guild);
    }
  };
  run();
  setInterval(run, 3600_000).unref();
}

export async function restore(guild, data, reason) {
  const { roles, channels } = missingFrom(data, guild);
  const ids = new Map();
  for (const r of roles.sort((a, b) => a.position - b.position)) {
    const created = await guild.roles.create({ name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: BigInt(r.permissions), reason });
    ids.set(r.id, created.id);
  }
  const resolve = (id) => ids.get(id) ?? id;
  const overwrites = (list) =>
    list
      .filter((o) => (o.type === OverwriteType.Role ? guild.roles.cache.has(resolve(o.id)) : guild.members.cache.has(o.id)))
      .map((o) => ({ id: resolve(o.id), type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny) }));
  const ordered = [...channels.filter((c) => c.type === ChannelType.GuildCategory), ...channels.filter((c) => c.type !== ChannelType.GuildCategory)];
  for (const c of ordered) {
    const parent = c.parentId ? resolve(c.parentId) : null;
    const created = await guild.channels.create({
      name: c.name,
      type: c.type,
      topic: c.topic ?? undefined,
      nsfw: c.nsfw,
      rateLimitPerUser: c.rateLimitPerUser || undefined,
      parent: parent && guild.channels.cache.has(parent) ? parent : undefined,
      position: c.position,
      permissionOverwrites: overwrites(c.overwrites),
      reason,
    });
    ids.set(c.id, created.id);
  }
  return { roles: roles.length, channels: channels.length };
}
