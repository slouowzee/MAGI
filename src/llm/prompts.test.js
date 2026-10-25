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
