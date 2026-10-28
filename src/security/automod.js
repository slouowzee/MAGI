import {
  AutoModerationActionType as A,
  AutoModerationRuleEventType,
  AutoModerationRuleKeywordPresetType as K,
  AutoModerationRuleTriggerType as T,
  PermissionFlagsBits as P,
} from 'discord.js';
import { moduleEnabled, option, settingList } from '../server/config.js';
import { logChannels, operatorRole } from '../server/installation.js';
import { honeypotOf } from './honeypot.js';
import { log } from '../logging/log.js';

export const PRESETS = { insultes: K.Profanity, sexuel: K.SexualContent, injures: K.Slurs };
export const PRESET_LABELS = { insultes: 'Insultes', sexuel: 'Contenu sexuel', injures: 'Injures haineuses' };
const SCAMS = ['free nitro', 'nitro free', 'nitro gratuit', '*dlscord*', '*d1scord*', '*disc0rd*', '*discorcl*', '*discrod*', '*discord-nitro*', '*nitro-gift*', '*steamcommunlty*', '*steamcomunity*', '*stearncommunity*'];
const BLOCKED = 'Message bloqué par MAGI : contenu interdit sur ce serveur.';
const PREFIX = 'MAGI · ';
const SINGLE = new Set([T.KeywordPreset, T.Spam, T.MentionSpam]);
const queues = new Map();

export function automodPresets(guildId) {
  const chosen = settingList(guildId, 'automod_presets').filter((p) => PRESETS[p] !== undefined);
  return chosen.length ? chosen : Object.keys(PRESETS);
}

export function wantedRules(guild) {
  const alert = logChannels(guild).moderation;
  const block = { type: A.BlockMessage, metadata: { customMessage: BLOCKED } };
  const notify = alert ? [{ type: A.SendAlertMessage, metadata: { channel: alert } }] : [];
  const timeout = guild.members.me.permissions.has(P.ModerateMembers) ? [{ type: A.Timeout, metadata: { durationSeconds: 600 } }] : [];
  const common = {
    eventType: AutoModerationRuleEventType.MessageSend,
    enabled: true,
    exemptRoles: [operatorRole(guild)?.id].filter(Boolean),
    exemptChannels: [honeypotOf(guild)?.id].filter(Boolean),
  };
  return [
    { ...common, name: `${PREFIX}Filtres`, triggerType: T.KeywordPreset, triggerMetadata: { presets: automodPresets(guild.id).map((p) => PRESETS[p]) }, actions: [block, ...notify] },
    { ...common, name: `${PREFIX}Mentions`, triggerType: T.MentionSpam, triggerMetadata: { mentionTotalLimit: Number(option(guild.id, 'automod_mentions')), mentionRaidProtectionEnabled: true }, actions: [block, ...notify, ...timeout] },
    { ...common, name: `${PREFIX}Spam`, triggerType: T.Spam, actions: [block, ...notify] },
    { ...common, name: `${PREFIX}Arnaques`, triggerType: T.Keyword, triggerMetadata: { keywordFilter: SCAMS }, actions: [block, ...notify, ...timeout] },
  ];
}

async function sync(guild) {
  if (!guild.members.me.permissions.has(P.ManageGuild)) return;
  const me = guild.client.user.id;
  const rules = [...(await guild.autoModerationRules.fetch()).values()];
  const mine = rules.filter((r) => r.creatorId === me && r.name.startsWith(PREFIX));
  const wanted = moduleEnabled(guild.id, 'automod') ? wantedRules(guild) : [];
  for (const rule of mine) if (!wanted.some((w) => w.name === rule.name)) await rule.delete('MAGI : AutoMod coupé');
  for (const { triggerType, ...rule } of wanted) {
    const existing = mine.find((r) => r.name === rule.name);
    if (existing) await existing.edit(rule);
    else if (SINGLE.has(triggerType) && rules.some((r) => r.triggerType === triggerType)) log.notice('automod', `${rule.name} : une règle du même type existe déjà, elle est conservée`, { guild });
    else await guild.autoModerationRules.create({ ...rule, triggerType, reason: 'MAGI : AutoMod' });
  }
}

export function syncAutomod(guild) {
  const run = (queues.get(guild.id) ?? Promise.resolve()).then(() => sync(guild));
  queues.set(guild.id, run.catch(() => {}));
  return run;
}
