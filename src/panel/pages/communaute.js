import { setting } from '../../core/settings.js';
import { option } from '../../core/config.js';
import { one, separator, feature, channelSelect, choice } from '../ui.js';

export function communitySection(guild) {
  return [
    feature(guild, 'etoiles', `${option(guild.id, 'stars_threshold')} 🔥 · ${one('stars_channel', guild)}`),
    choice(guild, 'stars_threshold', 'Flammes nécessaires', (v) => `${v} 🔥 pour entrer`),
    channelSelect('stars_channel', 'Salon du Hall of Fame', [setting(guild.id, 'stars_channel')], 1),
    separator(),
    feature(guild, 'anniversaires', one('birthday_channel', guild)),
    channelSelect('birthday_channel', 'Salon des anniversaires (bienvenue sinon)', [setting(guild.id, 'birthday_channel')], 1),
    separator(),
    feature(guild, 'synchro', setting(guild.id, 'synchro_channel') ? `annonces dans ${one('synchro_channel', guild)}` : 'annonces dans le salon du message'),
    channelSelect('synchro_channel', 'Salon des annonces de synchronisation', [setting(guild.id, 'synchro_channel')], 1),
    separator(),
    feature(guild, 'sondages'),
    feature(guild, 'evenements'),
  ];
}
