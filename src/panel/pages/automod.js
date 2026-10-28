import {
  AutoModerationRuleTriggerType,
  ButtonBuilder,
  ButtonStyle,
  SectionBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { automodAllowList, automodPresets, automodRules, lockedRule, PRESET_LABELS, RULE_LABELS } from '../../features/security/automod.js';
import { id, row, text, separator, feature, choice } from '../ui.js';

export function automodSection(guild) {
  const rules = automodRules(guild.id);
  const presets = automodPresets(guild.id);
  const allow = automodAllowList(guild.id);
  const mentionsLock = lockedRule(guild.id, AutoModerationRuleTriggerType.MentionSpam);
  return [
    feature(guild, 'automod', `${rules.length + 3}/${Object.keys(RULE_LABELS).length + 3} règles`),
    separator(),
    text('**Arnaques et pseudos**\n-# Message bloqué, alerte, exclusion 10 min. Pseudo suspect : le membre ne peut plus écrire tant qu’il ne l’a pas changé.'),
    row(
      new StringSelectMenuBuilder()
        .setCustomId(id('automod_rules'))
        .setPlaceholder('Aucune règle anti-arnaque')
        .setMinValues(0)
        .setMaxValues(Object.keys(RULE_LABELS).length)
        .addOptions(Object.entries(RULE_LABELS).map(([value, label]) => ({ label, value, default: rules.includes(value) }))),
    ),
    text('**Filtres prédéfinis**\n-# Listes de Discord, efficaces surtout en anglais.'),
    row(
      new StringSelectMenuBuilder()
        .setCustomId(id('automod_presets'))
        .setPlaceholder('Filtres prédéfinis')
        .setMinValues(1)
        .setMaxValues(Object.keys(PRESET_LABELS).length)
        .addOptions(Object.entries(PRESET_LABELS).map(([value, label]) => ({ label, value, default: presets.includes(value) }))),
    ),
    ...(mentionsLock
      ? [text(`**Spam de mentions et spam**\n-# Le spam détecté par Discord est toujours bloqué. Les mentions restent gérées par « ${mentionsLock} », verrouillée par Discord : réglable dans Paramètres du serveur → AutoMod.`)]
      : [
          text('**Spam de mentions et spam**\n-# Le spam détecté par Discord est toujours bloqué.'),
          choice(guild, 'automod_mentions', 'Mentions par message', (v) => `Bloquer au-delà de ${v} mentions`),
        ]),
    separator(),
    new SectionBuilder()
      .addTextDisplayComponents(text(`**Liste blanche**\n${allow.length ? allow.join(', ').slice(0, 500) : 'Aucun mot'}\n-# Mots et expressions qui ne déclenchent jamais les règles.`))
      .setButtonAccessory(new ButtonBuilder().setCustomId(id('automod_allow')).setLabel('Modifier').setStyle(ButtonStyle.Secondary)),
  ];
}
