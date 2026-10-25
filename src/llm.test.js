import { test, beforeAll, afterAll, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';

let ollamaServer;
const calls = [];

beforeAll(() => {
  ollamaServer = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.json();
      const last = body.messages.at(-1).content;
      if (last === 'lent') await Bun.sleep(300);
      calls.push(`ollama:${last}`);
      if (body.format) return Response.json({ message: { content: JSON.stringify({ choix: 'casper' }) } });
      return Response.json({ message: { content: `ollama ${last}` } });
    },
  });
  process.env.OLLAMA_URL = `http://localhost:${ollamaServer.port}`;
});

afterAll(() => ollamaServer.stop());

beforeEach(() => {
  calls.length = 0;
});

let geminiResponse = () => Response.json({ choices: [{ message: { content: 'gemini ok' } }] });
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  if (String(url).startsWith('https://generativelanguage.googleapis.com')) {
    calls.push('gemini');
    return Promise.resolve(geminiResponse(JSON.parse(init.body)));
  }
  return realFetch(url, init);
};

const { chat, choose, LLMUnavailable } = await import('./llm.js');

test('Gemini répond en priorité quand une clé est configurée', async () => {
  process.env.GEMINI_API_KEY = 'test';
  assert.deepEqual(await chat({ messages: [{ role: 'user', content: 'a' }] }), { content: 'gemini ok', provider: 'gemini' });
  assert.deepEqual(calls, ['gemini']);
});

test('sortie imposée transmise à Gemini en json_schema', async () => {
  process.env.GEMINI_API_KEY = 'test';
  let sent;
  geminiResponse = (body) => {
    sent = body;
    return Response.json({ choices: [{ message: { content: '{"choix":"balthasar"}' } }] });
  };
  assert.equal(await choose({ messages: [{ role: 'user', content: 'b' }], choices: ['melchior', 'balthasar'] }), 'balthasar');
  assert.deepEqual(sent.response_format.json_schema.schema.properties.choix.enum, ['melchior', 'balthasar']);
});

test('quota Gemini épuisé : bascule sur Ollama, puis Gemini mis en pause', async () => {
  process.env.GEMINI_API_KEY = 'test';
  geminiResponse = () => new Response('quota', { status: 429 });
  assert.deepEqual(await chat({ messages: [{ role: 'user', content: 'c' }] }), { content: 'ollama c', provider: 'ollama' });
  assert.deepEqual(await chat({ messages: [{ role: 'user', content: 'd' }] }), { content: 'ollama d', provider: 'ollama' });
  assert.deepEqual(calls, ['gemini', 'ollama:c', 'ollama:d']);
});

test('sans clé Gemini : Ollama seul, appels en file', async () => {
  delete process.env.GEMINI_API_KEY;
  await Promise.all([
    chat({ messages: [{ role: 'user', content: 'lent' }] }),
    chat({ messages: [{ role: 'user', content: 'rapide' }] }),
  ]);
  assert.deepEqual(calls, ['ollama:lent', 'ollama:rapide']);
});

test('tout est injoignable : LLMUnavailable', async () => {
  delete process.env.GEMINI_API_KEY;
  const url = process.env.OLLAMA_URL;
  process.env.OLLAMA_URL = 'http://localhost:1';
  await assert.rejects(chat({ messages: [{ role: 'user', content: 'x' }] }), LLMUnavailable);
  process.env.OLLAMA_URL = url;
  await assert.rejects(chat({ messages: [{ role: 'user', content: 'lent' }], timeoutMs: 50 }), LLMUnavailable);
});
