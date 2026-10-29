import { moderationMode } from '../../features/moderation/store.js';
import { enabledModules, MODULES } from '../../core/config.js';
import { logChannels } from '../../core/installation.js';
import { currentLevel, LEVELS } from '../../core/permissions.js';
import { PAGES, MODE_LABELS, text, separator, pageOf, alerts } from '../ui.js';
import { activationBlocks } from '../../features/debug/console.js';

export function homeSection(guild) {
  const found = Object.entries(alerts(guild));
  const level = currentLevel(guild.members.me.permissions);
  const missingLogs = Object.entries(logChannels(guild)).filter(([, c]) => !c).map(([source]) => source);
  const todo = [
    ...found.map(([key, problem]) => `- **${MODULES[key]}** (${PAGES[pageOf(key)]}) : ${problem}`),
    ...(missingLogs.length ? [`- **Logs** : salon manquant pour ${missingLogs.join(', ')}`] : []),
  ];
  return [
    text(
      [
        `Permissions : **${level ? LEVELS[level].label : 'insuffisantes'}**`,
        `Modules actifs : **${enabledModules(guild.id).length}/${Object.keys(MODULES).length}**`,
        `Modération automatique : ${MODE_LABELS[moderationMode(guild.id).mode]}`,
      ].join('\n'),
    ),
    separator(),
    text(todo.length ? ['**À régler**', ...todo].join('\n') : 'Rien à régler.'),
    separator(),
    ...activationBlocks(guild),
  ];
}
