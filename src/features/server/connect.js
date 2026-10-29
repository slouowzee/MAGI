import {
  ChannelType,
  GuildDefaultMessageNotifications,
  GuildExplicitContentFilter,
  GuildOnboardingMode,
  GuildOnboardingPromptType,
  GuildVerificationLevel,
  PermissionFlagsBits as P,
} from 'discord.js';
import { moduleEnabled, setModule } from '../../core/config.js';
import { setSetting, setting } from '../../core/settings.js';
import { postTicketPanel } from '../community/tickets.js';
import { enableHoneypot, honeypotOf } from '../security/honeypot.js';
import { ensureGate } from '../security/gate.js';
import { syncAutomod } from '../security/automod.js';
import { publicationEmbed } from '../admin/publications.js';
import { savePublication } from '../admin/publications-store.js';
import { rolePanel } from '../admin/role-panels.js';
import { SELF_SERVICE } from './plan.js';

const HOOKS = {
  accueil: { key: 'welcome_channel', module: 'bienvenue' },
  hall_of_fame: { key: 'stars_channel', module: 'etoiles' },
  tickets: { key: 'tickets_channel', module: 'tickets', after: postTicketPanel },
  anniversaires: { key: 'birthday_channel', module: 'anniversaires' },
  generateur_vocal: { key: 'voice_hub', module: 'vocal_temporaire' },
  roles: { key: 'roles_channel' },
};
const SECURITY = { verification: 'filtre_arrivee', automod: 'automod' };
const VERIFICATION = { aucune: GuildVerificationLevel.None, faible: GuildVerificationLevel.Low, moyenne: GuildVerificationLevel.Medium, elevee: GuildVerificationLevel.High, tres_elevee: GuildVerificationLevel.VeryHigh };
const NOTIFICATIONS = { tout: GuildDefaultMessageNotifications.AllMessages, mentions: GuildDefaultMessageNotifications.OnlyMentions };
const FILTER = { desactive: GuildExplicitContentFilter.Disabled, sans_role: GuildExplicitContentFilter.MembersWithoutRoles, tous: GuildExplicitContentFilter.AllMembers };

const community = (guild) => guild.features?.includes('COMMUNITY');
const byName = (ctx, name) => ctx.channels.get(name) ?? ctx.guild.channels.cache.find((c) => c.name === name) ?? null;

function enable(ctx, name) {
  ctx.journal.push({ t: 'module', name, before: moduleEnabled(ctx.guild.id, name) });
  setModule(ctx.guild.id, name, true);
}

function remember(ctx, key, value) {
  ctx.journal.push({ t: 'setting', key, before: setting(ctx.guild.id, key) });
  setSetting(ctx.guild.id, key, value);
}

async function post(ctx, channel, payload, title) {
  const sent = await channel.send(payload);
  ctx.journal.push({ t: 'message', channelId: channel.id, id: sent.id });
  savePublication({ guildId: ctx.guild.id, channelId: channel.id, messageId: sent.id, title });
  return sent;
}

async function hook(ctx, op) {
  const channel = byName(ctx, op.channel);
  if (!channel) throw new Error(`salon ${op.channel} introuvable`);
  ctx.functions.set(op.fn, channel);
  const { guild, reason } = ctx;
  if (op.fn === 'regles' && community(guild)) {
    ctx.journal.push({ t: 'guild', before: { rulesChannel: guild.rulesChannelId } });
    await guild.setRulesChannel(channel, reason);
  }
  if (op.fn === 'afk' && channel.type === ChannelType.GuildVoice) {
    ctx.journal.push({ t: 'guild', before: { afkChannel: guild.afkChannelId } });
    await guild.setAFKChannel(channel, reason);
  }
  const target = HOOKS[op.fn];
  if (!target) return;
  remember(ctx, target.key, channel.id);
  if (target.module) enable(ctx, target.module);
  if (target.after) {
    const sent = await target.after(guild);
    ctx.journal.push({ t: 'message', channelId: sent.channel.id, id: sent.id });
  }
}

