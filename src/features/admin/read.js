import { AuditLogEvent, ChannelType } from 'discord.js';
import { findMember } from './resolve.js';
import { activeInfractions } from '../moderation/store.js';
import { clamp, discordTime } from '../../core/util.js';

const AUDIT_NAMES = Object.fromEntries(Object.entries(AuditLogEvent).filter(([, v]) => typeof v === 'number').map(([k, v]) => [v, k]));
const day = (ms) => new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
const none = { type: 'object', properties: {} };

export const READ_TOOLS = [
  {
    name: 'infos_membre',
    description: "Informations de modération sur un membre : arrivée sur le serveur, âge du compte, rôles, exclusion temporaire en cours.",
    parameters: { type: 'object', properties: { membre: { type: 'string', description: 'Mention, identifiant ou pseudo.' } }, required: ['membre'] },
    access: 'operator',
    readonly: true,
    async run({ guild, args }) {
      const m = await findMember(guild, args.membre);
      if (!m) return `Membre introuvable : ${args.membre}`;
      const roles = m.roles.cache.filter((r) => r.id !== guild.id).map((r) => r.name).join(', ') || 'aucun';
      const timeout = m.communicationDisabledUntilTimestamp > Date.now() ? `exclu jusqu'au ${discordTime(m.communicationDisabledUntilTimestamp, 'F')}` : 'aucune exclusion en cours';
      return `${m.displayName} (${m.user.username}) : arrivé le ${day(m.joinedTimestamp)}, compte créé le ${day(m.user.createdTimestamp)}, rôles : ${roles}, ${timeout}, ${activeInfractions(guild.id, m.id).length} infraction(s) sur 30 jours.`;
    },
  },
  {
    name: 'liste_roles',
    description: 'Liste les rôles du serveur, du plus haut au plus bas, avec leur nombre de membres connus.',
    parameters: none,
    access: 'operator',
    readonly: true,
    async run({ guild }) {
      const lines = [...guild.roles.cache.values()]
        .filter((r) => r.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .map((r, i) => `${i + 1}. ${r.name}${r.managed ? ' (intégration)' : ''}${r.id === guild.members.me.roles.highest.id ? ' (rôle de MAGI : rien au-dessus ne peut être modifié)' : ''} : ${r.members.size} membre(s)`);
      return `Hiérarchie, du plus haut (1) au plus bas :\n${lines.join('\n')}`;
    },
  },
  {
    name: 'liste_salons',
    description: 'Liste les catégories et salons du serveur.',
    parameters: none,
    access: 'operator',
    readonly: true,
    async run({ guild }) {
      const channels = [...guild.channels.cache.values()].sort((a, b) => a.rawPosition - b.rawPosition);
      const lines = [];
      for (const cat of channels.filter((c) => c.type === ChannelType.GuildCategory)) {
        lines.push(`${cat.name} :`, ...channels.filter((c) => c.parentId === cat.id).map((c) => `  - ${c.name}`));
      }
      const loose = channels.filter((c) => !c.parentId && c.type !== ChannelType.GuildCategory);
      if (loose.length) lines.push('Sans catégorie :', ...loose.map((c) => `  - ${c.name}`));
      return lines.join('\n');
    },
  },
  {
    name: 'journal_audit',
    description: "Dernières actions du journal d'audit Discord (qui a fait quoi).",
    parameters: { type: 'object', properties: { nombre: { type: 'integer', description: '10 par défaut, 25 au maximum.' } } },
    access: 'operator',
    readonly: true,
    async run({ guild, args }) {
      const logs = await guild.fetchAuditLogs({ limit: clamp(Number(args.nombre) || 10, 1, 25) });
      return [...logs.entries.values()]
        .map((e) => `- ${discordTime(e.createdTimestamp)} ${e.executor?.username ?? '?'} : ${AUDIT_NAMES[e.action] ?? e.action}${e.target?.username || e.target?.name ? ` → ${e.target.username ?? e.target.name}` : ''}${e.reason ? ` (${e.reason})` : ''}`)
        .join('\n') || 'Journal vide.';
    },
  },
];
