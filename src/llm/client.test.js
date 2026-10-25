import { test, beforeAll, afterAll, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';

let ollamaServer;
let lastOllamaBody;
const calls = [];

beforeAll(() => {
  ollamaServer = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.json();
      const last = body.messages.at(-1).content;
      if (last === 'lent') await Bun.sleep(300);
      calls.push(`ollama:${last}`);
      lastOllamaBody = body;
      if (last === 'outil') return Response.json({ message: { content: '', tool_calls: [{ function: { name: 'installer_magi', arguments: {} } }] } });
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

const { chat, choose, LLMUnavailable } = await import('./client.js');

test('Gemini répond en priorité quand une clé est configurée', async () => {
  process.env.GEMINI_API_KEY = 'test';
  const r = await chat({ messages: [{ role: 'user', content: 'a' }] });
  assert.deepEqual([r.content, r.provider, r.toolCalls], ['gemini ok', 'gemini', []]);
  assert.deepEqual(calls, ['gemini']);
});

test('appel d’outil par Gemini : signature conservée pour le tour suivant', async () => {
  process.env.GEMINI_API_KEY = 'test';
  const toolCall = { id: 'call_1', type: 'function', function: { name: 'installer_magi', arguments: '{"force":true}' }, extra_content: { google: { thought_signature: 'sig' } } };
  geminiResponse = () => Response.json({ choices: [{ message: { role: 'assistant', tool_calls: [toolCall] } }] });
  const r = await chat({ messages: [{ role: 'user', content: 'installe-toi' }], tools: [{ type: 'function', function: { name: 'installer_magi' } }] });
  assert.deepEqual(r.toolCalls, [{ id: 'call_1', name: 'installer_magi', args: { force: true } }]);
  assert.equal(r.message.tool_calls[0].extra_content.google.thought_signature, 'sig');
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
  const c = await chat({ messages: [{ role: 'user', content: 'c' }] });
  const d = await chat({ messages: [{ role: 'user', content: 'd' }] });
  assert.deepEqual([c.content, c.provider, d.content, d.provider], ['ollama c', 'ollama', 'ollama d', 'ollama']);
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

test('appel d’outil par Ollama : formats convertis dans les deux sens', async () => {
  delete process.env.GEMINI_API_KEY;
  const r = await chat({
    messages: [
      { role: 'assistant', content: '', tool_calls: [{ id: 'x', type: 'function', function: { name: 'installer_magi', arguments: '{"a":1}' } }] },
      { role: 'tool', tool_call_id: 'x', name: 'installer_magi', content: 'fait' },
      { role: 'user', content: 'outil' },
    ],
  });
  assert.deepEqual(lastOllamaBody.messages[0].tool_calls, [{ function: { name: 'installer_magi', arguments: { a: 1 } } }]);
  assert.deepEqual(lastOllamaBody.messages[1], { role: 'tool', content: 'fait', tool_name: 'installer_magi' });
  assert.equal(r.toolCalls[0].name, 'installer_magi');
  assert.equal(r.message.tool_calls[0].function.arguments, '{}');
});

test('un modèle Gemini saturé ne bloque pas le modèle par défaut', async () => {
  process.env.GEMINI_API_KEY = 'test';
  const seen = [];
  geminiResponse = (body) => {
    seen.push(body.model);
    return body.model === 'gros-modele' ? new Response('saturé', { status: 503 }) : Response.json({ choices: [{ message: { content: 'lite ok' } }] });
  };
  process.env.GEMINI_MODEL = 'modele-lite';
  const r = await chat({ messages: [{ role: 'user', content: 'p' }], model: 'gros-modele' });
  assert.deepEqual([r.content, r.provider], ['lite ok', 'gemini']);
  await chat({ messages: [{ role: 'user', content: 'q' }], model: 'gros-modele' });
  assert.deepEqual(seen, ['gros-modele', 'modele-lite', 'modele-lite']);
  delete process.env.GEMINI_MODEL;
});
