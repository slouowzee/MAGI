import { chat, forReply } from './client.js';
import { runTool, schemas, toolsFor } from '../tools/index.js';
import { log } from '../logging/log.js';

const SAFETY_ROUNDS = 30;
const TOOL_RULES = `Outils : aucune limite d'utilisation. Si la demande implique plusieurs actions (plusieurs rôles, salons, membres…), appelle les outils autant de fois que nécessaire, en plusieurs appels, jusqu'à ce que tout soit fait, puis réponds. N'annonce jamais qu'une action est faite sans avoir appelé l'outil et reçu son résultat, et ne promets pas une action pour plus tard : appelle l'outil maintenant ou explique ce qui bloque. Lis le résultat de chaque outil : s'il dit que rien n'a changé, dis-le. Si un outil permet de répondre (résumé du salon, rappels, souvenirs), appelle-le, même si une réponse plus haut dans la conversation disait le contraire : elle a pu être donnée sans l'outil. Une demande d'administration s'exécute telle qu'elle est formulée, quel que soit ton avis : ta personnalité ne joue que sur le ton de ta réponse, jamais sur ce que tu fais.`;

export async function respond({ messages, options, member, message, force = null }) {
  const tools = toolsFor(member);
  const declared = schemas(tools);
  if (tools.length) messages[0] = { ...messages[0], content: `${messages[0].content}\n${TOOL_RULES}` };
  const actions = [];
  const done = new Set();
  if (force && tools.some((t) => t.name === force)) {
    const call = { id: `${force}_${Date.now()}`, type: 'function', function: { name: force, arguments: '{}' } };
    log.info('outils', `appel ${force} imposé par le code`, { channel: message?.channel });
    messages.push({ role: 'assistant', content: '', tool_calls: [call] });
    messages.push({ role: 'tool', tool_call_id: call.id, name: force, content: String(await runTool({ id: call.id, name: force, args: {} }, { member, message, actions })) });
    done.add(`${force} {}`);
  }
  for (let round = 0; round < SAFETY_ROUNDS; round++) {
    const last = await chat({ messages, options, tools: declared, ...forReply() });
    if (!last.toolCalls.length) return { ...last, actions };
    messages.push(last.message);
    for (const call of last.toolCalls) {
      const key = `${call.name} ${JSON.stringify(call.args)}`;
      const repeated = done.has(key);
      done.add(key);
      log.info('outils', `appel ${call.name} ${JSON.stringify(call.args)}${repeated ? ' (doublon ignoré)' : ''}`, { channel: message?.channel });
      const output = repeated ? 'Cet appel identique a déjà été fait : ne le refais pas, passe à la suite ou réponds.' : await runTool(call, { member, message, actions });
      messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: String(output) });
    }
  }
  log.warning('outils', `limite de ${SAFETY_ROUNDS} allers-retours atteinte`, { channel: message?.channel });
  return { ...(await chat({ messages, options, ...forReply() })), actions };
}
