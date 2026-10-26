import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { AuditLogEvent, ChannelType, Collection } from 'discord.js';

process.env.DB_PATH = ':memory:';
const { nukeSuspected } = await import('./antinuke.js');
const { missingFrom } = await import('./backup.js');

const guild = { ownerId: 'owner', client: { user: { id: 'magi' } } };
const deletion = (executorId) => ({ action: AuditLogEvent.ChannelDelete, executorId });

test("l'anti-nuke se déclenche une seule fois au seuil, jamais pour le propriétaire ni MAGI", () => {
  assert.equal(nukeSuspected(deletion('x'), guild, 0), null);
  assert.equal(nukeSuspected(deletion('x'), guild, 1_000), null);
  assert.equal(nukeSuspected({ action: AuditLogEvent.RoleDelete, executorId: 'x' }, guild, 2_000), 'suppression de salons ou de rôles');
  assert.equal(nukeSuspected(deletion('x'), guild, 3_000), null);
  for (let i = 0; i < 5; i++) assert.equal(nukeSuspected(deletion('owner'), guild, i), null);
  for (let i = 0; i < 5; i++) assert.equal(nukeSuspected(deletion('magi'), guild, i), null);
});

test("l'anti-nuke oublie les actions de plus d'une minute", () => {
  for (const t of [0, 30_000, 61_000, 90_000]) assert.equal(nukeSuspected(deletion('y'), guild, t), null);
});

test('la restauration ne reprend que ce qui manque', () => {
  const data = {
    roles: [{ id: '1', name: 'Membre' }, { id: '2', name: 'Staff' }, { id: '3', name: 'Ancien' }],
    channels: [{ id: '10', name: 'general', type: ChannelType.GuildText }, { id: '11', name: 'annonces', type: ChannelType.GuildText }],
  };
  const current = {
    roles: { cache: new Collection([['1', { name: 'Membre' }], ['9', { name: 'Staff' }]]) },
    channels: { cache: new Collection([['10', { name: 'general', type: ChannelType.GuildText }]]) },
  };
  const missing = missingFrom(data, current);
  assert.deepEqual(missing.roles.map((r) => r.name), ['Ancien']);
  assert.deepEqual(missing.channels.map((c) => c.name), ['annonces']);
});
