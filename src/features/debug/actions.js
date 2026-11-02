import { join } from 'node:path';
import { backupDir, backupDatabase, listBackups, scheduleRestore } from '../../core/db.js';
import { listSettings, setSetting, setting } from '../../core/settings.js';
import { setModule } from '../../core/config.js';
import { logChannels, operatorRole } from '../../core/installation.js';
import { log } from '../../core/log/log.js';
import { digestText, parisDay, statsOf } from '../../core/log/digest.js';
import { isAppOwner, ownerGuilds } from '../../core/log/discord.js';
import { clearPauses, forceProvider, lastCall, simulateOutage } from '../../core/llm/client.js';
import { deleteCase, getCase, guildCases, purgeMember, resetCases, usersOnRecord, wipeInfractions } from '../moderation/store.js';
import { markPurged, updateCase } from '../moderation/cases.js';
import { fromMagi, sweep } from '../commands/write.js';
import { backupMemory, forgetGuild, forgetUser } from '../memory/store.js';
import { closeAllConversations } from '../conversation/threads.js';
import { handleMessage } from '../conversation/handle-message.js';
import { cancelAnyReminder, guildReminders } from '../reminders/store.js';
import { celebrate } from '../community/birthdays.js';
import { saveSynchro, synchroOf } from '../community/store.js';
import { pointsFor, rateOf } from '../community/synchro.js';
import { unlock } from '../security/raid.js';
import { syncAutomod } from '../security/automod.js';
import { gateChannel, gateRole } from '../security/gate.js';
import { refreshPanel } from '../../panel/index.js';
import { syncCommands } from '../commands/commands.js';
import { exportConfig, importConfig, readConfig } from './config.js';
import { clamp, discordTime } from '../../core/util.js';

const DEBUG_LEVEL_FOR = 15 * 60_000;
const SOURCES = ['logs', 'moderation', 'securite', 'systeme'];
const RESET_PREFIXES = ['module:', 'stars_', 'gate_rules', 'gate_min_age', 'raid_threshold', 'welcome_channel', 'birthday_channel', 'tickets_channel', 'voice_hub', 'roles_channel', 'personas', 'persona_channels:', 'muted_channels', 'log_level', 'presence_', 'automod_', 'server_', 'digest'];
const idOf = (text) => String(text ?? '').match(/\d{17,20}/)?.[0] ?? null;
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const field = (id, label, { placeholder = '', required = true, long = false, choices = null, file = false, user = false } = {}) => ({ id, label, placeholder, required, long, choices, file, user });

async function emptyChannel(channel, botId) {
  const { deleted } = await sweep(channel, 1000, (m) => fromMagi(m, botId));
  let old = 0;
  let before;
  for (let page = 0; page < 3 && old < 100; page++) {
    const batch = [...(await channel.messages.fetch({ limit: 100, before }).catch(() => new Map())).values()];
    if (!batch.length) break;
    before = batch.at(-1).id;
    for (const message of batch.filter((m) => fromMagi(m, botId)).slice(0, 100 - old)) if (await message.delete().then(() => true).catch(() => false)) old++;
  }
  return deleted + old;
}

