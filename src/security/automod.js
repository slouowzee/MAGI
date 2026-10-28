import {
  AutoModerationActionType as A,
  AutoModerationRuleEventType as E,
  AutoModerationRuleKeywordPresetType as K,
  AutoModerationRuleTriggerType as T,
  PermissionFlagsBits as P,
} from 'discord.js';
import { moduleEnabled, option, settingList } from '../server/config.js';
import { logChannels, operatorRole } from '../server/installation.js';
import { setSetting, setting } from '../storage/settings.js';
import { honeypotOf } from './honeypot.js';
import { log } from '../logging/log.js';

export const PRESETS = { insultes: K.Profanity, sexuel: K.SexualContent, injures: K.Slurs };
export const PRESET_LABELS = { insultes: 'Insultes', sexuel: 'Contenu sexuel', injures: 'Injures haineuses' };
export const FAMILIES = {
  recrutement: {
    label: 'Faux recrutement',
    regex: [
      '(upwork|fiverr|freelancer)\\b.{0,40}\\b(hiring|job|rent|account|earn|paid|salary|payment)',
      '(\\$\\s?\\d{2,}|\\d{2,}k?\\s?(\\$|usd|eur|€|euros?|dollars?))\\s*(per|a|an|every|/|par)\\s*(day|week|hour|jour|semaine|heure)',
      'looking for\\s*\\d+\\s*(people|persons|individuals|serious)',
      '\\d+\\s*%\\s*of\\s*(the|my|your)\\s*(profits?|earnings)',
      'only\\s*\\d+\\s*(hours?|hrs?)\\s*(a|per)\\s*(day|week)',
    ],
  },
  giveaways: {
    label: 'Faux giveaways',
    regex: [
      'mr\\.?\\s?beast.{0,40}(giveaway|gift|free|claim|prize|reward|\\$)',
      '(giveaway|gift|free|claim).{0,40}mr\\.?\\s?beast',
      '(first|premiers?)\\s*\\d+\\s*(people|users|members|personnes).{0,40}(free|gift|claim|nitro|win|gagn|\\$)',
      'claim\\s*(your|the)\\s*(reward|prize|gift|bonus)',
      '(steam|amazon|apple|psn|google play)\\s*gift\\s*cards?.{0,40}(free|claim|giveaway)',
    ],
  },
  crypto: {
    label: 'Arnaques crypto',
    regex: [
      '(seed|recovery|secret)\\s*phrase',
      'connect\\s*(your\\s*)?wallet|wallet\\s*connect|validate\\s*(your\\s*)?wallet',
      '(double|x2|x10)\\s*(your\\s*)?(btc|bitcoin|eth|crypto|usdt)',
      '(crypto|forex|bitcoin|trading)\\s*(investment|signals?|mentor|expert|account manager)',
      '\\d{2,}\\s*%\\s*(daily|weekly|guaranteed)\\s*(profits?|returns?|roi)',
      '(metamask|trust\\s*wallet|binance|coinbase)\\s*(support|help\\s*desk|team)',
      '(free|claim).{0,20}airdrop',
    ],
  },
  support: {
    label: 'Faux support',
    regex: [
      '(accidentally|mistakenly|by mistake)\\s*(reported|flagged|banned)',
      '(signal[ée]|report[ée]|banni)\\s*(ton|votre)?\\s*compte\\s*par\\s*erreur',
      'par\\s*erreur.{0,30}(signal|report)',
      '(discord|steam)\\s*(staff|support|trust\\s*(and|&)\\s*safety).{0,40}(contact|dm|add|message|write)',
      'your\\s*account\\s*(will\\s*be|has\\s*been|is\\s*going\\s*to\\s*be)\\s*(banned|disabled|terminated|suspended)',
      '(contact|add|dm)\\s*(this|the)\\s*(admin|moderator|staff)',
    ],
  },
  adulte: {
    label: 'Bots 18+',
    regex: [
      '(onlyfans|nudes?|nsfw|18\\+|porn)\\s*(leaks?|server|discord|content|free)',
      '(hot|sexy|horny)\\s*(girls?|teens?|singles?).{0,40}(discord\\.gg|https?://|join|dm)',
      '(discord\\.gg|https?://).{0,40}(nudes?|onlyfans|nsfw|18\\+)',
      'teen\\s*(leaks?|nudes?)',
    ],
  },
  nitro: {
    label: 'Nitro et faux domaines',
    keywords: ['free nitro', 'nitro free', 'nitro gratuit', '*dlscord*', '*d1scord*', '*disc0rd*', '*discorcl*', '*discrod*', '*discord-nitro*', '*nitro-gift*', '*steamcommunlty*', '*steamcomunity*', '*stearncommunity*'],
  },
};
const PROFILE = ['discord staff', 'discord support', 'discord team', 'discord mod*', 'trust and safety', 'trust & safety', 'steam support', 'mrbeast*', 'mr beast', 'free nitro', 'nitro gift*', 'metamask support', 'crypto support'];
export const RULE_LABELS = { ...Object.fromEntries(Object.entries(FAMILIES).map(([key, f]) => [key, f.label])), pseudos: 'Pseudos suspects' };
const PREFIX = 'MAGI · ';
const SINGLE = new Set([T.KeywordPreset, T.Spam, T.MentionSpam, T.MemberProfile]);
const queues = new Map();

