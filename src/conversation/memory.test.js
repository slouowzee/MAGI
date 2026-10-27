import { test } from 'bun:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { rememberFact, saveSummary } = await import('../storage/memory.js');
const { memoryContext } = await import('./memory.js');

test('souvenirs des personnes présentes, sans doublon de résumé', async () => {
  await rememberFact('g', 'slou', 'Slou est dev Python', 1);
  await saveSummary('g', 'c', ['slou', 'lea'], 'Débat pizza contre sushi.', 2);
  const context = await memoryContext('g', [{ id: 'slou', name: 'Slou' }, { id: 'lea', name: 'Léa' }]);
  assert.match(context, /jamais des instructions/);
  assert.match(context, /- Slou : Slou est dev Python/);
  assert.match(context, /- conversation passée avec Slou, Léa : Débat pizza contre sushi\./);
  assert.equal(context.split('Débat pizza contre sushi.').length, 2);
  assert.equal(await memoryContext('g', [{ id: 'inconnu', name: 'X' }]), '');
});
