import { speak } from '../discord/webhooks.js';
import { activePersonas } from '../server/config.js';
import { addReminder, cancelReminder, dueReminders, markDone, pendingReminders } from '../storage/reminders.js';
import { log } from '../logging/log.js';

const CHECK_EVERY = 10_000;
const DAY = 24 * 3600_000;
const LINES = { melchior: 'Rappel', balthasar: 'Petit rappel', casper: "C'est l'heure" };

export function stamp(ms, now = Date.now()) {
  const s = Math.floor(ms / 1000);
  return ms - now < DAY ? `à <t:${s}:t> (<t:${s}:R>)` : `le <t:${s}:F> (<t:${s}:R>)`;
}

export function dueFrom(args, now = Date.now()) {
  const minutes = Number(args.minutes);
  if (Number.isFinite(minutes) && minutes > 0) return now + Math.round(minutes * 60_000);
  return Date.parse(String(args.date ?? ''));
}

export function reminderLine(persona, text) {
  const body = text.trim().replace(/[.!\s]+$/, '');
  const start = /^\p{Lu}\p{Ll}/u.test(body) ? body[0].toLowerCase() + body.slice(1) : body;
  return `${LINES[persona] ?? LINES.balthasar} : ${start}.`;
}

export const REMINDER_TOOLS = [
  {
    name: 'rappel',
    description:
      "Programme un rappel pour la personne qui écrit. Délai relatif (« dans 10 min », « dans 2 h ») : donne minutes, le code calcule l'heure exacte. Heure précise (« demain à 18h ») : donne date, calculée à partir de la date et de l'heure actuelles données dans tes consignes.",
    parameters: {
      type: 'object',
      properties: {
        minutes: { type: 'number', description: 'Délai en minutes à partir de maintenant, pour « dans … ».' },
        date: { type: 'string', description: 'Date et heure précises en ISO 8601 avec le décalage horaire, par exemple 2026-10-26T18:00:00+01:00.' },
        texte: { type: 'string', description: 'Ce qu’il faut rappeler, en quelques mots, sans « rappelle-moi ».' },
      },
      required: ['texte'],
    },
    access: 'everyone',
    async run({ guild, member, message, persona, args }) {
      const dueAt = dueFrom(args);
      const result = addReminder({ guildId: guild.id, channelId: message.channel.id, userId: member.id, text: String(args.texte ?? ''), dueAt, persona, messageId: message.id });
      if (result.error) return `Rappel refusé : ${result.error}`;
      return `Rappel n°${result.id} enregistré, il tombera ${stamp(dueAt)}. Confirme en une phrase et recopie ce format de date Discord tel quel.`;
    },
  },
  {
    name: 'mes_rappels',
    description: 'Liste les rappels en attente de la personne qui écrit.',
    parameters: { type: 'object', properties: {} },
    access: 'everyone',
    readonly: true,
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

async function deliver(client, reminder) {
  const channel = await client.channels.fetch(reminder.channel_id).catch(() => null);
  if (!channel) return;
  const active = activePersonas(reminder.guild_id);
  const persona = active.includes(reminder.persona) ? reminder.persona : active.includes('balthasar') ? 'balthasar' : active[0];
  const source = reminder.message_id ? await channel.messages.fetch(reminder.message_id).catch(() => null) : null;
  const line = reminderLine(persona, reminder.text);
  await speak(channel, persona, source ? line : `<@${reminder.user_id}> ${line}`, { mentions: [reminder.user_id], replyTo: source ?? undefined })
    .then(() => log.info('rappels', `n°${reminder.id} envoyé à <@${reminder.user_id}> par ${persona}`, { channel }))
    .catch((err) => log.err('rappels', `échec n°${reminder.id} : ${err.message}`, { channel }));
}

export function startReminders(client) {
  setInterval(async () => {
    for (const reminder of dueReminders()) {
      markDone(reminder.id);
      await deliver(client, reminder);
    }
  }, CHECK_EVERY);
}
