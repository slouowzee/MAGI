export class LLMUnavailable extends Error {}
export class ContentRefused extends Error {}

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const GEMINI_COOLDOWN = 60_000;
const GEMINI_PATIENCE = 12_000;
const GEMINI_RETRY_DELAYS = [2_000, 5_000];

const geminiPausedUntil = new Map();
const defaultModel = () => process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const backupModel = () => process.env.GEMINI_BACKUP_MODEL || 'gemini-3.1-flash-lite';
export const forReply = () => (process.env.GEMINI_REPLY_MODEL ? { model: process.env.GEMINI_REPLY_MODEL, reasoning: 'none' } : {});
async function post(url, headers, body, timeoutMs) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err.name === 'TimeoutError';
    throw Object.assign(new LLMUnavailable(timedOut ? `pas de réponse en ${timeoutMs / 1000} s` : err.message), { timedOut });
  }
  if (!res.ok) {
    const error = new LLMUnavailable(`HTTP ${res.status} : ${(await res.text()).slice(0, 200)}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

function forGemini(messages) {
  return messages.map(({ name, ...m }) => m);
}

async function gemini({ messages, format, options = {}, tools, model, reasoning, timeoutMs }) {
  const body = {
    model,
    messages: forGemini(messages),
    max_tokens: options.num_predict,
    temperature: options.temperature,
  };
  if (format) body.response_format = { type: 'json_schema', json_schema: { name: 'reponse', schema: format } };
  if (reasoning) body.reasoning_effort = reasoning;
  if (tools?.length) body.tools = tools;
  const data = await post(GEMINI_URL, { Authorization: `Bearer ${process.env.GEMINI_API_KEY}` }, body, timeoutMs);
  const choice = data.choices?.[0];
  const message = choice?.message;
  if (choice?.finish_reason === 'content_filter') throw new ContentRefused('réponse bloquée par le filtre de Gemini');
  if (!message || (typeof message.content !== 'string' && !message.tool_calls?.length)) throw new LLMUnavailable(`réponse Gemini vide (${choice?.finish_reason ?? 'sans motif'})`);
  return { role: 'assistant', content: message.content ?? '', ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) };
}

const isMedia = (p) => p.type === 'image_url';
const isVideo = (p) => isMedia(p) && p.image_url.url.startsWith('data:video/');

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

async function geminiWithMedia(args) {
  try {
    return await gemini(args);
  } catch (err) {
    const lighter = err.status === 400 && (hideMedia(args.messages, isVideo) || hideMedia(args.messages, isMedia));
    if (!lighter) throw err;
    console.warn(`Gemini refuse un média (${err.message.replace(/\s+/g, ' ')}), nouvel essai sans`);
    return geminiWithMedia({ ...args, messages: lighter });
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

function geminiModels(model) {
  const all = [...new Set([model ?? defaultModel(), defaultModel(), backupModel()])];
  const awake = all.filter((c) => Date.now() >= (geminiPausedUntil.get(c) ?? 0));
  return awake.length ? awake : all;
}

export async function chat({ messages, format, options, tools, model, reasoning, timeoutMs = 90_000 }) {
  if (!process.env.GEMINI_API_KEY) throw new LLMUnavailable('GEMINI_API_KEY manquante');
  const deadline = Date.now() + timeoutMs;
  let failure = new LLMUnavailable('Gemini indisponible');
  for (const delay of [0, ...GEMINI_RETRY_DELAYS]) {
    if (delay) {
      if (Date.now() + delay >= deadline) break;
      console.warn(`Gemini indisponible, nouvel essai dans ${delay / 1000} s`);
      await Bun.sleep(delay);
    }
    const candidates = geminiModels(model);
    let transient = false;
    for (const [i, candidate] of candidates.entries()) {
      const left = deadline - Date.now();
      if (left <= 0) break;
      const patience = i < candidates.length - 1 ? Math.min(GEMINI_PATIENCE, timeoutMs / 3) : 60_000;
      try {
        return result(await geminiWithMedia({ messages, format, options, tools, model: candidate, reasoning: candidate === model ? reasoning : undefined, timeoutMs: Math.min(left, patience) }), candidate);
      } catch (err) {
        if (err instanceof ContentRefused) throw err;
        if (err.timedOut || err.status === 429 || err.status >= 500) geminiPausedUntil.set(candidate, Date.now() + GEMINI_COOLDOWN);
        transient ||= !(err.status >= 400 && err.status < 500) || err.status === 429;
        failure = err;
        console.warn(`Gemini ${candidate} indisponible (${err.message.replace(/\s+/g, ' ')})`);
      }
    }
    if (!transient) break;
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
