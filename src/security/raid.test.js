import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { ChannelType, Collection } from 'discord.js';

const { gateReasons } = await import('./gate.js');
const { isLocked, trackJoin, unlock } = await import('./raid.js');
const { setSettingList } = await import('../server/config.js');
const { setSetting } = await import('../storage/settings.js');
const { addSink } = await import('../logging/log.js');

const DAY = 86_400_000;
const now = Date.parse('2026-10-27T20:00:00Z');

test("filtre à l'arrivée : âge du compte, avatar, tous, raid", () => {
  const guild = { id: 'g-filtre' };
  const member = (ageDays, avatar = 'a') => ({ user: { createdTimestamp: now - ageDays * DAY, avatar } });
  assert.deepEqual(gateReasons(member(2), guild, { now }), ['compte de moins de 7 j']);
  assert.deepEqual(gateReasons(member(30), guild, { now }), []);
  setSettingList('g-filtre', 'gate_rules', ['avatar']);
  assert.deepEqual(gateReasons(member(30, null), guild, { now }), ['sans avatar']);
  setSetting('g-filtre', 'gate_min_age', '0');
  setSettingList('g-filtre', 'gate_rules', ['tous']);
  assert.deepEqual(gateReasons(member(400), guild, { now, lockdown: true }), ['raid en cours', 'tous les nouveaux']);
});

test('anti-raid : verrouille au seuil, épargne les salons de MAGI, rouvre tout', async () => {
  const edits = [];
  const channel = (id, type = ChannelType.GuildText, denied = false) => ({
    id,
    type,
    parentId: null,
    permissionOverwrites: {
      cache: new Collection(denied ? [['everyone', { deny: { has: () => true } }]] : []),
      edit: async (_role, perms) => edits.push([id, perms.SendMessages]),
    },
  });
  const channels = [channel('general'), channel('vocal', ChannelType.GuildVoice), channel('regles', ChannelType.GuildText, true), channel('magi-logs')];
  const guild = { id: 'g-raid', ownerId: 'owner', roles: { everyone: { id: 'everyone' }, cache: new Map() }, channels: { cache: new Collection(channels.map((c) => [c.id, c])) } };
  setSetting(guild.id, 'raid_threshold', '5');
  setSetting(guild.id, 'log_channel:systeme', 'magi-logs');
  guild.channels.cache.get('magi-logs').id = 'magi-logs';
  const { db } = await import('../storage/db.js');
  db.query('INSERT INTO guilds (guild_id, operator_role_id, log_channel_id) VALUES (?, ?, ?)').run(guild.id, null, 'magi-logs');
  const alerts = [];
  const detach = addSink((e) => e.component === 'antiraid' && alerts.push(e));
  const join = (i) => trackJoin({ guild }, now + i * 1000);
  for (let i = 0; i < 4; i++) assert.equal(await join(i), false);
  assert.equal(await join(4), true);
  assert.deepEqual(edits, [['general', false]]);
  assert.equal(isLocked(guild, now + 60_000), true);
  assert.equal(alerts[0].level, 'alert');
  assert.equal(alerts[0].components[0].components[0].data.custom_id, 'magi-sec:deverrouiller');
  assert.equal(await unlock(guild, 'test'), 1);
  assert.deepEqual(edits.at(-1), ['general', null]);
  assert.equal(isLocked(guild, now + 60_000), false);
  detach();
});
