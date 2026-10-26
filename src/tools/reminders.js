import { speak } from '../discord/webhooks.js';
import { addReminder, cancelReminder, dueReminders, markDone, pendingReminders } from '../storage/reminders.js';

const CHECK_EVERY = 30_000;
const stamp = (ms) => `<t:${Math.floor(ms / 1000)}:F> (<t:${Math.floor(ms / 1000)}:R>)`;

export const REMINDER_TOOLS = [
  {
    name: 'rappel',
    description:
      "Programme un rappel pour la personne qui écrit (« rappelle-moi demain à 18h de… »). Calcule la date à partir de la date et de l'heure actuelles données dans tes consignes.",
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date et heure du rappel en ISO 8601 avec le décalage horaire, par exemple 2026-10-26T18:00:00+01:00.' },
        texte: { type: 'string', description: 'Ce qu’il faut rappeler, en quelques mots.' },
      },
      required: ['date', 'texte'],
    },
    access: 'everyone',
    async run({ guild, member, message, args }) {
      const dueAt = Date.parse(String(args.date ?? ''));
      const result = addReminder({ guildId: guild.id, channelId: message.channel.id, userId: member.id, text: String(args.texte ?? ''), dueAt });
      if (result.error) return `Rappel refusé : ${result.error}`;
      return `Rappel n°${result.id} enregistré pour ${stamp(dueAt)}. Recopie tel quel ce format de date Discord dans ta réponse.`;
    },
  },
  {
    name: 'mes_rappels',
    description: 'Liste les rappels en attente de la personne qui écrit.',
    parameters: { type: 'object', properties: {} },
    access: 'everyone',
    async run({ guild, member }) {
      const list = pendingReminders(guild.id, member.id);
      if (!list.length) return 'Aucun rappel en attente.';
      return `Rappels en attente (recopie les dates telles quelles) :\n${list.map((r) => `- n°${r.id} : ${r.text}, ${stamp(r.due_at)}`).join('\n')}`;
    },
  },
  {
    name: 'annuler_rappel',
    description: "Annule un rappel en attente de la personne qui écrit, par son numéro (utilise mes_rappels si tu ne le connais pas).",
    parameters: { type: 'object', properties: { numero: { type: 'integer' } }, required: ['numero'] },
    access: 'everyone',
    async run({ guild, member, args }) {
      return cancelReminder(Number(args.numero), guild.id, member.id) ? `Rappel n°${args.numero} annulé.` : `Aucun rappel n°${args.numero} en attente à ce nom.`;
    },
  },
];

export function startReminders(client) {
  setInterval(async () => {
    for (const reminder of dueReminders()) {
      markDone(reminder.id);
      const channel = await client.channels.fetch(reminder.channel_id).catch(() => null);
      if (!channel) continue;
      await speak(channel, 'balthasar', `<@${reminder.user_id}> petit rappel : ${reminder.text}`, { mentions: [reminder.user_id] }).catch((err) =>
        console.error(`rappel n°${reminder.id} non envoyé :`, err.message),
      );
    }
  }, CHECK_EVERY);
}
