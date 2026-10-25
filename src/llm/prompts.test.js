import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { cleanReply } from './prompts.js';

test('retire les emojis et les émoticônes', () => {
  assert.equal(cleanReply('Sushi, évidemment 🍣😏 !'), 'Sushi, évidemment !');
  assert.equal(cleanReply('Ça marche 👍🏽 :)'), 'Ça marche');
  assert.equal(cleanReply('Je suis là 🫂.'), 'Je suis là.');
  assert.equal(cleanReply('❤️ courage'), 'courage');
});

test('garde le texte, la ponctuation et le code intacts', () => {
  assert.equal(cleanReply('Réponse : 42. Ensuite ?'), 'Réponse : 42. Ensuite ?');
  assert.equal(cleanReply('```py\nd = {"a": 1}\nprint(d["b"])\n```'), '```py\nd = {"a": 1}\nprint(d["b"])\n```');
});

test("date et heure de Paris fournies au modèle", async () => {
  const { nowLine } = await import('./prompts.js');
  assert.equal(nowLine(new Date('2026-10-25T18:30:00Z')), 'Nous sommes le dimanche 25 octobre 2026 à 19:30, heure de Paris (UTC+01:00).');
  assert.match(nowLine(new Date('2026-07-14T10:00:00Z')), /12:00, heure de Paris \(UTC\+02:00\)/);
});