export function automodPresets(guildId) {
  const chosen = settingList(guildId, 'automod_presets').filter((p) => PRESETS[p] !== undefined);
  return chosen.length ? chosen : Object.keys(PRESETS);
}

export function automodRules(guildId) {
  const raw = setting(guildId, 'automod_rules');
  return raw === null ? Object.keys(RULE_LABELS) : raw.split(',').filter((key) => RULE_LABELS[key]);
}

export function setAutomodRules(guildId, keys) {
  setSetting(guildId, 'automod_rules', keys.join(',') || 'aucune');
}

export function automodAllowList(guildId) {
  return (setting(guildId, 'automod_allow') ?? '').split('\n').filter(Boolean);
}

export function setAutomodAllowList(guildId, text) {
  const words = [...new Set(text.split(/[,\n]/).map((w) => w.trim().slice(0, 60)).filter(Boolean))].slice(0, 100);
  setSetting(guildId, 'automod_allow', words.join('\n') || null);
  return words;
}

export function wantedRules(guild) {
  const alert = logChannels(guild).moderation;
  const notify = alert ? [{ type: A.SendAlertMessage, metadata: { channel: alert } }] : [];
  const block = (reason) => ({ type: A.BlockMessage, metadata: { customMessage: `Message bloqué par MAGI (${reason}).` } });
  const timeout = guild.members.me.permissions.has(P.ModerateMembers) ? [{ type: A.Timeout, metadata: { durationSeconds: 600 } }] : [];
  const allowList = automodAllowList(guild.id);
  const chosen = automodRules(guild.id);
  const exemptRoles = [operatorRole(guild)?.id].filter(Boolean);
  const common = { eventType: E.MessageSend, enabled: true, exemptRoles, exemptChannels: [honeypotOf(guild)?.id].filter(Boolean) };
  return [
    { ...common, name: `${PREFIX}Filtres`, triggerType: T.KeywordPreset, triggerMetadata: { presets: automodPresets(guild.id).map((p) => PRESETS[p]), allowList }, actions: [block('contenu interdit'), ...notify] },
    { ...common, name: `${PREFIX}Mentions`, triggerType: T.MentionSpam, triggerMetadata: { mentionTotalLimit: Number(option(guild.id, 'automod_mentions')), mentionRaidProtectionEnabled: true }, actions: [block('trop de mentions'), ...notify, ...timeout] },
    { ...common, name: `${PREFIX}Spam`, triggerType: T.Spam, actions: [block('spam'), ...notify] },
    ...Object.entries(FAMILIES)
      .filter(([key]) => chosen.includes(key))
      .map(([, f]) => ({
        ...common,
        name: `${PREFIX}${f.label}`,
        triggerType: T.Keyword,
        triggerMetadata: { keywordFilter: f.keywords ?? [], regexPatterns: (f.regex ?? []).map((p) => `(?i)${p}`), allowList },
        actions: [block(f.label.toLowerCase()), ...notify, ...timeout],
      })),
    ...(chosen.includes('pseudos')
      ? [{ name: `${PREFIX}Pseudos suspects`, eventType: E.MemberUpdate, enabled: true, exemptRoles, triggerType: T.MemberProfile, triggerMetadata: { keywordFilter: PROFILE }, actions: [{ type: A.BlockMemberInteraction }, ...notify] }]
      : []),
  ];
}

async function attempt(guild, name, action) {
  try {
    await action();
  } catch (err) {
    log.warning('automod', `${name} : ${err.message}`, { guild });
  }
}

async function sync(guild) {
  if (!guild.members.me.permissions.has(P.ManageGuild)) return;
  const rules = [...(await guild.autoModerationRules.fetch()).values()];
  const mine = rules.filter((r) => r.name.startsWith(PREFIX));
  const wanted = moduleEnabled(guild.id, 'automod') ? wantedRules(guild) : [];
  for (const rule of mine) if (!wanted.some((w) => w.name === rule.name)) await attempt(guild, rule.name, () => rule.delete('MAGI : règle AutoMod retirée'));
  for (const { triggerType, ...rule } of wanted) {
    const existing = mine.find((r) => r.name === rule.name);
    const adopted = !existing && SINGLE.has(triggerType) ? rules.find((r) => r.triggerType === triggerType && r.enabled && !r.name.startsWith(PREFIX)) : null;
    if (adopted) {
      await attempt(guild, rule.name, async () => {
        await adopted.edit(rule).catch((err) => {
          throw err.status === 404 ? new Error(`« ${adopted.name} » ne peut pas être modifiée par une app, coupe-la dans Paramètres du serveur → AutoMod pour que MAGI la remplace`) : err;
        });
        log.notice('automod', `règle « ${adopted.name} » reprise par MAGI sous le nom ${rule.name}`, { guild });
      });
      continue;
    }
    await attempt(guild, rule.name, () => (existing ? existing.edit(rule) : guild.autoModerationRules.create({ ...rule, triggerType, reason: 'MAGI : AutoMod' })));
  }
}

export function syncAutomod(guild) {
  const run = (queues.get(guild.id) ?? Promise.resolve()).then(() => sync(guild));
  queues.set(guild.id, run.catch(() => {}));
  return run;
}
