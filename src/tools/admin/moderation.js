import { activeInfractions, MODES, moderationMode, revokeLastInfraction, setModerationMode } from '../../storage/moderation.js';
import { findMember } from './resolve.js';

const MODE_TEXT = {
  observation: "observation : le bot note dans #magi-logs ce qu'il aurait fait, sans agir",
  active: 'active : le bot supprime, avertit, exclut et peut bannir après un vote',
  desactivee: 'désactivée : aucune surveillance',
};

export const MODERATION_TOOLS = [
  {
    name: 'mode_moderation',
    description: 'Affiche ou change le mode de la modération automatique : observation, active ou desactivee.',
    parameters: { type: 'object', properties: { mode: { type: 'string', enum: MODES, description: 'Vide pour seulement afficher le mode actuel.' } } },
    access: 'operator',
    panel: true,
    async run({ guild, args }) {
      if (args.mode) setModerationMode(guild.id, args.mode);
      const { mode, since } = moderationMode(guild.id);
      return `Modération automatique en mode ${MODE_TEXT[mode]} (depuis <t:${Math.floor(since / 1000)}:R>).`;
    },
  },
  {
    name: 'infractions_membre',
    description: "Liste les infractions de modération d'un membre sur les 30 derniers jours.",
    parameters: { type: 'object', properties: { membre: { type: 'string' } }, required: ['membre'] },
    access: 'operator',
    async run({ guild, args }) {
      const m = await findMember(guild, args.membre);
      if (!m) return `Membre introuvable : ${args.membre}`;
      const list = activeInfractions(guild.id, m.id);
      return list.length ? `${m.displayName} : ${list.length} infraction(s) sur 30 jours\n${list.map((i) => `- <t:${Math.floor(i.created_at / 1000)}:R> ${i.reason}`).join('\n')}` : `${m.displayName} n'a aucune infraction sur 30 jours.`;
    },
  },
  {
    name: 'annuler_sanction',
    description: "Annule la dernière sanction automatique d'un membre : retire sa dernière infraction et lève son exclusion temporaire.",
    parameters: { type: 'object', properties: { membre: { type: 'string' } }, required: ['membre'] },
    access: 'operator',
    async run({ guild, args, reason }) {
      const m = await findMember(guild, args.membre);
      if (!m) return `Membre introuvable : ${args.membre}`;
      const revoked = revokeLastInfraction(guild.id, m.id);
      if (m.communicationDisabledUntilTimestamp > Date.now()) await m.timeout(null, reason);
      return `${revoked ? 'Dernière infraction retirée' : 'Aucune infraction à retirer'} et exclusion levée pour ${m.displayName}.`;
    },
  },
];
