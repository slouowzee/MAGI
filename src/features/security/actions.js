import { MessageFlags } from 'discord.js';
import { isOperator } from '../../core/installation.js';
import { revokeLastInfraction } from '../moderation/store.js';
import { setSetting, setting } from '../../core/settings.js';
import { welcome } from '../welcome/welcome.js';
import { verifyMember } from './gate.js';
import { unlock } from './raid.js';
import { log } from '../../core/log/log.js';

const ephemeral = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

export const isSecurityButton = (id) => id.startsWith('magi-mod:') || id.startsWith('magi-sec:');

async function done(interaction, text) {
  await interaction.update({ content: `${interaction.message.content}\n-# ${text} par ${interaction.member.displayName}`.slice(0, 2000), components: [] });
}

async function cancelSanction(interaction, userId) {
  const { guild } = interaction;
  const member = await guild.members.fetch(userId).catch(() => null);
  const revoked = revokeLastInfraction(guild.id, userId);
  if (member?.communicationDisabledUntilTimestamp > Date.now()) await member.timeout(null, `MAGI, annulé par ${interaction.user.tag}`);
  const unbanned = !member && (await guild.bans.fetch(userId).catch(() => null)) ? await guild.members.unban(userId, `MAGI, annulé par ${interaction.user.tag}`).then(() => true).catch(() => false) : false;
  log.notice('moderation', `sanction de <@${userId}> annulée${unbanned ? ', bannissement levé' : ''}${revoked ? '' : ' (aucune infraction en cours)'} par ${interaction.user.tag}`, { guild });
  await done(interaction, 'Sanction annulée');
}

async function release(interaction, userId) {
  const { guild } = interaction;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return ephemeral(interaction, "Ce membre n'est plus sur le serveur.");
  const roles = JSON.parse(setting(guild.id, `quarantine:${userId}`) ?? '[]').filter((id) => guild.roles.cache.get(id)?.editable);
  if (roles.length) await member.roles.add(roles, `MAGI, quarantaine levée par ${interaction.user.tag}`);
  if (member.communicationDisabledUntilTimestamp > Date.now()) await member.timeout(null, `MAGI, quarantaine levée par ${interaction.user.tag}`);
  setSetting(guild.id, `quarantine:${userId}`, null);
  log.notice('antinuke', `quarantaine de ${member.user.tag} levée par ${interaction.user.tag}, ${roles.length} rôle(s) rendu(s)`, { guild });
  await done(interaction, 'Quarantaine levée');
}

async function verify(interaction) {
  const ok = await verifyMember(interaction.member);
  await ephemeral(interaction, ok ? 'Bienvenue, tu as maintenant accès au serveur.' : 'Tu as déjà accès au serveur.');
  if (ok) await welcome(interaction.member).catch(() => {});
}

export async function handleSecurityButton(interaction) {
  const [scope, action, target] = interaction.customId.split(':');
  if (scope === 'magi-sec' && action === 'verifier') return verify(interaction);
  if (!isOperator(interaction.member)) return ephemeral(interaction, 'Réservé aux opérateurs MAGI.');
  if (scope === 'magi-mod' && action === 'annuler') return cancelSanction(interaction, target);
  if (action === 'liberer') return release(interaction, target);
  if (action === 'deverrouiller') {
    const count = await unlock(interaction.guild, `par ${interaction.user.tag}`);
    return done(interaction, `Verrouillage levé (${count} salon(s))`);
  }
  return ephemeral(interaction, 'Action inconnue.');
}
