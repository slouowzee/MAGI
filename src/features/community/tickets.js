import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { activePersonas, channelSetting, moduleEnabled } from '../../core/config.js';
import { isOperator, operatorRole } from '../../core/installation.js';
import { speak } from '../../core/discord/webhooks.js';
import { chat, forReply } from '../../core/llm/client.js';
import { buildMessages, cleanReply, MAX_TOKENS } from '../../core/llm/prompts.js';
import { setSetting, setting } from '../../core/settings.js';
import { log } from '../../core/log/log.js';

const PREFIX = 'magi-ticket:';
const ephemeral = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

export const isTicketInteraction = (id) => id.startsWith(PREFIX);

export function ticketPanel() {
  return {
    embeds: [new EmbedBuilder().setColor(0xd65c62).setDescription("# Besoin d'aide ?\n### Ouvre un ticket : un fil privé avec les opérateurs, que toi seul et eux pouvez lire.")],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}ouvrir`).setLabel('Ouvrir un ticket').setStyle(ButtonStyle.Primary))],
  };
}

export async function postTicketPanel(guild) {
  const channel = channelSetting(guild, 'tickets_channel');
  if (!channel) throw new Error("choisis d'abord le salon du panneau de tickets");
  return channel.send(ticketPanel());
}

function subjectModal() {
  return new ModalBuilder()
    .setCustomId(`${PREFIX}sujet`)
    .setTitle('Ouvrir un ticket')
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('sujet').setLabel('Ta demande').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true)));
}

async function open(interaction) {
  const { guild, member } = interaction;
  const subject = interaction.fields.getTextInputValue('sujet');
  const parent = channelSetting(guild, 'tickets_channel') ?? interaction.channel;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const thread = await parent.threads.create({ name: `ticket-${member.displayName}`.slice(0, 90), type: ChannelType.PrivateThread, invitable: false, reason: `MAGI : ticket de ${member.user.tag}` });
  await thread.members.add(member.id);
  setSetting(guild.id, `ticket:${thread.id}`, member.id);
  const operators = operatorRole(guild);
  if (operators) {
    await guild.members.fetch().catch(() => {});
    for (const id of [...operators.members.keys()].slice(0, 20)) await thread.members.add(id).catch(() => {});
  }
  const persona = activePersonas(guild.id).includes('balthasar') ? 'balthasar' : activePersonas(guild.id)[0];
  let text = `J'ai noté ta demande, un opérateur va passer.`;
  try {
    const prompt = `${member.displayName} ouvre un ticket d'aide sur le serveur avec cette demande :\n« ${subject} »\nAccueille la personne en une ou deux phrases : reformule sa demande en une ligne et dis-lui qu'un opérateur va passer. Ne promets pas de solution.`;
    const { content } = await chat({ messages: buildMessages(persona, [{ role: 'user', content: prompt }], 'courte'), options: { num_predict: MAX_TOKENS.courte }, ...forReply() });
    text = cleanReply(content) || text;
  } catch {}
  await thread.send({ content: `${operators ?? ''} <@${member.id}>\n> ${subject.replace(/\n/g, '\n> ')}`.slice(0, 2000), allowedMentions: { users: [member.id], roles: operators ? [operators.id] : [] } });
  await speak(thread, persona, text, { components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}fermer`).setLabel('Fermer le ticket').setStyle(ButtonStyle.Secondary))] });
  log.notice('tickets', `ticket ouvert par ${member.user.tag} : ${subject.slice(0, 120)}`, { guild, channel: thread });
  await interaction.editReply({ content: `Ticket ouvert : ${thread}` });
}

async function close(interaction) {
  const thread = interaction.channel;
  if (!isOperator(interaction.member) && setting(interaction.guildId, `ticket:${thread.id}`) !== interaction.user.id) return ephemeral(interaction, "Seuls la personne qui a ouvert le ticket et les opérateurs peuvent le fermer.");
  await interaction.update({ components: [] });
  await thread.send({ content: `Ticket fermé par ${interaction.member.displayName}.`, allowedMentions: { parse: [] } });
  await thread.setLocked(true).catch(() => {});
  await thread.setArchived(true, `MAGI : fermé par ${interaction.user.tag}`).catch(() => {});
  log.notice('tickets', `ticket ${thread.name} fermé par ${interaction.user.tag}`, { guild: interaction.guild });
}

export async function handleTicketInteraction(interaction) {
  if (!moduleEnabled(interaction.guildId, 'tickets')) return ephemeral(interaction, 'Les tickets sont désactivés sur ce serveur.');
  const action = interaction.customId.slice(PREFIX.length);
  if (action === 'ouvrir') return interaction.showModal(subjectModal());
  if (action === 'sujet' && interaction.isModalSubmit()) return open(interaction);
  if (action === 'fermer') return close(interaction);
  return ephemeral(interaction, 'Action inconnue.');
}
