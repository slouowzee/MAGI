import { test, beforeAll, afterAll } from 'bun:test';
import assert from 'node:assert/strict';
import { chat, choose, OllamaUnavailable } from './ollama.js';

let server;
const order = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.json();
      const last = body.messages.at(-1).content;
      if (last === 'lent') await Bun.sleep(300);
      order.push(last);
      if (body.format) return Response.json({ message: { content: JSON.stringify({ choix: 'casper' }) } });
      if (!body.stream) return Response.json({ message: { content: `écho ${last}` } });
      const lines = ['Bon', 'jour', ' !'].map((c) => JSON.stringify({ message: { content: c } })).join('\n') + '\n';
      return new Response(lines);
    },
  });
  process.env.OLLAMA_URL = `http://localhost:${server.port}`;
});

afterAll(() => server.stop());

test('réponse complète', async () => {
  assert.equal(await chat({ messages: [{ role: 'user', content: 'a' }] }), 'écho a');
});

test('streaming : jetons reçus un par un puis texte complet', async () => {
  const pieces = [];
  const text = await chat({ messages: [{ role: 'user', content: 'b' }], onToken: (p) => pieces.push(p) });
  assert.deepEqual(pieces, ['Bon', 'jour', ' !']);
  assert.equal(text, 'Bonjour !');
});

test('choix contraint', async () => {
  assert.equal(await choose({ messages: [{ role: 'user', content: 'c' }], choices: ['melchior', 'casper'] }), 'casper');
});

test('file unique : les appels passent dans l’ordre', async () => {
  order.length = 0;
  await Promise.all([
    chat({ messages: [{ role: 'user', content: 'lent' }] }),
    chat({ messages: [{ role: 'user', content: 'rapide' }] }),
  ]);
  assert.deepEqual(order, ['lent', 'rapide']);
});

test('Ollama injoignable ou trop lent', async () => {
  await assert.rejects(chat({ messages: [{ role: 'user', content: 'lent' }], timeoutMs: 50 }), OllamaUnavailable);
  const url = process.env.OLLAMA_URL;
  process.env.OLLAMA_URL = 'http://localhost:1';
  await assert.rejects(chat({ messages: [{ role: 'user', content: 'x' }] }), OllamaUnavailable);
  process.env.OLLAMA_URL = url;
});
