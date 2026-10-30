import { log } from '../log/log.js';

export class LLMUnavailable extends Error {}
export class ContentRefused extends Error {}

const COOLDOWN = 60_000;
const MAX_COOLDOWN = 30 * 60_000;
const STAGGER = 5_000;
const RETRY_DELAYS = [2_000, 5_000];

const PROVIDERS = {
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    key: 'GEMINI_API_KEY',
    models: () => [process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite', process.env.GEMINI_BACKUP_MODEL || 'gemini-3.1-flash-lite'],
    media: 'video',
  },
  mistral: {
    url: 'https://api.mistral.ai/v1/chat/completions',
    key: 'MISTRAL_API_KEY',
    models: () => [process.env.MISTRAL_MODEL || 'mistral-small-latest'],
    media: 'image',
    shortToolIds: true,
  },
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    key: 'GROQ_API_KEY',
    models: () => [process.env.GROQ_MODEL || 'openai/gpt-oss-120b'],
    media: 'none',
    maxTokens: 7_000,
    thinking: (model) => (model.includes('gpt-oss') ? { body: { reasoning_effort: 'low', include_reasoning: false }, tokens: 1024 } : null),
  },
};

const pausedUntil = new Map();
const strikes = new Map();
const debugState = { forced: null, lastCall: null };

export function clearPauses() {
  pausedUntil.clear();
  strikes.clear();
  notify();
}

export function forceProvider(name) {
  if (name && !PROVIDERS[name]) throw new Error(`fournisseur inconnu : ${name}`);
  debugState.forced = name || null;
  return debugState.forced;
}

export const forcedProvider = () => debugState.forced;

export function simulateOutage(provider, ms) {
  for (const model of PROVIDERS[provider].models()) pausedUntil.set(`${provider}/${model}`, Date.now() + ms);
  notify();
}

export const lastCall = () => debugState.lastCall;

function pause(id) {
  const count = (strikes.get(id) ?? 0) + 1;
  strikes.set(id, count);
  pausedUntil.set(id, Date.now() + Math.min(COOLDOWN * 2 ** (count - 1), MAX_COOLDOWN));
}

export const forReply = () => ({ model: process.env.GEMINI_REPLY_MODEL || 'gemini-3.5-flash', reasoning: 'none' });
export const activeProviders = () => Object.keys(PROVIDERS).filter((name) => process.env[PROVIDERS[name].key]);
const stats = new Map();
const listeners = new Set();
let busy = 0;

function track(id, outcome) {
  const s = stats.get(id) ?? { ok: 0, fail: 0, latency: null, lastError: null, lastAt: null };
  if (outcome.ms !== undefined) {
    s.ok++;
    s.latency = s.latency === null ? outcome.ms : Math.round(s.latency * 0.7 + outcome.ms * 0.3);
  } else {
    s.fail++;
    s.lastError = outcome.error;
  }
  s.lastAt = Date.now();
  stats.set(id, s);
}

function notify() {
  for (const fn of listeners) fn({ busy, status: llmStatus() });
}

