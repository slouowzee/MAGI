import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, PermissionFlagsBits as P, TextInputBuilder, TextInputStyle } from 'discord.js';
import { operatorRole } from '../../core/installation.js';
import { log } from '../../core/log/log.js';
import { alertCase, latestCase, updateCase } from './cases.js';
import { getCase } from './store.js';

const PREFIX = 'magi-appeal:';
const stamp = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
const row = (id, label) => [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}${id}`).setLabel(label).setStyle(ButtonStyle.Secondary))];
const contestable = (c) => !c.observing && c.status !== 'annulee';

export const isAppealInteraction = (id) => id.startsWith(PREFIX);

export function notifySanction(guild, userId, line) {
  return guild.client.users
    .fetch(userId)
    .then((user) => user.send({ content: `**${guild.name}** · ${line}\n-# Si c'est une erreur, conteste : les opérateurs du serveur recevront ta demande.`, components: row(`open:${guild.id}`, 'Contester'), allowedMentions: { parse: [] } }))
    .catch(() => {});
}

export function answerAppeal(guild, c, accepted) {
  return guild.client.users
    .fetch(c.userId)
    .then((user) => user.send({ content: `**${guild.name}** · ta contestation du cas #${c.id} a été ${accepted ? 'acceptée : la sanction est annulée.' : 'refusée : la sanction est maintenue.'}`, allowedMentions: { parse: [] } }))
    .catch(() => {});
}

async function invite(guild) {
  const channel = guild.systemChannel ?? guild.channels.cache.find((ch) => ch.isTextBased?.() && ch.permissionsFor?.(guild.roles.everyone)?.has(P.ViewChannel));
  return channel?.createInvite({ maxAge: 86_400, maxUses: 1, unique: true, reason: 'MAGI : contestation acceptée' }).catch(() => null);
}

async function status(interaction, guild, c) {
  const { appeal } = c;
  if (appeal.state === 'en attente') return interaction.reply({ content: `Ta contestation du cas #${c.id} est en attente, envoyée ${stamp(appeal.at)}.` });
  if (appeal.state === 'refusée') return interaction.reply({ content: `Ta contestation du cas #${c.id} a été refusée : la sanction est maintenue.` });
  const member = await guild.members.fetch(c.userId).catch(() => null);
  const link = member ? null : await invite(guild);
  return interaction.reply({ content: `Ta contestation du cas #${c.id} a été acceptée : la sanction est annulée.${link ? ` Tu peux revenir : ${link.url}` : ''}` });
}

export async function handleAppealInteraction(interaction) {
  const [action, guildId, caseId] = interaction.customId.slice(PREFIX.length).split(':');
  const guild = interaction.client.guilds.cache.get(guildId);
  const userId = interaction.user.id;
  if (!guild) return interaction.reply({ content: "Ce serveur n'est plus joignable." });
  if (action === 'open') {
    const c = latestCase(guildId, userId, contestable);
    if (!c) return interaction.reply({ content: `Plus aucune sanction à contester sur ${guild.name}.` });
    if (c.appeal) return status(interaction, guild, c);
    const input = new TextInputBuilder().setCustomId('texte').setLabel('Pourquoi cette sanction est une erreur ?').setStyle(TextInputStyle.Paragraph).setMinLength(10).setMaxLength(1000).setRequired(true);
    return interaction.showModal(new ModalBuilder().setCustomId(`${PREFIX}send:${guildId}:${c.id}`).setTitle(`Contester le cas #${c.id}`).addComponents(new ActionRowBuilder().addComponents(input)));
  }
  const c = getCase(Number(caseId));
  if (!c || c.guildId !== guildId || c.userId !== userId) return interaction.reply({ content: 'Cas introuvable.' });
  if (action === 'state') return c.appeal ? status(interaction, guild, c) : interaction.reply({ content: 'Aucune contestation pour ce cas.' });
  if (action !== 'send') return interaction.reply({ content: 'Action inconnue.' });
  if (c.appeal) return status(interaction, guild, c);
  if (!contestable(c)) return interaction.reply({ content: 'Cette sanction a déjà été annulée.' });
  const text = interaction.fields.getTextInputValue('texte').trim();
  const updated = updateCase(guild, c.id, { appeal: { at: Date.now(), text, state: 'en attente' } }, { event: `contestée par <@${userId}>` });
  await alertCase(guild, updated, operatorRole(guild)?.id, `cas #${c.id} : <@${userId}> conteste sa sanction.`);
  log.notice('moderation', `cas #${c.id} : <@${userId}> conteste sa sanction`, { guild, quiet: true });
  return interaction.update({ content: `${interaction.message?.content ?? ''}\n-# Contestation envoyée ${stamp(Date.now())}. Clique ci-dessous pour voir la réponse.`.slice(0, 2000), components: row(`state:${guildId}:${c.id}`, 'Voir la réponse') });
}
