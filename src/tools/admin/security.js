import { ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { setSetting, setting } from '../../storage/settings.js';

const WARNING =
  "Ce salon est un piège à bots. **N'écris rien ici.**\nLes comptes de spam écrivent dans tous les salons à la fois : tout message envoyé ici entraîne un bannissement automatique et la suppression des messages des dernières 24 heures.";

const honeypotOf = (guild) => guild.channels.cache.get(setting(guild.id, 'honeypot')) ?? null;

export const SECURITY_TOOLS = [
  {
    name: 'salon_piege',
    description:
      "Active ou désactive le salon piège à bots : un salon visible de tous, en haut de la liste, où personne ne doit écrire. Les comptes de spam écrivent partout et tombent dedans : bannissement et suppression de leurs messages des dernières 24 h. Opérateurs et modérateurs exemptés. Demande une confirmation.",
    parameters: { type: 'object', properties: { actif: { type: 'boolean' } }, required: ['actif'] },
    access: 'operator',
    confirm({ guild, args }) {
      const current = honeypotOf(guild);
      if (args.actif && current) throw new Error(`le salon piège existe déjà : #${current.name}`);
      if (!args.actif && !current) throw new Error("il n'y a pas de salon piège");
      return args.actif ? 'Créer le salon piège' : `Supprimer #${current.name}`;
    },
    async run({ guild, args, reason }) {
      const current = honeypotOf(guild);
      if (!args.actif) {
        setSetting(guild.id, 'honeypot', null);
        await current?.delete(reason).catch(() => {});
        return 'Salon piège supprimé.';
      }
      if (current) return `Le salon piège existe déjà : ${current}.`;
      const channel = await guild.channels.create({
        name: 'ne-pas-écrire-ici',
        type: ChannelType.GuildText,
        topic: "Piège à bots : tout message envoyé ici entraîne un bannissement automatique.",
        reason,
        permissionOverwrites: [{ id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }],
      });
      await channel.setPosition(0).catch(() => {});
      await channel.send({ embeds: [new EmbedBuilder().setColor(0xd65c62).setTitle('Ne pas écrire ici').setDescription(WARNING)] });
      setSetting(guild.id, 'honeypot', channel.id);
      return `Salon piège créé : ${channel}. Tout message d'un membre sans rôle de modération y entraîne un bannissement.`;
    },
  },
  {
    name: 'audit_permissions',
    description:
      "Analyse la sécurité du serveur sans rien modifier : permissions dangereuses de @everyone, des rôles et des salons, niveau de vérification, filtre de contenu, double authentification. Présente ensuite les points à corriger, du plus grave au moins grave.",
    parameters: { type: 'object', properties: {} },
    access: 'operator',
    run: ({ guild }) => auditReport(guild),
  },
];

const RISKY = {
  Administrator: 'administrateur',
  ManageGuild: 'gérer le serveur',
  ManageRoles: 'gérer les rôles',
  ManageChannels: 'gérer les salons',
  ManageWebhooks: 'gérer les webhooks',
  BanMembers: 'bannir',
  KickMembers: 'expulser',
  ManageMessages: 'gérer les messages',
  MentionEveryone: 'mentionner @everyone',
};

function risky(permissions) {
  return Object.entries(RISKY)
    .filter(([flag]) => permissions.has(PermissionFlagsBits[flag], false))
    .map(([, label]) => label);
}

export function auditReport(guild) {
  const findings = [];
  const everyone = risky(guild.roles.everyone.permissions);
  if (everyone.length) findings.push(`@everyone a des permissions dangereuses : ${everyone.join(', ')}.`);

  for (const role of guild.roles.cache.values()) {
    if (role.id === guild.id) continue;
    const perms = risky(role.permissions);
    if (!perms.length) continue;
    const who = role.managed ? `rôle d'intégration (bot) ${role.name}` : `rôle ${role.name} (${role.members.size} membre(s) connus)`;
    findings.push(`${who} : ${perms.join(', ')}.`);
  }

  for (const channel of guild.channels.cache.values()) {
    const overwrite = channel.permissionOverwrites?.cache.get(guild.id);
    const perms = overwrite ? risky(overwrite.allow) : [];
    if (perms.length) findings.push(`#${channel.name} donne à @everyone : ${perms.join(', ')}.`);
  }

  if (guild.verificationLevel < 2) findings.push('Niveau de vérification faible : passer au moins à « moyen » (compte inscrit depuis 5 minutes).');
  if (guild.explicitContentFilter === 0) findings.push('Filtre de contenu explicite désactivé : l’activer pour tous les membres.');
  if (guild.mfaLevel === 0) findings.push('Double authentification non exigée pour les actions de modération.');
  if (guild.defaultMessageNotifications === 0) findings.push('Notifications par défaut sur « tous les messages » : préférer « mentions uniquement ».');
  if (guild.members.me.permissions.has(PermissionFlagsBits.Administrator)) findings.push('MAGI a la permission administrateur : il n’en a pas besoin, un niveau plus restreint limite les dégâts si son jeton fuitait.');

  return findings.length ? `Audit des permissions, ${findings.length} point(s) :\n${findings.map((f) => `- ${f}`).join('\n')}` : 'Audit des permissions : rien de préoccupant.';
}
