import { ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { CASES, DECORS, MODES, PRESETS, SEPARATORS } from '../../features/server/styles.js';
import { FEATURES } from '../../features/server/plan.js';
import { lastSetup } from '../../features/server/apply.js';
import { serverFeatures, serverStyle } from '../../features/server/tools.js';
import { id, row, separator, text } from '../ui.js';
import { discordTime } from '../../core/util.js';

const select = (field, placeholder, entries, current) =>
  row(
    new StringSelectMenuBuilder()
      .setCustomId(id(field))
      .setPlaceholder(placeholder)
      .addOptions(Object.entries(entries).map(([value, label]) => ({ label: label.slice(0, 100), value, default: value === current }))),
  );

export function serverSection(guild) {
  const style = serverStyle(guild);
  const features = serverFeatures(guild);
  const last = lastSetup(guild);
  return [
    text(`**Mise en place du serveur**\n-# Choisis le style et ce qu'il faut préparer, puis prévisualise : rien n'est appliqué sans ton clic, et tout peut être annulé.${last ? `\n-# Dernière mise en place ${discordTime(last.at)}.` : ''}`),
    select('server_style', 'Style du serveur', Object.fromEntries(Object.entries(PRESETS).map(([k, p]) => [k, p.label])), style.preset),
    select('server_mode', 'Mode', MODES, style.mode),
    separator(),
    text('**Nommage**\n-# « Tel quel » laisse le style des noms à la consigne.'),
    select('server_sep', 'Séparateur', Object.fromEntries(Object.entries(SEPARATORS).map(([k, s]) => [k, `Séparateur ${s}`])), style.separator),
    select('server_case', 'Casse', CASES, style.casing),
    select('server_decor', 'Catégories', DECORS, style.decor),
    row(
      new StringSelectMenuBuilder()
        .setCustomId(id('server_naming'))
        .setPlaceholder('Sans emoji, en français')
        .setMinValues(0)
        .setMaxValues(2)
        .addOptions([
          { label: 'Emojis dans les noms', value: 'emoji', default: style.emoji },
          { label: 'Noms en anglais', value: 'en', default: style.english },
        ]),
    ),
    separator(),
    text('**À mettre en place**'),
    row(
      new StringSelectMenuBuilder()
        .setCustomId(id('server_features'))
        .setPlaceholder('Seulement la structure')
        .setMinValues(0)
        .setMaxValues(Object.keys(FEATURES).length)
        .addOptions(Object.entries(FEATURES).map(([value, label]) => ({ label, value, default: features.includes(value) }))),
    ),
    separator(),
    row([
      new ButtonBuilder().setCustomId(id('server_preview')).setLabel('Prévisualiser').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(id('server_audit')).setLabel('Audit').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(id('server_template')).setLabel('Enregistrer comme modèle').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(id('server_link')).setLabel('Lien de modèle Discord').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(id('server_rollback')).setLabel('Annuler la dernière').setStyle(ButtonStyle.Danger).setDisabled(!last),
    ]),
  ];
}
