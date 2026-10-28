import { test } from 'bun:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { COMMANDS, statusReport, syncCommands } = await import('./commands.js');
const { setModules, MODULES } = await import('../../core/config.js');

test('commandes enregistrées selon le module, /magi, /ecrire et /clear toujours présentes', async () => {
  let sent = [];
  const guild = { id: 'g-commandes', commands: { set: async (list) => (sent = list) } };
  await syncCommands(guild);
  assert.deepEqual(sent.map((c) => c.name), ['Vérifier (Melchior)', 'Avis de Casper', 'Soutien de Balthasar', 'Résumer depuis ici', 'chuchoter', 'magi', 'ecrire', 'clear', 'profil', 'lookup', 'warn', 'mute', 'unmute', 'ban', 'unban', 'kick']);
  setModules(guild.id, Object.keys(MODULES).filter((m) => m !== 'commandes'));
  await syncCommands(guild);
  assert.deepEqual(sent.map((c) => c.name), ['magi', 'ecrire', 'clear', 'profil', 'lookup', 'warn', 'mute', 'unmute', 'ban', 'unban', 'kick']);
  assert.ok(COMMANDS.every((c) => c.data.name.length <= 32));
  const perms = Object.fromEntries(sent.map((c) => [c.name, c.default_member_permissions]));
  assert.deepEqual(perms, { magi: '32', ecrire: '32', clear: '8192', profil: null, lookup: '8192', warn: '8192', mute: '1099511627776', unmute: '1099511627776', ban: '4', unban: '4', kick: '2' });
  assert.ok(COMMANDS.every((c) => c.perms || c.tier in { membres: 1, moderation: 1, operateurs: 1 }));
});

test('statut des modèles lisible', () => {
  const now = Date.parse('2026-10-27T20:00:00Z');
  const report = statusReport(
    [
      { provider: 'gemini', model: 'gemini-3.5-flash-lite', paused: now + 4 * 60_000, ok: 12, fail: 3, latency: 14200, lastError: 'délai de 12 s dépassé' },
      { provider: 'groq', model: 'openai/gpt-oss-120b', paused: null, ok: 0, fail: 0, latency: null, lastError: null },
    ],
    now,
    3 * 3600 + 25 * 60,
  );
  assert.match(report, /gemini-3\.5-flash-lite\*\* \(gemini\) : en pause encore 4 min, 14\.2 s en moyenne, 12 réponse\(s\), 3 échec\(s\), dernier : délai de 12 s dépassé/);
  assert.match(report, /openai\/gpt-oss-120b\*\* \(groq\) : disponible, pas encore utilisé, 0 réponse\(s\)/);
  assert.match(report, /En ligne depuis 3 h 25 min\./);
});

test('les actions réservées sont annoncées au modèle pour qui ne peut pas les faire', async () => {
  const { deniedNote } = await import('../../tools.js');
  const member = { id: 'yui', displayName: 'Yui', guild: { id: 'g-droits', ownerId: 'slou', roles: { cache: new Map() } }, roles: { cache: new Map() }, permissions: { has: () => false } };
  const note = deniedNote(member);
  assert.match(note, /Yui n'a pas le droit/);
  assert.match(note, /publier/);
  assert.match(note, /opérateurs MAGI/);
});

test('clear : par paquets de 100, filtre MAGI, s’arrête aux messages de plus de 14 jours', async () => {
  const { fromMagi, sweep } = await import('./write.js');
  const now = Date.parse('2026-10-28T21:00:00Z');
  const messages = Array.from({ length: 250 }, (_, i) => ({ id: String(1000 - i), createdTimestamp: now - (i < 230 ? i * 60_000 : 20 * 86_400_000), author: { id: i % 2 ? 'slou' : 'magi' }, applicationId: null }));
  const removed = [];
  const channel = {
    messages: { fetch: async ({ before }) => new Map(messages.filter((m) => !before || Number(m.id) < Number(before)).slice(0, 100).map((m) => [m.id, m])) },
    bulkDelete: async (list) => {
      removed.push(...list.map((m) => m.id));
      return new Map(list.map((m) => [m.id, m]));
    },
  };
  assert.deepEqual(await sweep(channel, 150, () => true, now), { deleted: 150, old: 0 });
  removed.length = 0;
  assert.deepEqual(await sweep(channel, 1000, (m) => fromMagi(m, 'magi'), now), { deleted: 115, old: 10 });
  assert.ok(fromMagi({ author: { id: 'webhook' }, applicationId: 'magi' }, 'magi'));
});
