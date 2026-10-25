export class OllamaUnavailable extends Error {}

let tail = Promise.resolve();

function enqueue(job) {
  const run = tail.then(job);
  tail = run.catch(() => {});
  return run;
}

async function request(body, timeoutMs) {
  const url = `${process.env.OLLAMA_URL ?? 'http://localhost:11434'}/api/chat`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OLLAMA_MODEL ?? 'qwen3:4b-instruct', ...body }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new OllamaUnavailable(`Ollama a répondu ${res.status} : ${await res.text()}`);
    return res;
  } catch (err) {
    if (err instanceof OllamaUnavailable) throw err;
    throw new OllamaUnavailable(err.name === 'TimeoutError' ? `Ollama n'a pas répondu en ${timeoutMs / 1000} s` : err.message);
  }
}

async function readStream(res, onToken) {
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const piece = JSON.parse(line).message?.content ?? '';
      if (!piece) continue;
      content += piece;
      onToken(piece, content);
    }
  }
  return content;
}

export function chat({ messages, format, options, onToken, timeoutMs = 180_000 }) {
  return enqueue(async () => {
    const stream = Boolean(onToken);
    const res = await request({ messages, format, options, stream }, timeoutMs);
    try {
      return stream ? await readStream(res, onToken) : (await res.json()).message.content;
    } catch (err) {
      throw new OllamaUnavailable(err.name === 'TimeoutError' ? `Ollama n'a pas fini en ${timeoutMs / 1000} s` : err.message);
    }
  });
}

export async function choose({ messages, choices, timeoutMs = 60_000 }) {
  const raw = await chat({
    messages,
    format: { type: 'object', properties: { choix: { enum: choices } }, required: ['choix'] },
    options: { temperature: 0 },
    timeoutMs,
  });
  return JSON.parse(raw).choix;
}
