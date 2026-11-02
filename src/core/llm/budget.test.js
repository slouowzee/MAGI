import { test } from 'bun:test';
import assert from 'node:assert/strict';

process.env.GUILD_LLM_PER_HOUR = '2';
const { forGuild, spend } = await import('./budget.js');

test('quota horaire par serveur, sans limite hors serveur', () => {
  const guild = { id: 'quota', ownerId: 'quelqu-un' };
  assert.deepEqual(forGuild(guild, () => [spend(0), spend(1), spend(2)]), [true, true, false]);
  assert.equal(forGuild({ id: 'autre', ownerId: 'x' }, () => spend(3)), true);
  assert.equal(forGuild(guild, () => spend(60 * 60_000 + 1)), true);
  assert.equal(spend(4), true);
});
