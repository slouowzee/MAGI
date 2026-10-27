import { test, beforeEach, setSystemTime } from 'bun:test';
import assert from 'node:assert/strict';

const calls = [];

beforeEach(() => {
  calls.length = 0;
});

let geminiResponse = () => Response.json({ choices: [{ message: { content: 'gemini ok' } }] });
const realFetch = globalThis.fetch;
const ok = (content) => Response.json({ choices: [{ message: { content } }] });
const others = [];
let otherResponse = (url) => ok(String(url).includes('mistral') ? 'mistral ok' : 'groq ok');
globalThis.fetch = (url, init) => {
  if (/api\.(mistral\.ai|groq\.com)/.test(String(url))) {
    const body = JSON.parse(init.body);
    others.push({ url: String(url), body });
    calls.push(String(url).includes('mistral') ? 'mistral' : 'groq');
    return Promise.resolve(otherResponse(url, body));
  }
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

test('un modèle qui échoue encore est mis en pause plus longtemps', async () => {
  process.env.GEMINI_API_KEY = 'test';
  process.env.GEMINI_MODEL = 'sature-a';
  process.env.GEMINI_BACKUP_MODEL = 'stable-b';
  const seen = [];
  geminiResponse = (body) => {
    seen.push(body.model);
    return body.model === 'sature-a' ? new Response('high demand', { status: 503 }) : ok('b');
  };
  let now = Date.parse('2026-10-26T12:00:00Z');
  for (const step of [0, 61_000, 61_000, 70_000]) {
    setSystemTime((now += step));
    await chat({ messages: [{ role: 'user', content: 'x' }] });
  }
  setSystemTime();
  assert.deepEqual(seen, ['sature-a', 'stable-b', 'sature-a', 'stable-b', 'stable-b', 'sature-a', 'stable-b']);
  delete process.env.GEMINI_MODEL;
  delete process.env.GEMINI_BACKUP_MODEL;
  geminiResponse = () => ok('gemini ok');
});

test('Gemini saturé : Mistral puis Groq prennent le relais, chacun avec ce qu’il sait lire', async () => {
  process.env.GEMINI_API_KEY = 'test';
  process.env.GEMINI_MODEL = 'plein-a';
  process.env.GEMINI_BACKUP_MODEL = 'plein-b';
  process.env.MISTRAL_API_KEY = 'test';
  process.env.GROQ_API_KEY = 'test';
  others.length = 0;
  geminiResponse = () => new Response('high demand', { status: 503 });
  const content = [
    { type: 'text', text: 'regarde' },
    { type: 'image_url', image_url: { url: 'data:video/mp4;base64,AAAA' } },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
  ];
  const history = [
    { role: 'user', content },
    { role: 'assistant', content: '', tool_calls: [{ id: 'call_tres_long_1', type: 'function', function: { name: 'x', arguments: '{}' }, extra_content: { google: { thought_signature: 's' } } }] },
    { role: 'tool', tool_call_id: 'call_tres_long_1', name: 'x', content: 'fait' },
  ];
  const r = await chat({ messages: history, options: { num_predict: 200 } });
  assert.deepEqual([r.content, r.model], ['mistral ok', 'mistral-small-latest']);
  const mistral = others[0].body;
  assert.deepEqual(mistral.messages[0].content.map((p) => p.type), ['text', 'text', 'image_url']);
  assert.equal(mistral.messages[1].tool_calls[0].extra_content, undefined);
  assert.match(mistral.messages[1].tool_calls[0].id, /^[0-9a-z]{9}$/);
  assert.equal(mistral.messages[2].tool_call_id, mistral.messages[1].tool_calls[0].id);
  otherResponse = (url) => (String(url).includes('mistral') ? new Response('limite', { status: 429 }) : ok('groq ok'));
  const g = await chat({ messages: [{ role: 'user', content }], options: { num_predict: 200 } });
  assert.deepEqual([g.content, g.model], ['groq ok', 'openai/gpt-oss-120b']);
  const groq = others.at(-1).body;
  assert.deepEqual(groq.messages[0].content.map((p) => p.type), ['text', 'text', 'text']);
  assert.deepEqual([groq.reasoning_effort, groq.include_reasoning, groq.max_tokens], ['low', false, 1224]);
  for (const key of ['GEMINI_MODEL', 'GEMINI_BACKUP_MODEL', 'MISTRAL_API_KEY', 'GROQ_API_KEY']) delete process.env[key];
  otherResponse = (url) => ok(String(url).includes('mistral') ? 'mistral ok' : 'groq ok');
  geminiResponse = () => ok('gemini ok');
});

test('appel d’outil venu d’un autre fournisseur : signature factice pour Gemini', async () => {
  process.env.GEMINI_API_KEY = 'test';
  let sent;
  geminiResponse = (body) => {
    sent = body;
    return ok('résumé');
  };
  await chat({
    model: 'modele-signature',
    messages: [
      { role: 'user', content: 'résume' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'fc_1', type: 'function', function: { name: 'resumer', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'fc_1', name: 'resumer', content: 'slou : salut' },
    ],
  });
  assert.deepEqual(sent.messages[1].tool_calls[0].extra_content, { google: { thought_signature: 'skip_thought_signature_validator' } });
  geminiResponse = () => ok('gemini ok');
});

test('Groq : outils retirés si la requête dépasse sa limite, refus sans pause si elle reste trop grosse', async () => {
  process.env.GROQ_API_KEY = 'test';
  delete process.env.GEMINI_API_KEY;
  others.length = 0;
  const tools = [{ type: 'function', function: { name: 'outil', description: 'x'.repeat(25_000), parameters: { type: 'object', properties: {} } } }];
  const r = await chat({ messages: [{ role: 'user', content: 'salut' }], tools, options: { num_predict: 200 } });
  assert.equal(r.content, 'groq ok');
  assert.equal(others.at(-1).body.tools, undefined);
  await assert.rejects(chat({ messages: [{ role: 'user', content: 'y'.repeat(40_000) }], options: { num_predict: 200 } }), /requête trop grosse/);
  const again = await chat({ messages: [{ role: 'user', content: 'encore' }], options: { num_predict: 200 } });
  assert.equal(again.content, 'groq ok');
  delete process.env.GROQ_API_KEY;
});

test('erreur de quota Groq : limite lisible dans le message', async () => {
  process.env.GROQ_API_KEY = 'test';
  delete process.env.GEMINI_API_KEY;
  otherResponse = () => Response.json({ error: { message: 'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 6500, Requested 4200. Please try again in 20s.', type: 'tokens', code: 'rate_limit_exceeded' } }, { status: 429 });
  await assert.rejects(chat({ messages: [{ role: 'user', content: 'q' }], timeoutMs: 1_000 }), (err) => err.message === 'HTTP 429 rate_limit_exceeded tokens per minute (TPM), limite 8000, utilisé 6500, demandé 4200');
  otherResponse = (url) => ok(String(url).includes('mistral') ? 'mistral ok' : 'groq ok');
  delete process.env.GROQ_API_KEY;
});
