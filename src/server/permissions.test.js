import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { LEVELS, atLeast, currentLevel, inviteUrl } from './permissions.js';

test('le niveau courant est le plus haut dont toutes les permissions sont accordées', () => {
  assert.equal(currentLevel(new PermissionsBitField()), null);
  assert.equal(currentLevel(new PermissionsBitField(LEVELS.discussion.perms)), 'discussion');
  assert.equal(currentLevel(new PermissionsBitField([...LEVELS.gestion.perms, PermissionFlagsBits.BanMembers])), 'gestion');
  assert.equal(currentLevel(new PermissionsBitField(PermissionFlagsBits.Administrator)), 'administrateur');
  assert.equal(atLeast(new PermissionsBitField(LEVELS.moderation.perms), 'gestion'), true);
  assert.equal(atLeast(new PermissionsBitField(LEVELS.discussion.perms), 'gestion'), false);
});

test("le lien d'autorisation cible le serveur et le niveau", () => {
  const url = new URL(inviteUrl('123', '456', 'discussion'));
  assert.equal(url.searchParams.get('guild_id'), '456');
  const granted = new PermissionsBitField(BigInt(url.searchParams.get('permissions')));
  assert.ok(granted.has(LEVELS.discussion.perms));
  assert.ok(granted.has(PermissionFlagsBits.SendPolls));
  assert.ok(!granted.has(PermissionFlagsBits.ManageEvents));
  assert.ok(new PermissionsBitField(BigInt(new URL(inviteUrl('123', '456', 'gestion')).searchParams.get('permissions'))).has([PermissionFlagsBits.ManageEvents, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.SendPolls]));
});
