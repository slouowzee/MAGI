import { PermissionFlagsBits } from 'discord.js';

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
