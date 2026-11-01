import { StringSelectMenuBuilder } from 'discord.js';
import { option, settingList } from '../../core/config.js';
import { PRESENCE_ITEMS } from '../../features/presence/presence.js';
import { id, row, text, separator, feature, choice } from '../ui.js';

export function statusSection(guild) {
  const items = settingList(guild.id, 'presence_items').filter((key) => PRESENCE_ITEMS[key]);
  const chosen = items.length ? items : Object.keys(PRESENCE_ITEMS);
  const night = option(guild.id, 'presence_night');
  return [
    feature(guild, 'statut', `${chosen.length} info(s) en rotation · veille ${night === 'aucune' ? 'jamais la nuit' : `de ${night.replace('-', ' h à ')} h`}`),
    separator(),
    text('**En rotation toutes les 3 min**\n-# Pendant une réponse, un débat ou un vote, le statut montre ce qui se passe.'),
    row(
      new StringSelectMenuBuilder()
        .setCustomId(id('presence_items'))
        .setPlaceholder('Infos en rotation')
        .setMinValues(1)
        .setMaxValues(Object.keys(PRESENCE_ITEMS).length)
        .addOptions(Object.entries(PRESENCE_ITEMS).map(([value, label]) => ({ label, value, default: chosen.includes(value) }))),
    ),
    text('**Veille** (pastille lune)\n-# MAGI répond quand même : il repasse au vert dès qu’on lui parle.'),
    choice(guild, 'presence_night', 'Veille la nuit', (v) => (v === 'aucune' ? 'Pas de veille la nuit' : `La nuit, de ${v.replace('-', ' h à ')} h`)),
    choice(guild, 'presence_idle', 'Veille sans messages', (v) => (v === '0' ? 'Jamais faute de messages' : `Après ${v} min sans message sur le serveur`)),
  ];
}
