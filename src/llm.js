export class LLMUnavailable extends Error {}

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const GEMINI_COOLDOWN = 60_000;

let geminiPausedUntil = 0;
let ollamaTail = Promise.resolve();

function ollamaQueue(job) {
  const run = ollamaTail.then(job);
  ollamaTail = run.catch(() => {});
  return run;
}

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
    throw new LLMUnavailable(err.name === 'TimeoutError' ? `pas de réponse en ${timeoutMs / 1000} s` : err.message);
  }
  if (!res.ok) {
    const error = new LLMUnavailable(`HTTP ${res.status} : ${(await res.text()).slice(0, 200)}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

async function gemini({ messages, format, options = {}, timeoutMs }) {
  const body = {
    model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    messages,
    max_tokens: options.num_predict,
    temperature: options.temperature,
  };
  if (format) body.response_format = { type: 'json_schema', json_schema: { name: 'reponse', schema: format } };
  const data = await post(GEMINI_URL, { Authorization: `Bearer ${process.env.GEMINI_API_KEY}` }, body, timeoutMs);
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new LLMUnavailable('réponse Gemini vide');
  return content;
}

function ollama({ messages, format, options, timeoutMs }) {
  return ollamaQueue(async () => {
    const url = `${process.env.OLLAMA_URL || 'http://localhost:11434'}/api/chat`;
    const body = { model: process.env.OLLAMA_MODEL || 'qwen3:4b-instruct', messages, format, options, stream: false };
    return (await post(url, {}, body, timeoutMs)).message.content;
  });
}

export function warmupOllama(messages) {
  return ollama({ messages, options: { num_predict: 1 }, timeoutMs: 180_000 });
}

export async function chat({ messages, format, options, timeoutMs = 180_000 }) {
  if (process.env.GEMINI_API_KEY && Date.now() >= geminiPausedUntil) {
    try {
      const content = await gemini({ messages, format, options, timeoutMs: Math.min(timeoutMs, 30_000) });
      return { content, provider: 'gemini' };
    } catch (err) {
      if (err.status === 429 || err.status >= 500) geminiPausedUntil = Date.now() + GEMINI_COOLDOWN;
      console.warn(`Gemini indisponible (${err.message}), bascule sur Ollama`);
    }
  }
  const content = await ollama({ messages, format, options, timeoutMs });
  return { content, provider: 'ollama' };
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
