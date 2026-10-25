import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { adminEnabled, isOperator, logChannel } from '../server/installation.js';
import { INSTALLATION_TOOLS } from './installation.js';

const silent = { allowedMentions: { parse: [] } };
const CONFIRM_TIMEOUT = 60_000;

export const TOOLS = [...INSTALLATION_TOOLS];

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

function askConfirmation(tool, args, ctx) {
  const { member, message } = ctx;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('confirmer').setLabel('Confirmer').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('annuler').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
  );
  const description = tool.confirm(args, ctx);

  return message.reply({ content: `**Confirmation requise** : ${description}`, components: [row], ...silent }).then((prompt) => {
    const collector = prompt.createMessageComponentCollector({ time: CONFIRM_TIMEOUT });
    collector.on('collect', async (click) => {
      if (click.user.id !== member.id) {
        await click.reply({ content: `Seul ${member} peut confirmer cette action.`, flags: MessageFlags.Ephemeral, ...silent }).catch(() => {});
        return;
      }
      collector.stop('answered');
      if (click.customId !== 'confirmer') {
        await click.update({ content: `Annulé : ${description}`, components: [] }).catch(() => {});
        return;
      }
      await click.update({ content: `Confirmé par ${member} : ${description}`, components: [], ...silent }).catch(() => {});
      const output = await execute(tool, args, ctx);
      await click.followUp({ content: output, ...silent }).catch(() => {});
    });
    collector.on('end', async (_, why) => {
      if (why !== 'answered') await prompt.edit({ content: `Expiré sans confirmation : ${description}`, components: [] }).catch(() => {});
    });
  });
}

export async function runTool(call, ctx, tools = TOOLS) {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return `Outil inconnu : ${call.name}.`;
  if (!canUse(tool, ctx.member)) return `Refusé : ${ctx.member.displayName} n'a pas le droit d'utiliser ${call.name}.`;
  if (tool.confirm) {
    await askConfirmation(tool, call.args, ctx);
    return "Un bouton de confirmation a été envoyé : l'action ne sera exécutée que si la personne clique sur « Confirmer ». Dis-le-lui brièvement.";
  }
  return execute(tool, call.args, ctx);
}
