import { GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel, PermissionFlagsBits as P } from 'discord.js';
import { isOperator } from '../../core/installation.js';
import { setSetting } from '../../core/settings.js';
import { deleteBirthday, setBirthday, synchroOf, synchroTop } from './store.js';
import { addReminder } from '../reminders/store.js';
import { MILESTONES, paliers, rateOf } from './synchro.js';
import { DANGEROUS } from '../admin/role-panels.js';
import { findChannel, targetRole } from '../admin/resolve.js';

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function eventDraft(guild, args) {
  const start = Date.parse(String(args.debut ?? ''));
  if (!Number.isFinite(start)) throw new Error('date de début invalide, il faut une date complète avec le fuseau horaire');
  if (start < Date.now() + 60_000) throw new Error('la date de début est déjà passée');
  const end = start + Math.min(Math.max(Number(args.duree_minutes) || 120, 15), 24 * 60) * 60_000;
  const voice = args.salon_vocal ? findChannel(guild, args.salon_vocal) : null;
  if (args.salon_vocal && !voice?.isVoiceBased?.()) throw new Error(`salon vocal introuvable : ${args.salon_vocal}`);
  return { start, end, voice, title: String(args.titre ?? '').trim().slice(0, 100) };
}

const day = (ms) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(ms);

export const COMMUNITY_TOOLS = [
  {
    name: 'sondage',
    module: 'sondages',
    description: 'Publie un sondage Discord natif dans le salon actuel, quand quelqu’un demande un sondage.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '300 caractères au plus.' },
        choix: { type: 'array', items: { type: 'string' }, description: 'De 2 à 10 réponses possibles, 55 caractères chacune au plus.' },
        duree_heures: { type: 'integer', description: 'De 1 à 168, 24 par défaut.' },
        choix_multiple: { type: 'boolean' },
      },
      required: ['question', 'choix'],
    },
    access: 'everyone',
    async run({ message, args }) {
      const answers = [...new Set((args.choix ?? []).map((c) => String(c).trim().slice(0, 55)).filter(Boolean))].slice(0, 10);
      if (answers.length < 2) throw new Error('il faut au moins deux réponses');
      const sent = await message.channel.send({
        poll: { question: { text: String(args.question).slice(0, 300) }, answers: answers.map((text) => ({ text })), duration: Math.min(Math.max(Number(args.duree_heures) || 24, 1), 168), allowMultiselect: Boolean(args.choix_multiple) },
      });
      return `Sondage publié : ${sent.url}`;
    },
  },
  {
    name: 'evenement',
    module: 'evenements',
    description:
      "Crée un événement Discord programmé (soirée jeux, réunion…) et un rappel 15 min avant pour la personne qui le demande. La date de début est complète avec le fuseau horaire de Paris, calculée à partir de la date du jour. Un bouton de confirmation est affiché.",
    parameters: {
      type: 'object',
      properties: {
        titre: { type: 'string' },
        debut: { type: 'string', description: 'Date et heure ISO 8601 avec fuseau, par exemple 2026-10-30T21:00:00+01:00.' },
        duree_minutes: { type: 'integer', description: '120 par défaut.' },
        salon_vocal: { type: 'string', description: "Salon vocal où ça se passe, s'il y en a un." },
        lieu: { type: 'string', description: 'Lieu en texte libre, sinon « Sur le serveur ».' },
        description: { type: 'string' },
      },
      required: ['titre', 'debut'],
    },
    access: 'everyone',
    confirm({ guild, member, args }) {
      if (!isOperator(member) && !member.permissions.has(P.CreateEvents)) throw new Error("il faut la permission Discord « Créer des événements »");
      const { start, title } = eventDraft(guild, args);
      return `Créer « ${title} » le ${day(start)}`;
    },
    async run({ guild, member, message, persona, args, reason }) {
      const { start, end, voice, title } = eventDraft(guild, args);
      const event = await guild.scheduledEvents.create({
        name: title,
        scheduledStartTime: start,
        scheduledEndTime: end,
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: voice ? GuildScheduledEventEntityType.Voice : GuildScheduledEventEntityType.External,
        channel: voice ?? undefined,
        entityMetadata: voice ? undefined : { location: String(args.lieu || 'Sur le serveur').slice(0, 100) },
        description: args.description ? String(args.description).slice(0, 1000) : undefined,
        reason,
      });
      const reminder = addReminder({ guildId: guild.id, channelId: message.channel.id, userId: member.id, text: `« ${title} » commence dans 15 min`, dueAt: start - 15 * 60_000, persona, messageId: message.id });
      return `Événement créé : https://discord.com/events/${guild.id}/${event.id}${reminder.id ? ', rappel 15 min avant' : ''}.`;
    },
  },
  {
    name: 'anniversaire',
    module: 'anniversaires',
    description: "Enregistre (ou supprime) la date d'anniversaire de la personne qui écrit, pour que MAGI le lui souhaite le jour venu. Jamais pour quelqu'un d'autre.",
    parameters: { type: 'object', properties: { jour: { type: 'integer' }, mois: { type: 'integer' }, supprimer: { type: 'boolean' } } },
    access: 'everyone',
    async run({ guild, member, args }) {
      if (args.supprimer) return deleteBirthday(guild.id, member.id) ? 'Anniversaire supprimé.' : "Aucun anniversaire n'était enregistré.";
      const month = Number(args.mois);
      const date = Number(args.jour);
      if (!(month >= 1 && month <= 12 && date >= 1 && date <= DAYS_IN_MONTH[month - 1])) throw new Error('date invalide');
      setBirthday(guild.id, member.id, month, date);
      return `Anniversaire de ${member.displayName} enregistré : ${date}/${month}.`;
    },
  },
  {
    name: 'synchro',
    module: 'synchro',
    description: "Donne le taux de synchronisation (activité sur le serveur, de 0 à 400 %) de la personne qui écrit et le classement des cinq premiers.",
    parameters: { type: 'object', properties: {} },
    access: 'everyone',
    readonly: true,
    async run({ guild, member }) {
      const mine = rateOf(synchroOf(guild.id, member.id).points);
      const top = synchroTop(guild.id).map((r, i) => `${i + 1}. <@${r.user_id}> : ${rateOf(r.points)} %`);
      const roles = Object.entries(paliers(guild.id)).map(([t, id]) => `${t} % → <@&${id}>`);
      return [`Taux de ${member.displayName} : ${mine} %.`, 'Classement :', ...top, roles.length ? `Paliers : ${roles.join(', ')}` : 'Aucun rôle de palier.'].join('\n');
    },
  },
  {
    name: 'palier_synchro',
    module: 'synchro',
    description: 'Associe un rôle à un palier du taux de synchronisation (25, 50, 75, 100, 150, 200, 300 ou 400 %), ou retire l’association.',
    parameters: { type: 'object', properties: { pourcentage: { type: 'integer', enum: MILESTONES }, role: { type: 'string' }, retirer: { type: 'boolean' } }, required: ['pourcentage'] },
    access: 'operator',
    async run({ guild, args }) {
      const threshold = Number(args.pourcentage);
      if (!MILESTONES.includes(threshold)) throw new Error(`palier inconnu, choisis parmi ${MILESTONES.join(', ')} %`);
      const roles = paliers(guild.id);
      if (args.retirer) {
        delete roles[threshold];
        setSetting(guild.id, 'synchro_roles', JSON.stringify(roles));
        return `Palier ${threshold} % sans rôle.`;
      }
      const role = targetRole(guild, args.role);
      if (DANGEROUS.some((p) => role.permissions.has(p, false))) throw new Error(`${role.name} donne des permissions de gestion ou de modération`);
      if (!role.editable) throw new Error(`${role.name} est au-dessus du rôle de MAGI`);
      roles[threshold] = role.id;
      setSetting(guild.id, 'synchro_roles', JSON.stringify(roles));
      return `Rôle ${role.name} donné à ${threshold} % de synchronisation.`;
    },
  },
];

