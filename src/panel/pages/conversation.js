import { interventionChannels } from '../../features/conversation/interventions.js';
import { PAGE_MODULES, channels, separator, feature, channelSelect } from '../ui.js';

export function conversationSection(guild) {
  const interventions = interventionChannels(guild.id);
  return [
    feature(guild, 'interventions', channels(interventions)),
    channelSelect('interventions', 'Salons des interventions spontanées', interventions, 25),
    separator(),
    ...PAGE_MODULES.conversation.slice(1).map((key) => feature(guild, key)),
  ];
}
