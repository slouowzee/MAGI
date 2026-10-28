import { install, installReport, installStatus, statusReport } from '../../core/installation.js';
import { refreshPanel } from '../../panel/index.js';
import { inviteUrl } from '../../core/permissions.js';
import { setting } from '../../core/settings.js';

export const INSTALLATION_TOOLS = [
  {
    name: 'etat_installation',
    description:
      "Vérifie l'installation de MAGI sur ce serveur sans rien modifier : rôle Opérateur MAGI, salon #magi-logs, hiérarchie des rôles. À utiliser pour toute question sur l'installation de MAGI. Ensuite, présente les étapes manquantes.",
    parameters: { type: 'object', properties: {} },
    access: 'owner',
    readonly: true,
    async run({ guild, offer }) {
      const steps = await installStatus(guild);
      const report = statusReport(steps);
      if (steps.some((s) => s.permissions && !s.done)) {
        offer({ label: 'Accorder les permissions', url: inviteUrl(guild.client.user.id, guild.id, 'gestion') });
        return report;
      }
      if (!steps.some((s) => !s.done && !s.manual)) return report;
      offer({
        label: "Compléter l'installation",
        allowed: (m) => m.id === guild.ownerId,
        refusal: 'Seul le propriétaire du serveur peut installer MAGI.',
        run: async () => installReport(await install(guild), guild),
      });
      return `${report}\nUn bouton « Compléter l'installation » sera affiché sous ta réponse : invite la personne à cliquer dessus si elle veut que tu le fasses.`;
    },
  },
  {
    name: 'installer_magi',
    description:
      "Effectue l'installation de MAGI sur ce serveur (rôle Opérateur MAGI, salon #magi-logs, attribution du rôle au propriétaire). Uniquement quand la personne demande explicitement d'installer ou de réparer MAGI, ou accepte après avoir vu les étapes manquantes. Pas pour configurer le serveur lui-même.",
    parameters: { type: 'object', properties: {} },
    access: 'owner',
    async run({ guild }) {
      return installReport(await install(guild), guild);
    },
  },
  {
    name: 'panneau_config',
    description:
      "Donne le lien du panneau de configuration de #magi-config, ou le republie s'il a été supprimé. Seulement quand on demande où est le panneau ou de le réafficher : il ne modifie rien et ne crée aucun salon (pour ça, preparer_salons). Les opérateurs règlent tout eux-mêmes dans ce panneau, ou avec /magi config.",
    parameters: { type: 'object', properties: {} },
    access: 'owner',
    async run({ guild }) {
      const channel = await refreshPanel(guild);
      return channel ? `Panneau à jour : https://discord.com/channels/${guild.id}/${channel.id}/${setting(guild.id, 'config_message')}` : "Le panneau n'est pas disponible : MAGI doit d'abord être installé avec le niveau de permissions Gestion.";
    },
  },
];

