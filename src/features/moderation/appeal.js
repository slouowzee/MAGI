import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ContainerBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits as P, SectionBuilder, SeparatorBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle, ThumbnailBuilder } from 'discord.js';
import { operatorRole } from '../../core/installation.js';
import { log } from '../../core/log/log.js';
import { alertCase, latestCase, updateCase } from './cases.js';
import { getCase } from './store.js';

const PREFIX = 'magi-appeal:';
const V2 = MessageFlags.IsComponentsV2;
const COLORS = { avertissement: 0xef9f27, exclusion: 0xd85a30, expulsion: 0xd85a30, ban: 0xe24b4a, acceptée: 0x1d9e75, refusée: 0x888780, 'en attente': 0x888780 };
const DECISIONS = { acceptée: 'Acceptée : la sanction est annulée.', refusée: 'Refusée : la sanction est maintenue.' };
const stamp = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;
const text = (content) => new TextDisplayBuilder().setContent(content);
const buttonRow = (id, label) => new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}${id}`).setLabel(label).setStyle(ButtonStyle.Secondary));
const contestable = (c) => !c.observing && c.status !== 'annulee';
const sentFooter = (at) => `-# Contestation envoyée ${stamp(at)}. La réponse arrivera ici, ou avec le bouton ci-dessous.`;

export const isAppealInteraction = (id) => id.startsWith(PREFIX);

function card(guild, { color, title, lines, footer = null, button = null }) {
  const container = new ContainerBuilder().setAccentColor(color);
  const header = text(`### ${title}\n-# ${guild.name}`);
  const icon = guild.iconURL?.({ size: 128 });
  if (icon) container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(header).setThumbnailAccessory(new ThumbnailBuilder().setURL(icon)));
  else container.addTextDisplayComponents(header);
  container.addSeparatorComponents(new SeparatorBuilder()).addTextDisplayComponents(text(lines.filter(Boolean).join('\n')));
  if (footer) container.addTextDisplayComponents(text(footer));
  if (button) container.addActionRowComponents(button);
  return container;
}

export function sanctionCard(guild, { sanction, reason, at = Date.now() }) {
  return card(guild, {
    color: COLORS[sanction.split(' ')[0].toLowerCase()] ?? COLORS.ban,
    title: 'Tu as reçu une sanction',
    lines: [`**Sanction** : ${sanction}`, `**Motif** : ${reason || 'non précisé'}`, `**Date** : ${stamp(at, 'f')}`],
    footer: `-# Si c'est une erreur, tu peux la contester : les opérateurs de ${guild.name} recevront ta demande.`,
    button: buttonRow(`open:${guild.id}`, 'Contester'),
  });
}

const decisionCard = (guild, c, state) => card(guild, { color: COLORS[state], title: 'Ta contestation', lines: [state === 'en attente' ? `En attente, envoyée ${stamp(c.appeal.at)}.` : DECISIONS[state]] });

export function notifySanction(guild, userId, details) {
  return guild.client.users
    .fetch(userId)
    .then((user) => user.send({ components: [sanctionCard(guild, details)], flags: V2, allowedMentions: { parse: [] } }))
    .catch(() => {});
}

export function answerAppeal(guild, c, accepted) {
  return guild.client.users
    .fetch(c.userId)
    .then((user) => user.send({ components: [decisionCard(guild, c, accepted ? 'acceptée' : 'refusée')], flags: V2, allowedMentions: { parse: [] } }))
    .catch(() => {});
}

async function invite(guild) {
  const channel = guild.systemChannel ?? guild.channels.cache.find((ch) => ch.isTextBased?.() && ch.permissionsFor?.(guild.roles.everyone)?.has(P.ViewChannel));
  return channel?.createInvite({ maxAge: 86_400, maxUses: 1, unique: true, reason: 'MAGI : contestation acceptée' }).catch(() => null);
}

async function status(interaction, guild, c) {
  const { state } = c.appeal;
  const back = state === 'acceptée' && !(await guild.members.fetch(c.userId).catch(() => null)) ? await invite(guild) : null;
  const container = decisionCard(guild, c, state);
  if (back) container.addTextDisplayComponents(text(`Tu peux revenir sur le serveur : ${back.url}`));
  return interaction.reply({ components: [container], flags: V2 });
}

function contestedCard(interaction, guild, c, at) {
  const original = interaction.message?.components?.[0];
  const button = buttonRow(`state:${guild.id}:${c.id}`, 'Voir la réponse');
  if (original?.type !== ComponentType.Container) return card(guild, { color: COLORS['en attente'], title: 'Ta contestation', lines: [`**Sanction** : ${c.action}`], footer: sentFooter(at), button });
  const json = original.toJSON();
  return { ...json, components: [...json.components.slice(0, -2), text(sentFooter(at)).toJSON(), button.toJSON()] };
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
  const plea = interaction.fields.getTextInputValue('texte').trim();
  const at = Date.now();
  const updated = updateCase(guild, c.id, { appeal: { at, text: plea, state: 'en attente' } }, { event: `contestée par <@${userId}>` });
  await alertCase(guild, updated, operatorRole(guild)?.id, `cas #${c.id} : <@${userId}> conteste sa sanction.`);
  log.notice('moderation', `cas #${c.id} : <@${userId}> conteste sa sanction`, { guild, quiet: true });
  return interaction.update({ components: [contestedCard(interaction, guild, c, at)], flags: V2 });
}
