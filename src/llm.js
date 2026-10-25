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

function forGemini(messages) {
  return messages.map(({ name, ...m }) => m);
}

function forOllama(messages) {
  return messages.map((m) => {
    if (m.role === 'assistant' && m.tool_calls) {
      return {
        role: 'assistant',
        content: m.content ?? '',
        tool_calls: m.tool_calls.map((c) => ({ function: { name: c.function.name, arguments: JSON.parse(c.function.arguments || '{}') } })),
      };
    }
    if (m.role === 'tool') return { role: 'tool', content: m.content, tool_name: m.name };
    return m;
  });
}

async function gemini({ messages, format, options = {}, tools, timeoutMs }) {
  const body = {
    model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    messages: forGemini(messages),
    max_tokens: options.num_predict,
    temperature: options.temperature,
  };
  if (format) body.response_format = { type: 'json_schema', json_schema: { name: 'reponse', schema: format } };
  if (tools?.length) body.tools = tools;
  const data = await post(GEMINI_URL, { Authorization: `Bearer ${process.env.GEMINI_API_KEY}` }, body, timeoutMs);
  const message = data.choices?.[0]?.message;
  if (!message || (typeof message.content !== 'string' && !message.tool_calls?.length)) throw new LLMUnavailable('réponse Gemini vide');
  return { role: 'assistant', content: message.content ?? '', ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) };
}

function ollama({ messages, format, options, tools, timeoutMs }) {
  return ollamaQueue(async () => {
    const url = `${process.env.OLLAMA_URL || 'http://localhost:11434'}/api/chat`;
    const body = { model: process.env.OLLAMA_MODEL || 'qwen3:4b-instruct', messages: forOllama(messages), format, options, stream: false };
    if (tools?.length) body.tools = tools;
    const { message } = await post(url, {}, body, timeoutMs);
    const calls = (message.tool_calls ?? []).map((c, i) => ({
      id: `ollama_${Date.now()}_${i}`,
      type: 'function',
      function: { name: c.function.name, arguments: JSON.stringify(c.function.arguments ?? {}) },
    }));
    return { role: 'assistant', content: message.content ?? '', ...(calls.length ? { tool_calls: calls } : {}) };
  });
}

export function warmupOllama(messages) {
  return ollama({ messages, options: { num_predict: 1 }, timeoutMs: 180_000 });
}

function result(message, provider) {
  const toolCalls = (message.tool_calls ?? []).map((c) => {
    let args = {};
    try {
      args = JSON.parse(c.function.arguments || '{}');
    } catch {}
    return { id: c.id, name: c.function.name, args };
  });
  return { content: message.content, toolCalls, message, provider };
}

export async function chat({ messages, format, options, tools, timeoutMs = 180_000 }) {
  if (process.env.GEMINI_API_KEY && Date.now() >= geminiPausedUntil) {
    try {
      return result(await gemini({ messages, format, options, tools, timeoutMs: Math.min(timeoutMs, 30_000) }), 'gemini');
    } catch (err) {
      if (err.status === 429 || err.status >= 500) geminiPausedUntil = Date.now() + GEMINI_COOLDOWN;
      console.warn(`Gemini indisponible (${err.message}), bascule sur Ollama`);
    }
  }
  return result(await ollama({ messages, format, options, tools, timeoutMs }), 'ollama');
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