async function rolePanels(ctx) {
  const channel = ctx.functions.get('roles') ?? ctx.guild.channels.cache.get(setting(ctx.guild.id, 'roles_channel'));
  if (!channel) throw new Error('aucun salon de rôles dans le plan');
  for (const kind of Object.keys(SELF_SERVICE)) {
    const roles = ctx.self.filter((s) => s.kind === kind).map((s) => s.role.id);
    if (roles.length) await post(ctx, channel, rolePanel(ctx.guild, { roles, titre: SELF_SERVICE[kind], unique: kind === 'couleurs' }), `Rôles : ${SELF_SERVICE[kind]}`);
  }
}

async function content(ctx, op) {
  const channel = ctx.functions.get(op.fn) ?? (op.fn === 'regles' ? ctx.guild.rulesChannel : null);
  if (!channel) throw new Error(`aucun salon pour ${op.fn}`);
  const sent = await post(ctx, channel, { embeds: [publicationEmbed(ctx.guild, { titre: op.title, texte: op.text, type: op.type })], allowedMentions: { parse: [] } }, op.title ?? op.type);
  if (op.pin) await sent.pin().catch(() => {});
}

async function settings(ctx, op) {
  const { guild } = ctx;
  const edit = {};
  if (VERIFICATION[op.verification] !== undefined) edit.verificationLevel = VERIFICATION[op.verification];
  if (NOTIFICATIONS[op.notifications] !== undefined) edit.defaultMessageNotifications = NOTIFICATIONS[op.notifications];
  if (FILTER[op.filtre] !== undefined) edit.explicitContentFilter = FILTER[op.filtre];
  if (op.description && community(guild)) edit.description = op.description.slice(0, 120);
  if (!Object.keys(edit).length) return;
  ctx.journal.push({ t: 'guild', before: Object.fromEntries(Object.keys(edit).map((k) => [k, guild[k] ?? null])) });
  await guild.edit({ ...edit, reason: ctx.reason });
}

async function security(ctx, op) {
  const { guild, reason } = ctx;
  if (op.feature === 'honeypot') {
    if (honeypotOf(guild)) return;
    await enableHoneypot(guild, reason);
    ctx.journal.push({ t: 'honeypot' });
    return;
  }
  enable(ctx, SECURITY[op.feature]);
  if (op.feature === 'verification') await ensureGate(guild);
  if (op.feature === 'automod') await syncAutomod(guild);
}

export async function connect(ctx, op) {
  if (op.kind === 'fonction') return hook(ctx, op);
  if (op.kind === 'panneau_roles') return rolePanels(ctx);
  if (op.kind === 'contenu') return content(ctx, op);
  if (op.kind === 'reglages') return settings(ctx, op);
  if (op.kind === 'securite') return security(ctx, op);
  throw new Error(`opération inconnue : ${op.kind}`);
}

export async function finish(ctx) {
  const { guild } = ctx;
  if (!ctx.features.includes('reglages') || !community(guild)) return [];
  const before = await guild.fetchOnboarding();
  if (before.enabled) return ["Accueil natif de Discord déjà actif, laissé tel quel."];
  const everyone = guild.roles.everyone;
  const defaults = [...guild.channels.cache.values()].filter((c) => c.type === ChannelType.GuildText && c.permissionsFor(everyone)?.has(P.ViewChannel)).slice(0, 15);
  const prompts = Object.keys(SELF_SERVICE)
    .map((kind) => ({ kind, roles: ctx.self.filter((s) => s.kind === kind).map((s) => s.role) }))
    .filter((g) => g.roles.length)
    .map((g) => ({ title: SELF_SERVICE[g.kind], singleSelect: g.kind === 'couleurs', required: false, inOnboarding: true, type: GuildOnboardingPromptType.MultipleChoice, options: g.roles.slice(0, 50).map((r) => ({ title: r.name, roles: [r.id] })) }));
  ctx.journal.push({ t: 'onboarding', before: { enabled: false } });
  await guild.editOnboarding({ enabled: true, defaultChannels: defaults.map((c) => c.id), prompts, mode: GuildOnboardingMode.OnboardingDefault, reason: ctx.reason });
  return ["Accueil natif de Discord activé : salons par défaut et questions de rôles."];
}
