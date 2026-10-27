import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { channelSetting, moduleEnabled } from '../server/config.js';
import { setSetting, setting } from '../storage/settings.js';
import { log } from '../logging/log.js';

const HUB_NAME = '➕・Créer un salon';
const REASON = 'MAGI : salon vocal temporaire';

export const isTemporary = (guild, channelId) => Boolean(setting(guild.id, `tempvoice:${channelId}`));

export async function createHub(guild) {
  const hub = await guild.channels.create({ name: HUB_NAME, type: ChannelType.GuildVoice, reason: REASON });
  setSetting(guild.id, 'voice_hub', hub.id);
  return hub;
}

async function removeIfEmpty(channel) {
  if (!channel || !isTemporary(channel.guild, channel.id) || channel.members.size) return;
  setSetting(channel.guild.id, `tempvoice:${channel.id}`, null);
  await channel.delete(REASON).catch(() => {});
}

export async function handleVoiceState(before, after) {
  const guild = after.guild ?? before.guild;
  if (!moduleEnabled(guild.id, 'vocal_temporaire')) return removeIfEmpty(before.channel);
  if (before.channelId && before.channelId !== after.channelId) await removeIfEmpty(before.channel);
  const hub = channelSetting(guild, 'voice_hub');
  if (!hub || after.channelId !== hub.id || !after.member) return;
  const member = after.member;
  const channel = await guild.channels.create({
    name: `🔊・${member.displayName}`.slice(0, 100),
    type: ChannelType.GuildVoice,
    parent: hub.parentId ?? undefined,
    reason: REASON,
    permissionOverwrites: [...hub.permissionOverwrites.cache.values()].map((o) => ({ id: o.id, allow: o.allow, deny: o.deny, type: o.type })).concat([
      { id: member.id, allow: [P.ManageChannels, P.MoveMembers, P.MuteMembers, P.Connect, P.ViewChannel] },
    ]),
  });
  setSetting(guild.id, `tempvoice:${channel.id}`, member.id);
  await member.voice.setChannel(channel, REASON).catch(() => removeIfEmpty(channel));
  log.info('vocal', `salon temporaire de ${member.user.tag} créé`, { guild });
}

export async function cleanTemporary(client) {
  for (const guild of client.guilds.cache.values()) {
    for (const channel of guild.channels.cache.values()) if (channel.type === ChannelType.GuildVoice) await removeIfEmpty(channel);
  }
}
