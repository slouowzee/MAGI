import { db } from '../../core/db.js';
import { countSettings, listSettings, setSetting } from '../../core/settings.js';
import { dropFiles } from '../commands/publication.js';

const table = (name, where = '') => ({
  count: (guildId) => db.query(`SELECT count(*) AS n FROM ${name} WHERE guild_id = ?${where}`).get(guildId).n,
  run: (guildId) => db.query(`DELETE FROM ${name} WHERE guild_id = ?${where}`).run(guildId).changes,
});

const prefixed = (prefix) => ({
  count: (guildId) => countSettings(guildId, prefix),
  run: (guildId) => {
    const rows = listSettings(guildId, prefix);
    for (const { key } of rows) setSetting(guildId, key, null);
    return rows.length;
  },
});

const scheduled = table('scheduled');

export const PURGES = {
  hall: { label: 'Hall of Fame : messages déjà repostés', note: 'Les cartes publiées restent, et ces messages pourront être repostés.', ...prefixed('star:') },
  synchro: { label: 'Synchro : points de tous les membres', note: 'Les rôles de palier déjà donnés restent.', ...table('synchro') },
  anniversaires: { label: 'Anniversaires enregistrés', ...table('birthdays') },
  rappels: { label: 'Rappels, faits ou en attente', ...table('reminders') },
  programmes: {
    label: 'Messages programmés et leurs images',
    count: scheduled.count,
    run: (guildId) => {
      for (const { id } of db.query('SELECT id FROM scheduled WHERE guild_id = ?').all(guildId)) dropFiles(id);
      return scheduled.run(guildId);
    },
  },
  publications: { label: 'Suivi des publications', note: 'Les messages restent, mais /ecrire ne les retrouve plus pour les modifier.', ...table('publications') },
  banque: { label: "Banque d'exemples apprise", ...table('examples', " AND persona != 'serveur'") },
  ton: { label: 'Ton du serveur', ...table('examples', " AND persona = 'serveur'") },
  notes: { label: 'Notes de modération sur les membres', ...prefixed('notes:') },
  tickets: { label: 'Suivi des tickets', note: 'Les fils restent, mais seuls les opérateurs pourront les fermer.', ...prefixed('ticket:') },
  vocaux: { label: 'Suivi des salons vocaux temporaires', note: 'Les salons restent et ne seront plus supprimés quand ils se vident.', ...prefixed('tempvoice:') },
  interventions: { label: 'Salons des interventions spontanées', ...table('interventions') },
  sauvegardes: { label: 'Sauvegardes de la structure du serveur', note: "L'anti-nuke ne pourra plus restaurer ce qu'elles contenaient.", ...table('backups') },
  stats: { label: 'Compteurs du résumé quotidien', ...prefixed('stats:') },
};

export const PURGE_ALL = 'tout';

const kinds = (kind) => (kind === PURGE_ALL ? Object.keys(PURGES) : [kind]);

export function purgeCount(guildId, kind) {
  if (kind !== PURGE_ALL && !PURGES[kind]) throw new Error('choix inconnu');
  return kinds(kind).reduce((n, k) => n + PURGES[k].count(guildId), 0);
}

export function purge(guildId, kind) {
  return kinds(kind).reduce((n, k) => n + PURGES[k].run(guildId), 0);
}
