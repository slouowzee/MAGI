import { ButtonBuilder, ButtonStyle } from 'discord.js';
import { currentLevel, inviteUrl, LEVELS } from '../../core/permissions.js';
import { row, text } from '../ui.js';

export function permissionsSection(guild) {
  const level = currentLevel(guild.members.me.permissions);
  return [
    text(
      [
        `Niveau actuel : **${level ? LEVELS[level].label : 'insuffisant'}**`,
        '',
        ...Object.values(LEVELS).map((l) => `**${l.label}** : ${l.text}`),
        '',
        '-# Un clic ouvre la page d’autorisation Discord, qui met à jour le rôle de MAGI.',
      ].join('\n'),
    ),
    row(Object.entries(LEVELS).map(([key, l]) => new ButtonBuilder().setLabel(l.label).setStyle(ButtonStyle.Link).setURL(inviteUrl(guild.client.user.id, guild.id, key)))),
  ];
}
