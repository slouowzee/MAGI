import { test, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';

const calls = [];

beforeEach(() => {
  calls.length = 0;
});

let geminiResponse = () => Response.json({ choices: [{ message: { content: 'gemini ok' } }] });
const realFetch = globalThis.fetch;
const ok = (content) => Response.json({ choices: [{ message: { content } }] });
globalThis.fetch = (url, init) => {
  if (String(url).startsWith('https://generativelanguage.googleapis.com')) {
    calls.push('gemini');
    return new Promise((resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal.reason));
      Promise.resolve(geminiResponse(JSON.parse(init.body))).then(resolve);
    });
  }
  return realFetch(url, init);
};

const { chat, choose, LLMUnavailable } = await import('./client.js');

test('Gemini répond en priorité quand une clé est configurée', async () => {
  process.env.GEMINI_API_KEY = 'test';
  const r = await chat({ messages: [{ role: 'user', content: 'a' }] });
  assert.deepEqual([r.content, r.model, r.toolCalls], ['gemini ok', 'gemini-3.5-flash-lite', []]);
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

test('un modèle Gemini saturé ne bloque pas le modèle par défaut', async () => {
  process.env.GEMINI_API_KEY = 'test';
  const seen = [];
  geminiResponse = (body) => {
    seen.push(body.model);
    return body.model === 'gros-modele' ? new Response('saturé', { status: 503 }) : Response.json({ choices: [{ message: { content: 'lite ok' } }] });
  };
  process.env.GEMINI_MODEL = 'modele-lite';
  const r = await chat({ messages: [{ role: 'user', content: 'p' }], model: 'gros-modele' });
  assert.deepEqual([r.content, r.model], ['lite ok', 'modele-lite']);
  await chat({ messages: [{ role: 'user', content: 'q' }], model: 'gros-modele' });
  assert.deepEqual(seen, ['gros-modele', 'modele-lite', 'modele-lite']);
  delete process.env.GEMINI_MODEL;
});

test('réponse bloquée par le filtre de Gemini : pas de nouvel essai', async () => {
  process.env.GEMINI_API_KEY = 'test';
  const { ContentRefused } = await import('./client.js');
  geminiResponse = () => Response.json({ choices: [{ finish_reason: 'content_filter', message: { role: 'assistant' } }] });
  await assert.rejects(chat({ messages: [{ role: 'user', content: 'insulte' }], model: 'modele-filtre' }), ContentRefused);
  assert.deepEqual(calls, ['gemini']);
  geminiResponse = () => Response.json({ choices: [{ message: { content: 'gemini ok' } }] });
});

test('média refusé par Gemini : nouvel essai sans les vidéos, puis sans aucun média', async () => {
  process.env.GEMINI_API_KEY = 'test';
  const seen = [];
  geminiResponse = (body) => {
    const media = body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((p) => p.type === 'image_url');
    seen.push(media.map((p) => p.image_url.url.slice(5, 10)));
    return media.length ? new Response('[{\n  "error": { "code": 400 } }]', { status: 400 }) : Response.json({ choices: [{ message: { content: 'vu' } }] });
  };
  const content = [
    { type: 'text', text: 'regarde' },
    { type: 'image_url', image_url: { url: 'data:video/mp4;base64,AAAA' } },
    { type: 'image_url', image_url: { url: 'data:image/webp;base64,AAAA' } },
  ];
  const r = await chat({ messages: [{ role: 'user', content }], model: 'modele-media' });
  assert.deepEqual([r.content, r.model], ['vu', 'modele-media']);
  assert.deepEqual(seen, [['video', 'image'], ['image'], []]);
  geminiResponse = () => Response.json({ choices: [{ message: { content: 'gemini ok' } }] });
});

test('modèle Gemini trop lent : le modèle de secours répond, puis prend le relais', async () => {
  process.env.GEMINI_API_KEY = 'test';
  process.env.GEMINI_MODEL = 'modele-lent';
  process.env.GEMINI_BACKUP_MODEL = 'modele-secours';
  const seen = [];
  geminiResponse = async (body) => {
    seen.push(body.model);
    if (body.model === 'modele-lent') await Bun.sleep(300);
    return Response.json({ choices: [{ message: { content: body.model } }] });
  };
  const a = await chat({ messages: [{ role: 'user', content: 'a' }], timeoutMs: 600 });
  const b = await chat({ messages: [{ role: 'user', content: 'b' }], timeoutMs: 600 });
  assert.deepEqual([a.content, b.content], ['modele-secours', 'modele-secours']);
  assert.deepEqual(seen, ['modele-lent', 'modele-secours', 'modele-secours']);
  delete process.env.GEMINI_MODEL;
  delete process.env.GEMINI_BACKUP_MODEL;
  geminiResponse = () => Response.json({ choices: [{ message: { content: 'gemini ok' } }] });
});

test('surcharge passagère de Gemini : nouvel essai quelques secondes plus tard', async () => {
  process.env.GEMINI_API_KEY = 'test';
  process.env.GEMINI_MODEL = 'surcharge-a';
  process.env.GEMINI_BACKUP_MODEL = 'surcharge-b';
  const seen = [];
  geminiResponse = (body) => {
    seen.push(body.model);
    return seen.length <= 2 ? new Response('high demand', { status: 503 }) : ok('enfin');
  };
  const r = await chat({ messages: [{ role: 'user', content: 'r' }] });
  assert.deepEqual([r.content, r.model], ['enfin', 'surcharge-a']);
  assert.deepEqual(seen, ['surcharge-a', 'surcharge-b', 'surcharge-a']);
  delete process.env.GEMINI_MODEL;
  delete process.env.GEMINI_BACKUP_MODEL;
  geminiResponse = () => ok('gemini ok');
});

test('quota épuisé sur tous les modèles : LLMUnavailable une fois le délai écoulé', async () => {
  process.env.GEMINI_API_KEY = 'test';
  process.env.GEMINI_MODEL = 'quota-a';
  process.env.GEMINI_BACKUP_MODEL = 'quota-b';
  geminiResponse = () => new Response('quota', { status: 429 });
  await assert.rejects(chat({ messages: [{ role: 'user', content: 'q' }], timeoutMs: 1_000 }), LLMUnavailable);
  assert.deepEqual(calls, ['gemini', 'gemini']);
  delete process.env.GEMINI_MODEL;
  delete process.env.GEMINI_BACKUP_MODEL;
  geminiResponse = () => ok('gemini ok');
});

test('sans clé Gemini : LLMUnavailable', async () => {
  delete process.env.GEMINI_API_KEY;
  await assert.rejects(chat({ messages: [{ role: 'user', content: 'x' }] }), LLMUnavailable);
  assert.deepEqual(calls, []);
});