export function onLlmActivity(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function llmStatus(now = Date.now()) {
  return activeProviders().flatMap((name) =>
    PROVIDERS[name].models().map((model) => {
      const id = `${name}/${model}`;
      const until = pausedUntil.get(id) ?? 0;
      return { provider: name, model, paused: until > now ? until : null, strikes: strikes.get(id) ?? 0, ...(stats.get(id) ?? { ok: 0, fail: 0, latency: null, lastError: null, lastAt: null }) };
    }),
  );
}

export const llmChain = () => activeProviders().map((name) => `${name} (${PROVIDERS[name].models().join(', ')})`).join(' → ');

async function post(url, headers, body, timeoutMs, signal) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err.name === 'TimeoutError';
    throw Object.assign(new LLMUnavailable(timedOut ? `délai de ${Math.round(timeoutMs / 100) / 10} s dépassé` : err.message), { timedOut });
  }
  if (!res.ok) {
    const body = await res.text();
    let detail;
    try {
      const parsed = JSON.parse(body);
      const error = (Array.isArray(parsed) ? parsed[0] : parsed)?.error;
      const limit = error?.message?.match(/\bon ([^:`]+): Limit (\d+), Used (\d+), Requested (\d+)/);
      detail = [error?.status ?? error?.code, limit && `${limit[1]}, limite ${limit[2]}, utilisé ${limit[3]}, demandé ${limit[4]}`].filter(Boolean).join(' ') || undefined;
    } catch {}
    const error = new LLMUnavailable(`HTTP ${res.status} ${detail ?? body.replace(/\s+/g, ' ').slice(0, 120)}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

const isMedia = (p) => p.type === 'image_url';
const isVideo = (p) => isMedia(p) && /^data:(?:video|audio)\//.test(p.image_url.url);

function hideMedia(messages, hidden) {
  let found = false;
  const out = messages.map((m) => {
    if (!Array.isArray(m.content)) return m;
    return {
      ...m,
      content: m.content.map((p) => {
        if (!hidden(p)) return p;
        found = true;
        return { type: 'text', text: '(impossible à afficher, tu ne la vois pas)' };
      }),
    };
  });
  return found && out;
}

const shortId = (id) => Bun.hash(String(id)).toString(36).padStart(9, '0').slice(-9);

const FOREIGN_SIGNATURE = { google: { thought_signature: 'skip_thought_signature_validator' } };

function forProvider(provider, messages) {
  const keepSignature = provider.media === 'video';
  let out = messages.map(({ name, ...m }) => (m.tool_calls ? { ...m, tool_calls: m.tool_calls.map(({ extra_content, ...c }) => (keepSignature ? { ...c, extra_content: extra_content ?? FOREIGN_SIGNATURE } : c)) } : m));
  if (provider.media === 'image') out = hideMedia(out, isVideo) || out;
  if (provider.media === 'none') out = hideMedia(out, isMedia) || out;
  if (provider.shortToolIds) {
    out = out.map((m) => {
      if (m.tool_calls) return { ...m, tool_calls: m.tool_calls.map((c) => ({ ...c, id: shortId(c.id) })) };
      return m.role === 'tool' ? { ...m, tool_call_id: shortId(m.tool_call_id) } : m;
    });
  }
  return out;
}

async function complete(name, { messages, format, options = {}, tools, model, reasoning, timeoutMs, signal }) {
  const provider = PROVIDERS[name];
  const thinking = provider.thinking?.(model);
  const body = {
    model,
    messages: forProvider(provider, messages),
    max_tokens: options.num_predict ? options.num_predict + (thinking?.tokens ?? 0) : undefined,
    temperature: options.temperature,
    ...thinking?.body,
  };
  if (format) body.response_format = { type: 'json_schema', json_schema: { name: 'reponse', schema: format } };
  if (reasoning && name === 'gemini') body.reasoning_effort = reasoning;
  if (tools?.length) body.tools = tools;
  const size = (b) => Math.ceil(JSON.stringify(b).length / 3.5) + (b.max_tokens ?? 0);
  if (provider.maxTokens && size(body) > provider.maxTokens) {
    while (body.tools?.length && size(body) > provider.maxTokens) body.tools = body.tools.slice(0, -1);
    if (!body.tools?.length) delete body.tools;
    if (size(body) > provider.maxTokens) throw Object.assign(new LLMUnavailable(`requête trop grosse (≈${size(body)} tokens, limite ${provider.maxTokens})`), { status: 413 });
  }
  const data = await post(provider.url, { Authorization: `Bearer ${process.env[provider.key]}` }, body, timeoutMs, signal);
  const choice = data.choices?.[0];
  const message = choice?.message;
  if (choice?.finish_reason === 'content_filter') throw new ContentRefused(`réponse bloquée par le filtre de ${name}`);
  if (!message || (typeof message.content !== 'string' && !message.tool_calls?.length)) throw new LLMUnavailable(`réponse vide (${choice?.finish_reason ?? 'sans motif'})`);
  return { role: 'assistant', content: message.content ?? '', ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) };
}

async function withMedia(name, args) {
  try {
    return await complete(name, args);
  } catch (err) {
    const lighter = err.status === 400 && (hideMedia(args.messages, isVideo) || hideMedia(args.messages, isMedia));
    if (!lighter) throw err;
    log.info('llm', `${args.model} : média refusé (${err.message}), renvoi sans`);
    return withMedia(name, { ...args, messages: lighter });
  }
}

function result(message, model) {
  const toolCalls = (message.tool_calls ?? []).map((c) => {
    let args = {};
    try {
      args = JSON.parse(c.function.arguments || '{}');
    } catch {}
    return { id: c.id, name: c.function.name, args };
  });
  return { content: message.content, toolCalls, message, model };
}

function candidates(model) {
  const all = [];
  for (const name of activeProviders().filter((p) => !debugState.forced || p === debugState.forced)) {
    const models = name === 'gemini' && model ? [model, ...PROVIDERS.gemini.models()] : PROVIDERS[name].models();
    for (const m of new Set(models)) all.push({ provider: name, model: m, id: `${name}/${m}` });
  }
  const awake = all.filter((c) => Date.now() >= (pausedUntil.get(c.id) ?? 0));
  return awake.length ? awake : all;
}

function race(list, args, deadline, stagger) {
  return new Promise((resolve) => {
    const running = new Map();
    let next = 0;
    let done = false;
    let failure = null;
    let transient = false;
    let timer = null;
    const finish = (outcome) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const { controller } of running.values()) controller.abort();
      resolve(outcome);
    };
    const settle = () => {
      if (!running.size && next >= list.length) finish({ failure, transient });
    };
    const launch = () => {
      clearTimeout(timer);
      if (done || next >= list.length) return settle();
      const candidate = list[next++];
      const left = deadline - Date.now();
      if (left <= 0) return settle();
      const controller = new AbortController();
      const started = Date.now();
      running.set(candidate.id, { candidate, controller, started });
      withMedia(candidate.provider, { ...args, model: candidate.model, reasoning: candidate.model === args.model ? args.reasoning : undefined, timeoutMs: left, signal: controller.signal })
        .then((answer) => {
          if (done) return;
          running.delete(candidate.id);
          strikes.delete(candidate.id);
          track(candidate.id, { ms: Date.now() - started });
          for (const { candidate: slower, started: since } of running.values()) {
            if (since > started) continue;
            pause(slower.id);
            log.info('llm', `${slower.model} : plus lent que ${candidate.model}`);
          }
          finish({ answer: result(answer, candidate.model) });
        })
        .catch((err) => {
          running.delete(candidate.id);
          if (done) return;
          if (err instanceof ContentRefused) return finish({ refused: err });
          if (err.timedOut || err.status === 429 || err.status >= 500) pause(candidate.id);
          track(candidate.id, { error: err.message });
          transient ||= !(err.status >= 400 && err.status < 500) || err.status === 429;
          failure = err;
          log.info('llm', `${candidate.model} : ${err.message}`);
          launch();
        });
      timer = setTimeout(launch, stagger);
    };
    launch();
  });
}

export async function chat({ messages, format, options, tools, model, reasoning, timeoutMs = 90_000 }) {
  if (!activeProviders().length) throw new LLMUnavailable('aucune clé de LLM configurée');
  busy++;
  notify();
  const started = Date.now();
  const call = { at: started, messages, tools: tools?.map((t) => t.function?.name ?? t.name), format: Boolean(format) };
  try {
    const answer = await attempt({ messages, format, options, tools, model, reasoning, timeoutMs });
    debugState.lastCall = { ...call, ms: Date.now() - started, answer };
    return answer;
  } catch (err) {
    debugState.lastCall = { ...call, ms: Date.now() - started, error: err.message };
    throw err;
  } finally {
    busy--;
    notify();
  }
}

async function attempt({ messages, format, options, tools, model, reasoning, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let failure = new LLMUnavailable('aucun modèle disponible');
  for (const delay of [0, ...RETRY_DELAYS]) {
    if (delay) {
      if (Date.now() + delay >= deadline) break;
      log.info('llm', `aucun modèle disponible, nouvel essai dans ${delay / 1000} s`);
      await Bun.sleep(delay);
    }
    const outcome = await race(candidates(model), { messages, format, options, tools, model, reasoning }, deadline, Math.min(STAGGER, timeoutMs / 3));
    if (outcome.answer) return outcome.answer;
    if (outcome.refused) throw outcome.refused;
    failure = outcome.failure ?? failure;
    if (!outcome.transient) break;
  }
  throw failure;
}

export async function choose({ messages, choices, timeoutMs = 60_000 }) {
  const { content } = await chat({
    messages,
    format: { type: 'object', properties: { choix: { type: 'string', enum: choices } }, required: ['choix'] },
    options: { temperature: 0 },
    timeoutMs,
  });
  return JSON.parse(content).choix;
}
