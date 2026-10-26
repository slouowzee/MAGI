import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';

process.env.DB_PATH = ':memory:';
const { ROLE_PANEL_TOOLS } = await import('./role-panels.js');
const [tool] = ROLE_PANEL_TOOLS;

const role = (id, name, perms = []) => ({ id, name, managed: false, position: 1, permissions: new PermissionsBitField(perms), toString: () => `@${name}` });
const roles = [role('100000000000000001', 'Gamer'), role('100000000000000002', 'Modo', [PermissionFlagsBits.BanMembers])];
const guild = {
  id: 'g',
  roles: { cache: { get: (id) => roles.find((r) => r.id === id), find: (fn) => roles.find(fn) } },
  members: { me: { roles: { highest: { position: 10 } } } },
};

test('un panneau refuse les rôles qui donnent des permissions de gestion', () => {
  assert.match(tool.preview({ guild, args: { roles: ['Gamer'] } }).data.description, /@Gamer/);
  assert.throws(() => tool.preview({ guild, args: { roles: ['Gamer', 'Modo'] } }), /libre-service/);
});
