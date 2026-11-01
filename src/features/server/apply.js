import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { operatorRole } from '../../core/installation.js';
import { setModule } from '../../core/config.js';
import { setSetting, setting } from '../../core/settings.js';
import { backupGuild } from '../security/backup.js';
import { disableHoneypot } from '../security/honeypot.js';
import { permissionBits } from '../admin/resolve.js';
import { describe } from './plan.js';
import { connect, finish } from './connect.js';

const ARCHIVE = '📦 ARCHIVES';
const PHASES = ['creer_role', 'modifier_role', 'creer_categorie', 'creer_salon', 'renommer', 'deplacer', 'regler', 'archiver', 'ordre_roles', 'fonction', 'panneau_roles', 'contenu', 'reglages', 'securite'];
const hex = (c) => (/^#?[0-9a-f]{6}$/i.test(String(c ?? '')) ? `#${String(c).replace('#', '')}` : undefined);
const dump = (channel) => [...channel.permissionOverwrites.cache.values()].map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() }));

export function accessOverwrites(guild, access, staffIds) {
  const me = { id: guild.members.me.id, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ManageWebhooks, P.ManageMessages] };
  const staff = [...new Set([...staffIds, operatorRole(guild)?.id].filter(Boolean))];
  if (access === 'lecture') return [{ id: guild.roles.everyone.id, deny: [P.SendMessages, P.CreatePublicThreads, P.CreatePrivateThreads] }, ...staff.map((id) => ({ id, allow: [P.SendMessages] })), me];
  if (access === 'staff') return [{ id: guild.roles.everyone.id, deny: [P.ViewChannel] }, ...staff.map((id) => ({ id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] })), me];
  return null;
}

export const sortOps = (ops) => [...ops].sort((a, b) => PHASES.indexOf(a.kind) - PHASES.indexOf(b.kind));

async function archive(guild, reason, journal) {
  const found = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === ARCHIVE);
  if (found) return found;
  const cat = await guild.channels.create({ name: ARCHIVE, type: ChannelType.GuildCategory, permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [P.SendMessages, P.Connect] }], reason });
  journal.push({ t: 'channel', id: cat.id });
  return cat;
}

const categoryId = (ctx, ref) => ref.id ?? ctx.categories.get(ref.name) ?? null;

function trackRole(ctx, op, role) {
  ctx.roles.set(op.name, role);
  if (op.staff) ctx.staff.push(role.id);
  if (op.self) ctx.self.push({ role, kind: op.self });
}

const APPLIERS = {
  __proto__: null,
  async creer_role(ctx, op) {
    const { guild, reason, journal } = ctx;
    const role = await guild.roles.create({ name: op.name, colors: hex(op.color) ? { primaryColor: hex(op.color) } : undefined, hoist: op.hoist, mentionable: Boolean(op.self), permissions: permissionBits(op.permissions), reason });
    journal.push({ t: 'role', id: role.id });
    trackRole(ctx, op, role);
  },
  async modifier_role(ctx, op) {
    const { guild, reason, journal } = ctx;
    const role = guild.roles.cache.get(op.id);
    journal.push({ t: 'role_edit', id: role.id, before: { name: role.name, hoist: role.hoist, color: role.hexColor } });
    await role.edit({ name: op.name, hoist: op.hoist || role.hoist, ...(hex(op.color) ? { colors: { primaryColor: hex(op.color) } } : {}), reason });
    trackRole(ctx, op, role);
  },
  async creer_categorie(ctx, op) {
    const { guild, reason, journal } = ctx;
    const cat = await guild.channels.create({ name: op.category.name, type: ChannelType.GuildCategory, permissionOverwrites: accessOverwrites(guild, op.access, ctx.staff) ?? undefined, reason });
    journal.push({ t: 'channel', id: cat.id });
    ctx.categories.set(op.category.name, cat.id);
  },
  async creer_salon(ctx, op) {
    const { guild, reason, journal } = ctx;
    const parent = categoryId(ctx, op.category);
    const custom = op.access && op.access !== 'nsfw' ? accessOverwrites(guild, op.access, ctx.staff) : null;
    const overwrites = op.access === 'public' ? [] : custom;
    const channel = await guild.channels.create({
      name: op.name,
      type: op.type,
      parent,
      topic: op.type === ChannelType.GuildVoice ? undefined : op.topic || undefined,
      nsfw: op.access === 'nsfw' || undefined,
      rateLimitPerUser: op.slowmode || undefined,
      userLimit: op.type === ChannelType.GuildVoice ? op.limit || undefined : undefined,
      permissionOverwrites: overwrites ?? (parent ? guild.channels.cache.get(parent)?.permissionOverwrites.cache : undefined),
      reason,
    });
    journal.push({ t: 'channel', id: channel.id });
    ctx.channels.set(op.name, channel);
  },
  async renommer({ guild, reason, journal }, op) {
    const channel = guild.channels.cache.get(op.id);
    journal.push({ t: 'name', id: op.id, from: channel.name });
    await channel.setName(op.to, reason);
  },
  async deplacer(ctx, op) {
    const channel = ctx.guild.channels.cache.get(op.id);
    ctx.journal.push({ t: 'parent', id: op.id, from: channel.parentId, overwrites: dump(channel) });
    await channel.setParent(categoryId(ctx, op.category), { lockPermissions: false, reason: ctx.reason });
  },
  async regler(ctx, op) {
    const { guild, reason, journal } = ctx;
    const channel = guild.channels.cache.get(op.id);
    journal.push({ t: 'settings', id: op.id, overwrites: dump(channel), before: { rateLimitPerUser: channel.rateLimitPerUser ?? 0, userLimit: channel.userLimit ?? 0, nsfw: Boolean(channel.nsfw) } });
    const overwrites = op.access && op.access !== 'nsfw' ? accessOverwrites(guild, op.access, ctx.staff) : null;
    if (overwrites) await channel.permissionOverwrites.set([...dump(channel).filter((o) => o.id !== guild.roles.everyone.id), ...overwrites], reason);
    const edit = {};
    if (op.access === 'nsfw') edit.nsfw = true;
    if (op.slowmode && channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildCategory) edit.rateLimitPerUser = op.slowmode;
    if (op.limit && channel.type === ChannelType.GuildVoice) edit.userLimit = op.limit;
    if (Object.keys(edit).length) await channel.edit({ ...edit, reason });
  },
  async archiver({ guild, reason, journal }, op) {
    const channel = guild.channels.cache.get(op.id);
    const cat = await archive(guild, reason, journal);
    journal.push({ t: 'parent', id: op.id, from: channel.parentId, overwrites: dump(channel) });
    await channel.setParent(cat.id, { lockPermissions: true, reason });
  },
  async ordre_roles(ctx, op) {
    const { guild, journal } = ctx;
    const top = guild.members.me.roles.highest.position;
    const roles = op.names.map((name) => ctx.roles.get(name)).filter((r) => r && r.position < top);
    journal.push({ t: 'positions', before: roles.map((r) => ({ role: r.id, position: r.position })) });
    await guild.roles.setPositions(roles.map((r, k) => ({ role: r.id, position: Math.max(top - 1 - k, 1) })));
  },
};

