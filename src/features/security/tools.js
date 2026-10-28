import { auditReport } from './audit.js';
import { backupGuild, missingFrom, restore } from './backup.js';
import { disableHoneypot, enableHoneypot, honeypotOf } from './honeypot.js';
import { latestBackup } from './backup-store.js';

export const SECURITY_TOOLS = [
  {
    name: 'honeypot',
    description:
      "Active ou désactive le honeypot, un salon piège à bots : un salon visible de tous, en haut de la liste, où personne ne doit écrire. Les comptes de spam écrivent partout et tombent dedans : bannissement et suppression de leurs messages des dernières 24 h. Opérateurs et modérateurs exemptés. Demande une confirmation.",
    parameters: { type: 'object', properties: { actif: { type: 'boolean' } }, required: ['actif'] },
    access: 'operator',
    panel: true,
    confirm({ guild, args }) {
      const current = honeypotOf(guild);
      if (args.actif && current) throw new Error(`le honeypot existe déjà : #${current.name}`);
      if (!args.actif && !current) throw new Error("il n'y a pas de honeypot");
      return args.actif ? 'Créer le honeypot' : `Supprimer #${current.name}`;
    },
    async run({ guild, args, reason }) {
      if (!args.actif) {
        await disableHoneypot(guild, reason);
        return 'Honeypot supprimé.';
      }
      const channel = await enableHoneypot(guild, reason);
      return `Honeypot actif : ${channel}. Tout message d'un membre sans rôle de modération y entraîne un bannissement.`;
    },
  },
  {
    name: 'audit_permissions',
    description:
      "Analyse la sécurité du serveur sans rien modifier : permissions dangereuses de @everyone, des rôles et des salons, niveau de vérification, filtre de contenu, double authentification. Présente ensuite les points à corriger, du plus grave au moins grave.",
    parameters: { type: 'object', properties: {} },
    access: 'operator',
    readonly: true,
    run: ({ guild }) => auditReport(guild),
  },
  {
    name: 'sauvegarder_structure',
    description: "Sauvegarde maintenant la structure du serveur (rôles, salons, catégories, permissions). Une sauvegarde est aussi faite automatiquement chaque jour, les 7 dernières sont gardées.",
    parameters: { type: 'object', properties: {} },
    access: 'operator',
    panel: true,
    run({ guild }) {
      backupGuild(guild);
      return `Structure sauvegardée : ${guild.roles.cache.size} rôles, ${guild.channels.cache.size} salons.`;
    },
  },
  {
    name: 'restaurer_structure',
    description:
      "Recrée les rôles et salons qui ont disparu depuis la dernière sauvegarde (après une suppression accidentelle ou une attaque), avec leurs permissions. Ne supprime ni ne modifie rien d'existant. Demande une confirmation.",
    parameters: { type: 'object', properties: {} },
    access: 'operator',
    confirm({ guild }) {
      const backup = latestBackup(guild.id);
      if (!backup) throw new Error('aucune sauvegarde pour ce serveur');
      const { roles, channels } = missingFrom(backup.data, guild);
      if (!roles.length && !channels.length) throw new Error('rien ne manque par rapport à la dernière sauvegarde');
      return `Recréer ${roles.length} rôle(s) et ${channels.length} salon(s)`;
    },
    async run({ guild, reason }) {
      const backup = latestBackup(guild.id);
      if (!backup) return 'Aucune sauvegarde pour ce serveur.';
      const { roles, channels } = await restore(guild, backup.data, reason);
      return `Restauration depuis la sauvegarde du <t:${Math.floor(backup.createdAt / 1000)}:f> : ${roles} rôle(s) et ${channels} salon(s) recréés. Les rôles recréés sont en bas de la liste, à replacer à la main si besoin.`;
    },
  },
];