export const ACTIONS = {
  cas_reset: {
    label: 'Remettre les cas à 1',
    confirm: ({ guild }) => `Supprimer les ${guildCases(guild.id).length} cas du serveur et vider leurs cartes ? La numérotation repart à 1.`,
    async run({ guild, member }) {
      const cases = resetCases(guild.id);
      for (const c of cases) await markPurged(guild, c, member.displayName, Date.now(), 'réinitialisé');
      return `${plural(cases.length, 'cas')} supprimé${cases.length > 1 ? 's' : ''}, le prochain portera le n°1.`;
    },
  },
  cas_modifier: {
    label: 'Modifier ou supprimer un cas',
    fields: [field('cas', 'Numéro du cas', { placeholder: '12' }), field('change', 'supprimer, motif=…, sanction=… ou statut=…', { placeholder: 'motif=spam en vocal' })],
    confirm: ({ params }) => `Cas #${Number(params.cas)} : ${params.change.trim()} ?`,
    async run({ guild, member, params }) {
      const c = getCase(Number(params.cas));
      if (!c || c.guildId !== guild.id) throw new Error(`cas #${params.cas} introuvable`);
      const change = params.change.trim();
      if (/^supprimer$/i.test(change)) {
        deleteCase(c.id);
        await markPurged(guild, c, member.displayName, Date.now(), 'supprimé');
        return `Cas #${c.id} supprimé.`;
      }
      const [, key, value] = change.match(/^(motif|sanction|statut)\s*=\s*(.+)$/i) ?? [];
      if (!key) throw new Error('écris « supprimer », ou motif=…, sanction=…, statut=active ou statut=annulee');
      const patch = { motif: { reasons: [value] }, sanction: { action: value }, statut: { status: value } }[key.toLowerCase()];
      if (patch.status && !['active', 'annulee'].includes(value)) throw new Error('statut possible : active ou annulee');
      updateCase(guild, c.id, patch, { event: `${key.toLowerCase()} modifié par ${member.displayName} (débogage)` });
      return `Cas #${c.id} : ${key.toLowerCase()} = ${value}.`;
    },
  },
  infractions: {
    label: 'Effacer des infractions',
    fields: [field('membre', 'Membre (vide = tout le serveur)', { user: true, required: false })],
    confirm: ({ params }) => (idOf(params.membre) ? `Effacer toutes les infractions de <@${idOf(params.membre)}> ?` : 'Effacer toutes les infractions du serveur ? Tous les compteurs repartent à zéro.'),
    async run({ guild, params }) {
      const n = wipeInfractions(guild.id, idOf(params.membre));
      return `${plural(n, 'infraction')} effacée${n > 1 ? 's' : ''}.`;
    },
  },
  casiers: {
    label: 'Purger tous les casiers',
    confirm: ({ guild }) => `Purger les casiers de ${plural(usersOnRecord(guild.id).length, 'membre')} : cas et infractions effacés, cartes vidées. Les exclusions et bans en cours restent.`,
    async run({ guild, member }) {
      let cases = 0;
      let infractions = 0;
      for (const userId of usersOnRecord(guild.id)) {
        const record = purgeMember(guild.id, userId);
        for (const c of record.cases) await markPurged(guild, c, member.displayName);
        cases += record.cases.length;
        infractions += record.infractions;
      }
      return `Casiers purgés : ${plural(cases, 'cas')}, ${plural(infractions, 'infraction')}.`;
    },
  },
  logs_vider: {
    label: 'Vider un salon de logs',
    fields: [field('salon', 'Salon à vider', { choices: { logs: '#magi-logs', moderation: '#magi-moderation', securite: '#magi-securite', systeme: '#magi-systeme', tous: 'Tous les salons de logs' } })],
    confirm: ({ params }) => `Supprimer les messages de MAGI dans ${params.salon === 'tous' ? 'tous les salons de logs' : `#magi-${params.salon}`} ?`,
    async run({ guild, params }) {
      const wanted = params.salon.toLowerCase();
      if (wanted !== 'tous' && !SOURCES.includes(wanted)) throw new Error(`salon inconnu : ${wanted}`);
      const channels = logChannels(guild);
      const done = [];
      for (const source of wanted === 'tous' ? SOURCES : [wanted]) if (channels[source]) done.push(`${channels[source]} : ${await emptyChannel(channels[source], guild.client.user.id)}`);
      return `Messages de MAGI supprimés · ${done.join(' · ') || 'aucun salon trouvé'}`;
    },
  },
  resume: {
    label: 'Résumé quotidien : envoyer ou remettre à zéro',
    fields: [field('choix', 'Que faire ?', { choices: { envoyer: 'Envoyer le résumé du jour maintenant', reset: 'Remettre les compteurs à zéro' } })],
    confirm: ({ params }) => (params.choix === 'reset' ? 'Remettre à zéro tous les compteurs du résumé quotidien ?' : null),
    async run({ guild, client, member, params }) {
      const choice = params.choix.toLowerCase();
      if (choice === 'reset') {
        let n = 0;
        for (const scope of isAppOwner(member.id) ? [guild.id, 'global'] : [guild.id]) {
          for (const row of listSettings(scope, 'stats:')) {
            setSetting(scope, row.key, null);
            n++;
          }
        }
        return `${plural(n, 'compteur')} remis à zéro.`;
      }
      if (choice !== 'envoyer') throw new Error('écris envoyer ou reset');
      const today = parisDay(Date.now()).day;
      const owner = ownerGuilds(client).some((g) => g.id === guild.id);
      await logChannels(guild).logs?.send({ content: digestText(today, statsOf(guild.id, today), owner ? statsOf('global', today) : null).replace('Résumé du', 'Résumé en cours du'), allowedMentions: { parse: [] } });
      return 'Résumé du jour envoyé dans #magi-logs.';
    },
  },
  logs_debug: {
    label: 'Logs en niveau débogage pendant 15 min',
    async run({ guild }) {
      if (!setting(guild.id, 'log_level_until')) setSetting(guild.id, 'log_level_before', setting(guild.id, 'log_level') ?? 'notice');
      setSetting(guild.id, 'log_level', 'debug');
      setSetting(guild.id, 'log_level_until', Date.now() + DEBUG_LEVEL_FOR);
      return `Logs en niveau débogage jusqu'à ${discordTime((Date.now() + DEBUG_LEVEL_FOR), 't')}, puis retour au niveau d'avant.`;
    },
  },
  memoire: {
    label: 'Effacer la mémoire de MAGI',
    fields: [field('membre', 'Membre (vide = tout le serveur)', { user: true, required: false })],
    confirm: ({ params }) => (idOf(params.membre) ? `Effacer tout ce que MAGI retient de <@${idOf(params.membre)}> ?` : 'Effacer toute la mémoire de MAGI sur ce serveur ? Faits et résumés de conversation de tout le monde.'),
    async run({ guild, params }) {
      if (backupDir) await backupMemory(join(backupDir, `memoire-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`));
      const userId = idOf(params.membre);
      if (userId) {
        const { facts, summaries } = await forgetUser(guild.id, userId);
        return `Mémoire de <@${userId}> effacée : ${plural(facts, 'fait')}, ${plural(summaries, 'résumé')}.`;
      }
      return `Mémoire du serveur effacée : ${plural(await forgetGuild(guild.id), 'souvenir')}.`;
    },
  },
  conversations: {
    label: 'Fermer toutes les conversations',
    async run({ guild }) {
      return `${plural(closeAllConversations(guild.id), 'conversation')} fermée(s) : le prochain message repart de zéro.`;
    },
  },
  rejouer: {
    label: 'Faire répondre MAGI à un message',
    fields: [field('lien', 'Lien du message', { placeholder: 'https://discord.com/channels/…' })],
    async run({ guild, params }) {
      const [, channelId, messageId] = params.lien.match(/channels\/\d+\/(\d+)\/(\d+)/) ?? [];
      const message = channelId && (await guild.channels.cache.get(channelId)?.messages.fetch(messageId).catch(() => null));
      if (!message) throw new Error('message introuvable : colle son lien (clic droit → Copier le lien)');
      handleMessage(message, { force: true }).catch((err) => log.err('debug', `réponse forcée impossible : ${err.message}`, { guild }));
      return `MAGI répond à ${message.url}.`;
    },
  },
  modeles: {
    global: true,
    label: 'Modèles : pauses, forcer un modèle, simuler une panne',
    fields: [
      field('choix', 'Que faire ?', { choices: { lever: 'Lever toutes les pauses', gemini: 'Ne faire répondre que Gemini', groq: 'Ne faire répondre que Groq', auto: "Revenir à l'ordre normal", panne: 'Simuler une panne de Gemini' } }),
      field('minutes', 'Durée de la panne en minutes', { placeholder: '5', required: false }),
    ],
    async run({ params }) {
      const choice = params.choix.toLowerCase();
      if (choice === 'panne') {
        const minutes = clamp(Number(params.minutes) || 5, 1, 60);
        simulateOutage('gemini', minutes * 60_000);
        return `Gemini en pause simulée pendant ${minutes} min : les réponses passent par le relais.`;
      }
      if (choice === 'lever') {
        clearPauses();
        return 'Pauses levées : tous les modèles sont de nouveau disponibles.';
      }
      if (choice === 'auto') {
        forceProvider(null);
        return 'Ordre normal rétabli : Gemini, puis le relais.';
      }
      forceProvider(choice);
      return `Seul ${choice} répond désormais, jusqu'à « auto » ou au prochain redémarrage.`;
    },
  },
  requete: {
    global: true,
    label: 'Voir la dernière requête au modèle',
    async run() {
      const call = lastCall();
      if (!call) return 'Aucune requête depuis le démarrage.';
      return { content: `Dernière requête ${discordTime(call.at)}, ${call.ms} ms, ${call.answer?.model ?? 'échec'}${call.error ? ` : ${call.error}` : ''}.`, files: [{ attachment: Buffer.from(JSON.stringify(call, null, 2)), name: 'derniere-requete.json' }] };
    },
  },
  rappels: {
    label: 'Voir ou supprimer des rappels',
    fields: [field('numero', 'Numéro à supprimer (vide = lister)', { placeholder: '12', required: false })],
    async run({ guild, params }) {
      const id = Number(params.numero);
      if (id) return cancelAnyReminder(id, guild.id) ? `Rappel n°${id} supprimé.` : `Aucun rappel n°${id} en attente.`;
      const list = guildReminders(guild.id);
      return list.length ? `**${plural(list.length, 'rappel')} en attente**\n${list.slice(0, 25).map((r) => `- n°${r.id} · <@${r.user_id}> · ${r.text} · ${discordTime(r.due_at)}`).join('\n')}` : 'Aucun rappel en attente.';
    },
  },
  anniversaires: {
    label: 'Lancer les anniversaires du jour',
    async run({ guild }) {
      const sent = await celebrate(guild, Date.now(), { force: true });
      return sent ? `${plural(sent, 'anniversaire')} souhaité${sent > 1 ? 's' : ''}.` : "Aucun anniversaire aujourd'hui, ou aucun salon où l'annoncer.";
    },
  },
  hall: {
    label: 'Hall of Fame dès 1 réaction (ou seuil normal)',
    async run({ guild }) {
      const on = !setting(guild.id, 'stars_test');
      setSetting(guild.id, 'stars_test', on ? '1' : null);
      return on ? 'Hall of Fame en test : un message y entre dès 1 réaction, jusqu’à la fin du mode débogage ou un nouveau choix de cette action.' : 'Hall of Fame revenu au seuil normal.';
    },
  },
  synchro: {
    label: "Modifier la synchro d'un membre",
    fields: [field('membre', 'Membre', { user: true }), field('valeur', 'Points, ou taux en %', { placeholder: '50 %' })],
    confirm: ({ params }) => `Mettre la synchro de <@${idOf(params.membre)}> à ${params.valeur.trim()} ?`,
    async run({ guild, params }) {
      const userId = idOf(params.membre);
      if (!userId) throw new Error('membre introuvable');
      const value = Number(params.valeur.replace(/[^\d.]/g, ''));
      if (!Number.isFinite(value)) throw new Error('valeur invalide');
      const points = params.valeur.includes('%') ? pointsFor(Math.min(value, 400)) : Math.round(value);
      saveSynchro(guild.id, userId, points, synchroOf(guild.id, userId).last_at ?? 0);
      return `Synchro de <@${userId}> : ${points} points, soit ${rateOf(points)} %.`;
    },
  },
  simulation: {
    label: 'Simuler un raid ou un nuke',
    fields: [field('type', 'Que simuler ?', { choices: { raid: 'Un raid (arrivées en masse)', nuke: 'Un nuke (destruction en masse)' } })],
    async run({ guild, member, params }) {
      const type = params.type.toLowerCase();
      const operators = operatorRole(guild);
      const mention = { users: [guild.ownerId], roles: operators ? [operators.id] : [] };
      if (type === 'raid') log.alert('antiraid', '[Test] Raid probable : 12 arrivées en moins d’une minute. Simulation, aucun salon verrouillé.', { guild, mention });
      else if (type === 'nuke') log.alert('antinuke', `[Test] Destruction en masse par ${member} : suppression de salons en moins d'une minute. Simulation, aucune mesure prise.`, { guild, mention });
      else throw new Error('écris raid ou nuke');
      return `Alerte de test envoyée dans #magi-securite.`;
    },
  },
  securite: {
    label: 'Anti-raid et AutoMod : lever, resynchroniser, supprimer',
    fields: [field('choix', 'Que faire ?', { choices: { lever: 'Lever le verrouillage anti-raid', resync: 'Resynchroniser les règles AutoMod', supprimer: 'Supprimer les règles AutoMod de MAGI' } })],
    confirm: ({ params }) => (params.choix === 'supprimer' ? 'Supprimer toutes les règles AutoMod « MAGI · … » et couper le module AutoMod ?' : null),
    async run({ guild, member, params }) {
      const choice = params.choix.toLowerCase();
      if (choice === 'lever') return `Verrouillage levé : ${plural(await unlock(guild, `débogage, ${member.displayName}`), 'salon')} rouvert(s).`;
      if (choice === 'resync') {
        await syncAutomod(guild);
        return 'Règles AutoMod resynchronisées.';
      }
      if (choice === 'supprimer') {
        setModule(guild.id, 'automod', false);
        await syncAutomod(guild);
        return 'Règles AutoMod de MAGI supprimées, module coupé.';
      }
      throw new Error('écris lever, resync ou supprimer');
    },
  },
  filtre: {
    label: "Réinitialiser le filtre à l'arrivée",
    confirm: () => "Supprimer le rôle « Non vérifié » et le salon de vérification, et couper le filtre à l'arrivée ? Les membres en attente retrouvent l'accès.",
    async run({ guild }) {
      const reason = 'MAGI, débogage : filtre réinitialisé';
      await gateRole(guild)?.delete(reason).catch(() => {});
      await gateChannel(guild)?.delete(reason).catch(() => {});
      for (const key of ['gate_role', 'gate_channel']) setSetting(guild.id, key, null);
      setModule(guild.id, 'filtre_arrivee', false);
      return 'Filtre réinitialisé : rôle et salon supprimés, module coupé.';
    },
  },
  reglage: {
    label: 'Lire ou modifier un réglage brut',
    fields: [field('cle', 'Clé', { placeholder: 'stars_threshold' }), field('valeur', 'Valeur (vide = lire, null = supprimer)', { required: false })],
    confirm: ({ params }) => (params.valeur?.trim() ? `Réglage ${params.cle.trim()} = ${params.valeur.trim()} ?` : null),
    async run({ guild, params }) {
      const key = params.cle.trim();
      const value = params.valeur?.trim();
      if (!value) {
        const matches = listSettings(guild.id, key).slice(0, 20);
        return matches.length ? matches.map((r) => `\`${r.key}\` = \`${String(r.value).slice(0, 150)}\``).join('\n') : `Aucun réglage commençant par \`${key}\`.`;
      }
      setSetting(guild.id, key, value === 'null' ? null : value);
      return value === 'null' ? `\`${key}\` supprimé.` : `\`${key}\` = \`${value}\`.`;
    },
  },
  configuration: {
    label: 'Exporter ou importer la configuration',
    fields: [
      field('mode', 'Que faire ?', { choices: { exporter: 'Exporter en fichier', importer: 'Importer le fichier joint' } }),
      field('fichier', 'Fichier à importer (.json exporté)', { file: true, required: false }),
    ],
    async confirm({ params }) {
      if (params.mode !== 'importer') return null;
      if (!params.fichier) throw new Error('joins le fichier .json exporté pour importer');
      params.data = readConfig(await (await fetch(params.fichier)).text());
      const { data } = params;
      return `Importer la configuration de « ${data.guild?.name ?? '?'} » exportée ${discordTime((Date.parse(data.at) || Date.now()))} : ${Object.keys(data.settings).length} réglages, modération ${data.moderation} ? Les réglages du même nom sont remplacés.`;
    },
    async run({ guild, params }) {
      if (params.mode === 'importer') {
        const n = importConfig(guild, params.data);
        await syncCommands(guild).catch(() => {});
        await refreshPanel(guild).catch(() => {});
        return `Configuration importée : ${plural(n, 'réglage')}.`;
      }
      return { content: 'Configuration exportée. Pour la réimporter : même action, « Importer le fichier joint ».', files: [{ attachment: Buffer.from(JSON.stringify(exportConfig(guild), null, 2)), name: `magi-config-${guild.id}.json` }] };
    },
  },
  config_reset: {
    label: 'Remettre la configuration à zéro',
    confirm: () => "Remettre toute la configuration à zéro : modules, salons des fonctions, unités, réglages du statut, AutoMod et logs ? L'installation (catégorie MAGI, salons de logs, panneau) est gardée.",
    async run({ guild }) {
      let n = 0;
      for (const row of listSettings(guild.id, '')) {
        if (!RESET_PREFIXES.some((prefix) => row.key.startsWith(prefix))) continue;
        setSetting(guild.id, row.key, null);
        n++;
      }
      await syncCommands(guild).catch(() => {});
      await syncAutomod(guild).catch(() => {});
      await refreshPanel(guild).catch(() => {});
      return `Configuration remise à zéro : ${plural(n, 'réglage')} effacé${n > 1 ? 's' : ''}.`;
    },
  },
  republier: {
    label: 'Republier le panneau et les commandes',
    async run({ guild }) {
      await refreshPanel(guild, { repost: true });
      await syncCommands(guild);
      return 'Panneau republié et commandes réenregistrées.';
    },
  },
  restaurer: {
    global: true,
    label: 'Restaurer une copie de la base',
    ownBackup: true,
    fields: [field('copie', 'Nom de la copie (vide = la plus récente)', { required: false })],
    confirm: ({ params }) => {
      const name = params.copie?.trim() || listBackups()[0]?.name;
      if (!name) throw new Error('aucune copie disponible');
      return `Remplacer la base par ${name} et redémarrer MAGI ? L'état actuel est copié avant. Copies : ${listBackups().slice(0, 5).map((b) => b.name).join(', ')}`;
    },
    async run(ctx) {
      const name = ctx.params.copie?.trim() || listBackups()[0]?.name;
      backupDatabase('avant-restauration', name);
      scheduleRestore(name);
      ctx.restart = true;
      return `Restauration de ${name} programmée : MAGI redémarre.`;
    },
  },
  redemarrer: {
    global: true,
    label: 'Redémarrer MAGI',
    confirm: () => 'Redémarrer MAGI maintenant ? Quelques secondes de coupure.',
    async run(ctx) {
      ctx.restart = true;
      return 'MAGI redémarre.';
    },
  },
};
