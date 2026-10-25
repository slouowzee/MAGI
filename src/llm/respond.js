import { chat } from './client.js';
import { runTool, schemas, toolsFor } from '../tools/index.js';

const MAX_ROUNDS = 3;

export async function respond({ messages, options, member, message }) {
  const tools = toolsFor(member);
  const declared = schemas(tools);
  const actions = [];
  let last;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    last = await chat({ messages, options, tools: declared });
    if (!last.toolCalls.length) return { ...last, actions };
    messages.push(last.message);
    for (const call of last.toolCalls) {
      console.log(`  outil demandé : ${call.name}`, call.args);
      const output = await runTool(call, { member, message, actions });
      messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: String(output) });
    }
  }
  return { ...(await chat({ messages, options, tools: declared })), actions };
}
