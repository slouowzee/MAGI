import { ActionRowBuilder, ApplicationCommandType, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SeparatorBuilder, TextDisplayBuilder } from 'discord.js';
import { isMuted, moduleEnabled } from '../../core/config.js';
import { synchroCount, synchroTop } from './store.js';
import { rateOf } from './synchro.js';
import { COLOR } from '../../core/discord/embeds.js';
import { clamp } from '../../core/util.js';

const PREFIX = 'magi-rank:';
const PER_PAGE = 10;
const V2 = MessageFlags.IsComponentsV2;
const text = (content) => new TextDisplayBuilder().setContent(content);
const pageButton = (page, label, disabled) => new ButtonBuilder().setCustomId(`${PREFIX}page:${page}`).setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(disabled);

export const LEADERBOARD_COMMANDS = [{ module: 'synchro', tier: 'membres', data: { name: 'classement', type: ApplicationCommandType.ChatInput, description: 'Classement de synchronisation du serveur' } }];

export const isLeaderboardInteraction = (id) => id.startsWith(PREFIX);

export function leaderboard(guild, page = 0) {
  const container = new ContainerBuilder().setAccentColor(COLOR).addTextDisplayComponents(text('### Taux de synchronisation')).addSeparatorComponents(new SeparatorBuilder());
  if (!moduleEnabled(guild.id, 'synchro')) return container.addTextDisplayComponents(text('La synchronisation est coupée sur ce serveur.'));
  const pages = Math.max(1, Math.ceil(synchroCount(guild.id) / PER_PAGE));
  const at = clamp(0, page, pages - 1);
  const rows = synchroTop(guild.id, PER_PAGE, at * PER_PAGE);
  container.addTextDisplayComponents(text(`${rows.length ? rows.map((r, i) => `${at * PER_PAGE + i + 1}. <@${r.user_id}> · ${rateOf(r.points)} %`).join('\n') : 'Personne pour l’instant.'}`));
  if (pages > 1) container.addTextDisplayComponents(text(`-# Page ${at + 1}/${pages}`)).addActionRowComponents(new ActionRowBuilder().addComponents(pageButton(at - 1, '‹ Précédent', at === 0), pageButton(at + 1, 'Suivant ›', at === pages - 1)));
  return container;
}

export function showLeaderboard(interaction) {
  return interaction.reply({ components: [leaderboard(interaction.guild)], flags: V2 | (isMuted(interaction.channel) ? MessageFlags.Ephemeral : 0), allowedMentions: { parse: [] } });
}

export function handleLeaderboardInteraction(interaction) {
  return interaction.update({ components: [leaderboard(interaction.guild, Number(interaction.customId.split(':').at(-1)))], flags: V2, allowedMentions: { parse: [] } });
}
