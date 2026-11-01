import { ButtonBuilder, ButtonStyle, SectionBuilder, StringSelectMenuBuilder } from 'discord.js';
import { honeypotOf } from '../../features/security/honeypot.js';
import { latestBackup } from '../../features/security/backup-store.js';
import { MODES, moderationMode } from '../../features/moderation/store.js';
import { MODE_LABELS, id, row, text, separator, feature } from '../ui.js';
import { discordTime } from '../../core/util.js';

export function securitySection(guild) {
  const trap = honeypotOf(guild);
  const backup = latestBackup(guild.id);
  const { mode } = moderationMode(guild.id);
  return [
    text('**Modération automatique**\n-# Spam, liens et insultes : observer seulement, agir, ou rien.'),
    row(
      new StringSelectMenuBuilder()
        .setCustomId(id('moderation'))
        .setPlaceholder('Modération automatique')
        .addOptions(MODES.map((value) => ({ label: MODE_LABELS[value], value, default: value === mode }))),
    ),
    separator(),
    feature(guild, 'administration'),
    feature(guild, 'antinuke'),
    feature(guild, 'sauvegardes', `dernière ${backup ? `${discordTime(backup.createdAt)}` : 'jamais'}`),
    separator(),
    new SectionBuilder()
      .addTextDisplayComponents(text(`**Honeypot**\n${trap ? `Actif · ${trap}` : 'Aucun'}\n-# Salon piège : tout message posté dedans entraîne un bannissement.`))
      .setButtonAccessory(
        trap
          ? new ButtonBuilder().setCustomId(id('honeypot')).setLabel('Supprimer').setStyle(ButtonStyle.Danger)
          : new ButtonBuilder().setCustomId(id('honeypot')).setLabel('Créer').setStyle(ButtonStyle.Success),
      ),
    separator(),
    row([
      new ButtonBuilder().setCustomId(id('audit')).setLabel('Lancer l’audit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(id('backup')).setLabel('Sauvegarder maintenant').setStyle(ButtonStyle.Secondary),
    ]),
  ];
}
