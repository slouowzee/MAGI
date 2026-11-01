import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits as P } from 'discord.js';
import { channelSetting, moduleEnabled, option, settingList } from '../../core/config.js';
import { setSetting, setting } from '../../core/settings.js';
import { log } from '../../core/log/log.js';
import { COLOR } from '../../core/discord/embeds.js';

const ROLE = 'Non vérifié';
const CHANNEL = '✅・verification';
const DAY = 86_400_000;
const REASON = "MAGI : filtre à l'arrivée";

export const gateRole = (guild) => guild.roles.cache.get(setting(guild.id, 'gate_role')) ?? null;
export const gateChannel = (guild) => channelSetting(guild, 'gate_channel');

export function gateReasons(member, guild, { now = Date.now(), lockdown = false } = {}) {
  const rules = settingList(guild.id, 'gate_rules');
  const reasons = [];
  if (lockdown) reasons.push('raid en cours');
  if (rules.includes('tous')) reasons.push('tous les nouveaux');
  const minAge = Number(option(guild.id, 'gate_min_age'));
  if (minAge && now - member.user.createdTimestamp < minAge * DAY) reasons.push(`compte de moins de ${minAge} j`);
  if (rules.includes('avatar') && !member.user.avatar) reasons.push('sans avatar');
  return reasons;
}

function verifyMessage() {
  return {
    embeds: [new EmbedBuilder().setColor(COLOR).setDescription("# Vérification\n### Clique sur le bouton pour accéder au serveur.")],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('magi-sec:verifier').setLabel('Je suis humain').setStyle(ButtonStyle.Success))],
  };
}

async function hideEverywhere(guild, role, gate) {
  for (const channel of guild.channels.cache.values()) {
    if (channel.id === gate.id || channel.isThread?.()) continue;
    if (channel.permissionOverwrites.cache.get(role.id)?.deny.has(P.ViewChannel)) continue;
    await channel.permissionOverwrites.edit(role, { ViewChannel: false }, { reason: REASON }).catch(() => {});
  }
}

export async function ensureGate(guild) {
  if (!moduleEnabled(guild.id, 'filtre_arrivee')) return null;
  let role = gateRole(guild);
  if (!role) {
    role = await guild.roles.create({ name: ROLE, permissions: [], reason: REASON });
    setSetting(guild.id, 'gate_role', role.id);
  }
  let channel = gateChannel(guild);
  if (!channel) {
    channel = await guild.channels.create({
      name: CHANNEL,
      type: ChannelType.GuildText,
      position: 0,
      reason: REASON,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
        { id: role.id, allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages, P.AddReactions] },
        { id: guild.members.me.id, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks] },
      ],
    });
    setSetting(guild.id, 'gate_channel', channel.id);
    await channel.send(verifyMessage());
  }
  await hideEverywhere(guild, role, channel);
  return { role, channel };
}

export async function hideNewChannel(channel) {
  const role = gateRole(channel.guild);
  if (!role || channel.isThread?.() || channel.permissionOverwrites.cache.get(role.id)?.allow.has(P.ViewChannel)) return;
  await channel.permissionOverwrites.edit(role, { ViewChannel: false }, { reason: REASON }).catch(() => {});
}

export async function gateMember(member, { lockdown = false } = {}) {
  const { guild } = member;
  if (member.user.bot || !moduleEnabled(guild.id, 'filtre_arrivee')) return false;
  const reasons = gateReasons(member, guild, { lockdown });
  if (!reasons.length) return false;
  const gate = await ensureGate(guild);
  if (!gate) return false;
  await member.roles.add(gate.role, REASON);
  log.notice('filtre', `${member} doit passer la vérification · ${reasons.filter((r) => r !== 'tous les nouveaux').join(', ') || 'tous les nouveaux passent par là'}`, { guild });
  return true;
}

export async function verifyMember(member) {
  const role = gateRole(member.guild);
  if (!role || !member.roles.cache.has(role.id)) return false;
  await member.roles.remove(role, 'MAGI : vérifié');
  log.info('filtre', `${member.user.tag} vérifié`, { guild: member.guild });
  return true;
}
