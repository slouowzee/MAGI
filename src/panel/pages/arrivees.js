import { StringSelectMenuBuilder } from 'discord.js';
import { setting } from '../../core/settings.js';
import { option, settingList } from '../../core/config.js';
import { id, one, row, separator, feature, channelSelect, choice } from '../ui.js';

export function arrivalsSection(guild) {
  const welcome = setting(guild.id, 'welcome_channel');
  const rules = settingList(guild.id, 'gate_rules');
  const age = option(guild.id, 'gate_min_age');
  const criteria = [age !== '0' && `comptes de moins de ${age} j`, rules.includes('avatar') && 'sans avatar', rules.includes('tous') && 'tous les nouveaux'].filter(Boolean);
  return [
    feature(guild, 'bienvenue', welcome ? one('welcome_channel', guild) : 'salon système du serveur'),
    channelSelect('welcome', 'Salon de bienvenue', [welcome], 1),
    separator(),
    feature(guild, 'filtre_arrivee', criteria.join(', ') || 'aucun critère'),
    choice(guild, 'gate_min_age', "Âge minimal du compte", (v) => (v === '0' ? "Pas de critère d'âge" : `Filtrer les comptes de moins de ${v} jour(s)`)),
    row(
      new StringSelectMenuBuilder()
        .setCustomId(id('gate_rules'))
        .setPlaceholder('Autres critères')
        .setMinValues(0)
        .setMaxValues(2)
        .addOptions([
          { label: 'Comptes sans avatar', value: 'avatar', default: rules.includes('avatar') },
          { label: 'Tous les nouveaux membres', value: 'tous', default: rules.includes('tous') },
        ]),
    ),
    separator(),
    feature(guild, 'anti_raid', `${option(guild.id, 'raid_threshold')} arrivées par minute`),
    choice(guild, 'raid_threshold', 'Seuil anti-raid', (v) => `Verrouiller à ${v} arrivées par minute`),
  ];
}
