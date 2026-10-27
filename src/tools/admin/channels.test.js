import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';

process.env.DB_PATH = ':memory:';
const { CHANNEL_ADMIN_TOOLS } = await import('./channels.js');
const { setSetting } = await import('../../storage/settings.js');
const rename = CHANNEL_ADMIN_TOOLS.find((t) => t.name === 'renommer_salon');

const channel = (id, name) => ({ id, name, async setName(next) { this.name = next.replace(/\./g, ''); } });
const logs = channel('300000000000000001', 'magi-logs');
const general = channel('300000000000000002', 'general');
const guild = { id: 'g-renommage', ownerId: 'owner', channels: { cache: new Collection([logs, general].map((c) => [c.id, c])) } };
setSetting(guild.id, 'log_channel:systeme', logs.id);
const run = (memberId, salon, nom) => rename.run({ guild, member: { id: memberId }, message: { channel: general }, args: { salon, nom }, reason: 'test' });

test('salons de MAGI : seul le propriétaire peut les renommer', async () => {
  await assert.rejects(run('operateur', 'magi-logs', '📋・magi-logs'), /seul le propriétaire/);
  assert.equal(await run('owner', 'magi-logs', '📋・magi-logs'), '#magi-logs renommé en #📋・magi-logs.');
  assert.equal(await run('operateur', 'general', '💬・general'), '#general renommé en #💬・general.');
});

test('renommage sans effet ou transformé par Discord : signalé', async () => {
  assert.match(await run('owner', '💬・general', '💬・general.'), /Nom inchangé/);
  assert.equal(await run('owner', '💬・general', '.💬・general-2'), '#💬・general renommé en #💬・general-2 (Discord a transformé « .💬・general-2 »).');
});
