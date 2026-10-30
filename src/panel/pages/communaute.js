import { StringSelectMenuBuilder } from 'discord.js';
import { setting } from '../../core/settings.js';
import { EMOJI_CHOICES, wallEmoji } from '../../features/community/hall-of-fame.js';
import { milestoneMessages, MILESTONES, paliers } from '../../features/community/synchro.js';
import { option } from '../../core/config.js';
import { one, separator, feature, channelSelect, choice, id, row } from '../ui.js';

export function communitySection(guild) {
  const emoji = wallEmoji(guild.id);
  return [
    feature(guild, 'etoiles', `${setting(guild.id, 'stars_test') ? '1 (test de débogage)' : option(guild.id, 'stars_threshold')} ${emoji} · ${one('stars_channel', guild)}`),
    choice(guild, 'stars_threshold', 'Réactions nécessaires', (v) => `${v} réactions pour entrer`),
    row(
      new StringSelectMenuBuilder()
        .setCustomId(id('stars_emoji'))
        .setPlaceholder('Emoji du Hall of Fame')
        .addOptions([
          ...Object.entries(EMOJI_CHOICES).map(([value, label]) => ({ label: `${value} ${label}`, value, default: value === emoji })),
          ...(EMOJI_CHOICES[emoji] ? [] : [{ label: 'Emoji personnalisé actuel', value: 'actuel', default: true }]),
          { label: 'Autre emoji…', value: 'autre', description: 'Un emoji au choix, ou un emoji du serveur' },
        ]),
    ),
    channelSelect('stars_channel', 'Salon du Hall of Fame', [setting(guild.id, 'stars_channel')], 1),
    separator(),
    feature(guild, 'anniversaires', one('birthday_channel', guild)),
    channelSelect('birthday_channel', 'Salon des anniversaires (bienvenue sinon)', [setting(guild.id, 'birthday_channel')], 1),
    separator(),
    feature(guild, 'synchro', 'annonce temporaire sous le message'),
    row(
      new StringSelectMenuBuilder()
        .setCustomId(id('synchro_palier'))
        .setPlaceholder('Régler un palier : message et rôle')
        .addOptions(
          MILESTONES.map((m) => {
            const role = guild.roles?.cache.get(paliers(guild.id)[m]);
            return { label: `${m} %`, value: String(m), description: `${role ? `@${role.name}` : 'sans rôle'} · ${milestoneMessages(guild.id)[m] ? 'message perso' : 'message par défaut'}`.slice(0, 100) };
          }),
        ),
    ),
    separator(),
    feature(guild, 'sondages'),
    feature(guild, 'evenements'),
  ];
}