export async function applyPlan(guild, ops, { reason, progress = () => {}, features = [], journalKey = 'server_journal' }) {
  backupGuild(guild);
  const journal = [];
  const ctx = { guild, reason, journal, categories: new Map(), roles: new Map(), channels: new Map(), functions: new Map(), staff: [], self: [], features };
  const done = [];
  const failed = [];
  const sorted = sortOps(ops);
  for (const [i, op] of sorted.entries()) {
    try {
      await (APPLIERS[op.kind] ?? connect)(ctx, op);
      done.push(op);
    } catch (err) {
      failed.push(`${describe(op)} : ${err.message}`);
    }
    progress(i + 1, sorted.length);
  }
  const notes = await finish(ctx).catch((err) => [`accueil natif de Discord : ${err.message}`]);
  setSetting(guild.id, journalKey, JSON.stringify({ at: Date.now(), journal }));
  return [`${done.length} changement(s) appliqué(s) sur ${sorted.length}. Une sauvegarde a été faite avant, et « annuler la mise en place » défait tout.`, ...notes, ...(failed.length ? ['\u00C9checs :', ...failed] : [])].join('\n');
}

async function undo(guild, entry, reason) {
  const channel = entry.id ? guild.channels.cache.get(entry.id) : null;
  if (entry.t === 'channel') return channel?.delete(reason);
  if (entry.t === 'role') return guild.roles.cache.get(entry.id)?.delete(reason);
  if (entry.t === 'name') return channel?.setName(entry.from, reason);
  if (entry.t === 'parent') {
    await channel?.setParent(entry.from, { lockPermissions: false, reason });
    return channel?.permissionOverwrites.set(entry.overwrites, reason);
  }
  if (entry.t === 'settings') {
    await channel?.permissionOverwrites.set(entry.overwrites, reason);
    const before = channel?.type === ChannelType.GuildVoice ? { userLimit: entry.before.userLimit } : channel?.type === ChannelType.GuildCategory ? {} : { rateLimitPerUser: entry.before.rateLimitPerUser, nsfw: entry.before.nsfw };
    return Object.keys(before).length ? channel?.edit({ ...before, reason }) : null;
  }
  if (entry.t === 'role_edit') return guild.roles.cache.get(entry.id)?.edit({ name: entry.before.name, hoist: entry.before.hoist, colors: { primaryColor: entry.before.color }, reason });
  if (entry.t === 'positions') return guild.roles.setPositions(entry.before.filter((p) => guild.roles.cache.has(p.role)));
  if (entry.t === 'setting') return setSetting(guild.id, entry.key, entry.before);
  if (entry.t === 'module') return setModule(guild.id, entry.name, entry.before);
  if (entry.t === 'message') return guild.channels.cache.get(entry.channelId)?.messages.delete(entry.id);
  if (entry.t === 'guild') return guild.edit({ ...entry.before, reason });
  if (entry.t === 'honeypot') return disableHoneypot(guild, reason);
  if (entry.t === 'onboarding') return guild.editOnboarding({ ...entry.before, reason });
  return null;
}

export function lastSetup(guild, journalKey = 'server_journal') {
  const raw = setting(guild.id, journalKey);
  return raw ? JSON.parse(raw) : null;
}

export async function rollback(guild, reason, progress = () => {}, journalKey = 'server_journal') {
  const last = lastSetup(guild, journalKey);
  if (!last?.journal.length) return 'Aucune mise en place à annuler.';
  const steps = [...last.journal].reverse();
  let failed = 0;
  for (const [i, entry] of steps.entries()) {
    await undo(guild, entry, reason).catch(() => failed++);
    progress(i + 1, steps.length);
  }
  setSetting(guild.id, journalKey, null);
  return `${journalKey === 'season_journal' ? 'Thème retiré' : 'Mise en place annulée'} : ${steps.length - failed} étape(s) défaite(s)${failed ? `, ${failed} impossible(s) (élément déjà supprimé ou modifié)` : ''}.`;
}
