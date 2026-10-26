import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Collection, PermissionFlagsBits, PermissionsBitField } from 'discord.js';

process.env.DB_PATH = ':memory:';
const { auditReport } = await import('./security.js');

const perms = (...flags) => new PermissionsBitField(flags);
const role = (id, name, permissions, managed = false) => ({ id, name, permissions, managed, members: { size: 2 } });

function guild({ everyone = perms(), roles = [], verificationLevel = 2, explicitContentFilter = 2, mfaLevel = 1, defaultMessageNotifications = 1 } = {}) {
  const all = [role('g', '@everyone', everyone), ...roles];
  return {
    id: 'g',
    roles: { everyone: all[0], cache: new Collection(all.map((r) => [r.id, r])) },
    channels: { cache: new Collection() },
    members: { me: { permissions: perms() } },
    verificationLevel,
    explicitContentFilter,
    mfaLevel,
    defaultMessageNotifications,
  };
}

test('un serveur bien réglé ne remonte rien', () => {
  assert.match(auditReport(guild()), /rien de préoccupant/);
});

test("l'audit relève @everyone, les rôles à risque et les réglages faibles", () => {
  const report = auditReport(
    guild({
      everyone: perms(PermissionFlagsBits.MentionEveryone),
      roles: [role('r', 'Staff', perms(PermissionFlagsBits.Administrator)), role('b', 'UnBot', perms(PermissionFlagsBits.BanMembers), true)],
      verificationLevel: 0,
    }),
  );
  assert.match(report, /@everyone a des permissions dangereuses : mentionner @everyone/);
  assert.match(report, /rôle Staff \(2 membre\(s\) connus\) : administrateur/);
  assert.match(report, /rôle d'intégration \(bot\) UnBot : bannir/);
  assert.match(report, /vérification faible/);
});
