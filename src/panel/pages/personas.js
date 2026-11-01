import { StringSelectMenuBuilder } from 'discord.js';
import { PERSONAS } from '../../core/personas.js';
import { activePersonas, settingList } from '../../core/config.js';
import { id, row, text, separator, channelSelect } from '../ui.js';

export function personasSection(guild) {
  const personas = activePersonas(guild.id);
  const muted = settingList(guild.id, 'muted_channels');
  return [
    text('**Unités actives**'),
    row(
      new StringSelectMenuBuilder()
        .setCustomId(id('personas'))
        .setPlaceholder('Unités actives')
        .setMinValues(1)
        .setMaxValues(Object.keys(PERSONAS).length)
        .addOptions(Object.entries(PERSONAS).map(([value, p]) => ({ label: p.name, value, default: personas.includes(value) }))),
    ),
    separator(),
    text('**Unité par défaut**\n-# Celle qui répond à « magi, … » dans ces salons.'),
    ...Object.entries(PERSONAS).map(([key, p]) => channelSelect(`persona_ch:${key}`, `Salons de ${p.name}`, settingList(guild.id, `persona_channels:${key}`), 25)),
    separator(),
    text(`**Salons où MAGI se tait**\n-# ${muted.length ? `${muted.length} salon(s)` : 'Aucun'} : MAGI n'y répond pas et n'y intervient pas.`),
    channelSelect('muted', 'Salons où MAGI se tait', muted, 25),
  ];
}
