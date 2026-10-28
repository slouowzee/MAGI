import { StringSelectMenuBuilder } from 'discord.js';
import { logChannels } from '../../core/installation.js';
import { DISCORD_LEVELS, discordLevel } from '../../core/log/discord.js';
import { id, row, text, separator } from '../ui.js';

const LOG_PURPOSES = {
  logs: 'outils, configuration, installation, arrivées et départs, rappels',
  moderation: 'décisions de la modération automatique',
  securite: 'anti-nuke, honeypot, SSH et sudo du VPS',
  systeme: 'démarrage, modèles, erreurs, journal du VPS',
};

export function logsSection(guild) {
  const level = discordLevel(guild.id);
  const targets = logChannels(guild);
  return [
    text(Object.entries(LOG_PURPOSES).map(([source, purpose]) => `${targets[source] ?? 'salon manquant'} : ${purpose}`).join('\n')),
    separator(),
    text(`**Niveau minimal** : ${level} et au-dessus\n-# Les alertes qui mentionnent passent quel que soit le niveau.`),
    row(
      new StringSelectMenuBuilder()
        .setCustomId(id('log_level'))
        .setPlaceholder('Niveau minimal des logs Discord')
        .addOptions(Object.entries(DISCORD_LEVELS).map(([value, label]) => ({ label: `${value} : ${label}`, value, default: value === level }))),
    ),
  ];
}
