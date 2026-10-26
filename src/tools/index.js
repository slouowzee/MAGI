import { adminEnabled, isOperator, logChannel } from '../server/installation.js';
import { INSTALLATION_TOOLS } from './installation.js';
import { MEMORY_TOOLS } from './memory.js';
import { CHANNEL_TOOLS } from './channel.js';
import { REMINDER_TOOLS } from './reminders.js';
import { ADMIN_TOOLS } from './admin/index.js';

const silent = { allowedMentions: { parse: [] } };

export const TOOLS = [...INSTALLATION_TOOLS, ...MEMORY_TOOLS, ...CHANNEL_TOOLS, ...REMINDER_TOOLS, ...ADMIN_TOOLS];

export function canUse(tool, member) {
  if (tool.access === 'everyone') return true;
  if (tool.access === 'owner') return member.id === member.guild.ownerId;
  if (tool.access === 'operator') return isOperator(member) && adminEnabled(member.guild);
  return false;
}

export function toolsFor(member, tools = TOOLS) {
  return tools.filter((tool) => canUse(tool, member));
}

export function schemas(tools) {
  return tools.map(({ name, description, parameters }) => ({ type: 'function', function: { name, description, parameters } }));
}

async function log(guild, text) {
  await logChannel(guild)?.send({ content: text, ...silent }).catch(() => {});
}

async function execute(tool, args, { member, message, actions = [] }) {
  const reason = `MAGI, demandé par ${member.user.tag}`;
  const offer = (action) => actions.push(action);
  try {
    const output = await tool.run({ guild: member.guild, member, message, args, reason, offer });
    await log(member.guild, `\`${tool.name}\` exécuté pour ${member} dans ${message.channel}.`);
    return output;
  } catch (err) {
    await log(member.guild, `\`${tool.name}\` a échoué pour ${member} : ${err.message}`);
    return `Échec de ${tool.name} : ${err.message}`;
  }
}

export async function runTool(call, ctx, tools = TOOLS) {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return `Outil inconnu : ${call.name}.`;
  if (!canUse(tool, ctx.member)) return `Refusé : ${ctx.member.displayName} n'a pas le droit d'utiliser ${call.name}.`;
  if (tool.confirm) {
    const { member } = ctx;
    let label;
    try {
      label = String(await tool.confirm({ guild: member.guild, member, message: ctx.message, args: call.args })).slice(0, 80);
    } catch (err) {
      return `Impossible : ${err.message}`;
    }
    ctx.actions?.push({
      label,
      danger: true,
      allowed: (m) => m.id === member.id,
      refusal: `Seul ${member.displayName} peut confirmer.`,
      cleanup: tool.cleanup ? ctx.message : undefined,
      run: () => execute(tool, call.args, ctx),
    });
    return "Un bouton de confirmation sera affiché sous ta réponse : l'action ne sera faite que si la personne clique dessus. Dis-le-lui brièvement.";
  }
  return execute(tool, call.args, ctx);
}
