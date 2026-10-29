import { ApplicationCommandType, ContainerBuilder, MessageFlags, SeparatorBuilder, TextDisplayBuilder } from 'discord.js';
import { isMuted, moduleEnabled } from '../../core/config.js';
import { listSettings } from '../../core/settings.js';
import { synchroOf, synchroRank, synchroTop, weekTop } from './store.js';
import { rateOf, weekOf } from './synchro.js';
import { wallEmoji } from './hall-of-fame.js';

const COLOR = 0xd65c62;
const text = (content) => new TextDisplayBuilder().setContent(content);
const duration = (minutes) => (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${String(minutes % 60).padStart(2, '0')}` : ''}`);
const ranked = (rows, line) => rows.map((row, i) => `${i + 1}. ${line(row)}`).join('\n');

export const LEADERBOARD_COMMANDS = [{ tier: 'membres', data: { name: 'classement', type: ApplicationCommandType.ChatInput, description: 'Classement du serveur : synchronisation, actifs de la semaine, Hall of Fame' } }];

export function hallOfFameTop(guildId, limit = 5) {
  return listSettings(guildId, 'hof:')
    .map((row) => ({ userId: row.key.slice('hof:'.length), count: Number(row.value) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function leaderboard(guild, userId, now = Date.now()) {
  const sections = [];
  if (moduleEnabled(guild.id, 'synchro')) {
    const top = synchroTop(guild.id, 10);
    const mine = synchroOf(guild.id, userId).points;
    const me = top.some((r) => r.user_id === userId) || !mine ? '' : `\n-# Toi : ${synchroRank(guild.id, mine)}e · ${rateOf(mine)} %`;
    sections.push(`**Synchronisation**\n${top.length ? ranked(top, (r) => `<@${r.user_id}> · ${rateOf(r.points)} %`) : 'Personne pour l’instant.'}${me}`);
    const week = weekTop(guild.id, weekOf(now), 5);
    sections.push(`**Actifs cette semaine**\n${week.length ? ranked(week, (r) => `<@${r.user_id}> · ${duration(r.week_points)} d’activité`) : 'Personne depuis lundi.'}`);
  }
  if (moduleEnabled(guild.id, 'etoiles')) {
    const hall = hallOfFameTop(guild.id);
    sections.push(`**Hall of Fame** ${wallEmoji(guild.id)}\n${hall.length ? ranked(hall, (r) => `<@${r.userId}> · ${r.count} message${r.count > 1 ? 's' : ''}`) : 'Aucun message au Hall of Fame.'}`);
  }
  const container = new ContainerBuilder().setAccentColor(COLOR).addTextDisplayComponents(text(`### Classement de ${guild.name}`));
  if (!sections.length) return container.addTextDisplayComponents(text('Aucun classement : la synchronisation et le Hall of Fame sont coupés sur ce serveur.'));
  sections.forEach((section, i) => {
    if (i === 0 || section.startsWith('**Hall')) container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(text(section));
  });
  return container;
}

export function showLeaderboard(interaction) {
  const flags = MessageFlags.IsComponentsV2 | (isMuted(interaction.channel) ? MessageFlags.Ephemeral : 0);
  return interaction.reply({ components: [leaderboard(interaction.guild, interaction.user.id)], flags, allowedMentions: { parse: [] } });
}
