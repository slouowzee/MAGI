import { MessageFlags } from 'discord.js';
import { isOperator } from '../../core/installation.js';
import { getCase, revokeInfraction, revokeLastInfraction } from '../moderation/store.js';
import { cardPayload, history, updateCase } from '../moderation/cases.js';
import { bumpStat } from '../../core/log/digest.js';
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

const DAY = 86_400_000;

async function caseAction(interaction, action, id) {
  const { guild } = interaction;
  const c = getCase(Number(id));
  if (!c || c.guildId !== guild.id) return ephemeral(interaction, 'Cas introuvable.');
  const by = interaction.member.displayName;
  const reason = `MAGI, cas #${c.id}, par ${interaction.user.tag}`;
  const member = await guild.members.fetch(c.userId).catch(() => null);
  let change = {};
  let event;
  if (action === 'cas-annuler') {
    if (c.infractionId) revokeInfraction(c.infractionId);
    if (member?.communicationDisabledUntilTimestamp > Date.now()) await member.timeout(null, reason).catch(() => {});
    const unbanned = !member && (await guild.bans.fetch(c.userId).catch(() => null)) ? await guild.members.unban(c.userId, reason).then(() => true).catch(() => false) : false;
    change = { status: 'annulee', banned: false };
    event = `sanction annulée par ${by}${unbanned ? ', bannissement levé' : ''}`;
    bumpStat(guild.id, 'cas_annules');
  } else if (action === 'cas-exclure') {
    if (!member) return ephemeral(interaction, "Ce membre n'est plus sur le serveur.");
    const ok = await member.timeout(DAY, reason).then(() => true).catch((err) => ephemeral(interaction, `Impossible : ${err.message}`).then(() => false));
    if (!ok) return;
    change = { status: 'exclu' };
    event = `exclu 24 h par ${by}`;
  } else if (action === 'cas-bannir') {
    const ok = await guild.members.ban(c.userId, { reason, deleteMessageSeconds: 86_400 }).then(() => true).catch((err) => ephemeral(interaction, `Impossible : ${err.message}`).then(() => false));
    if (!ok) return;
    change = { banned: true };
    event = `banni par ${by}`;
  }
  const updated = updateCase(guild, c.id, change, { event });
  log.notice('moderation', `cas #${c.id} : ${event}`, { guild, quiet: true });
  return interaction.update(await cardPayload(guild, updated));
}

export async function handleSecurityButton(interaction) {
  const [scope, action, target] = interaction.customId.split(':');
  if (scope === 'magi-sec' && action === 'verifier') return verify(interaction);
  if (!isOperator(interaction.member)) return ephemeral(interaction, 'Réservé aux opérateurs MAGI.');
  if (scope === 'magi-mod' && action === 'annuler') return cancelSanction(interaction, target);
  if (scope === 'magi-mod' && action === 'historique') return ephemeral(interaction, history(interaction.guild.id, target));
  if (scope === 'magi-mod' && action.startsWith('cas-')) return caseAction(interaction, action, target);
  if (action === 'liberer') return release(interaction, target);
  if (action === 'deverrouiller') {
    const count = await unlock(interaction.guild, `par ${interaction.user.tag}`);
    return done(interaction, `Verrouillage levé (${count} salon(s))`);
  }
  return ephemeral(interaction, 'Action inconnue.');
}
