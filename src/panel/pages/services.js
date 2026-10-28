import { ButtonBuilder, ButtonStyle, ChannelType } from 'discord.js';
import { setting } from '../../core/settings.js';
import { id, one, row, separator, feature, channelSelect } from '../ui.js';

export function servicesSection(guild) {
  return [
    feature(guild, 'tickets', one('tickets_channel', guild)),
    channelSelect('tickets_channel', 'Salon du panneau de tickets', [setting(guild.id, 'tickets_channel')], 1),
    row(new ButtonBuilder().setCustomId(id('tickets_post')).setLabel('Publier le panneau de tickets').setStyle(ButtonStyle.Primary)),
    separator(),
    feature(guild, 'vocal_temporaire', one('voice_hub', guild)),
    channelSelect('voice_hub', 'Salon vocal générateur', [setting(guild.id, 'voice_hub')], 1, [ChannelType.GuildVoice]),
    row(new ButtonBuilder().setCustomId(id('voice_hub_create')).setLabel('Créer le salon générateur').setStyle(ButtonStyle.Secondary)),
  ];
}
