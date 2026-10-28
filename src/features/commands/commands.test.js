import { test } from 'bun:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { COMMANDS, statusReport, syncCommands } = await import('./commands.js');
const { setModules, MODULES } = await import('../../core/config.js');

test('commandes enregistrées selon le module, /magi, /ecrire et /clear toujours présentes', async () => {
  let sent = [];
  const guild = { id: 'g-commandes', commands: { set: async (list) => (sent = list) } };
  await syncCommands(guild);
  assert.deepEqual(sent.map((c) => c.name), ['Vérifier (Melchior)', 'Avis de Casper', 'Soutien de Balthasar', 'Résumer depuis ici', 'chuchoter', 'magi', 'ecrire', 'clear']);
  setModules(guild.id, Object.keys(MODULES).filter((m) => m !== 'commandes'));
  await syncCommands(guild);
  assert.deepEqual(sent.map((c) => c.name), ['magi', 'ecrire', 'clear']);
  assert.ok(COMMANDS.every((c) => c.data.name.length <= 32));
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
