import { install, installReport, installStatus, statusReport } from '../server/installation.js';
import { refreshPanel } from '../server/panel.js';
import { inviteUrl } from '../server/permissions.js';

export const INSTALLATION_TOOLS = [
  {
    name: 'etat_installation',
    description:
      "Vérifie l'installation de MAGI sur ce serveur sans rien modifier : rôle Opérateur MAGI, salon #magi-logs, hiérarchie des rôles. À utiliser pour toute question sur l'installation de MAGI. Ensuite, présente les étapes manquantes.",
    parameters: { type: 'object', properties: {} },
    access: 'owner',
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
      "Affiche à nouveau le panneau de configuration de MAGI dans le salon #magi-config (permissions, modules, personas, salons, sécurité). À utiliser quand on demande les réglages ou la configuration de MAGI.",
    parameters: { type: 'object', properties: {} },
    access: 'owner',
    async run({ guild }) {
      const channel = await refreshPanel(guild, { repost: true });
      return channel ? `Panneau de configuration affiché dans ${channel}.` : "Le panneau n'est pas disponible : MAGI doit d'abord être installé avec le niveau de permissions Gestion.";
    },
  },
];

