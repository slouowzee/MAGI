import { MessageFlags } from 'discord.js';
import { isOperator } from '../../core/installation.js';
import { getCase, revokeInfraction, revokeLastInfraction } from '../moderation/store.js';
import { cardPayload, history, updateCase } from '../moderation/cases.js';
import { bumpStat } from '../../core/log/digest.js';
import { answerAppeal, notifySanction } from '../moderation/appeal.js';
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
  log.notice('moderation', `${interaction.member} a annulé la sanction de <@${userId}>${unbanned ? ' et levé son bannissement' : ''}`, { guild });
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
  log.notice('antinuke', `${interaction.member} a levé la quarantaine de ${member} · ${roles.length} rôle${roles.length > 1 ? 's' : ''} rendu${roles.length > 1 ? 's' : ''}`, { guild });
  await done(interaction, 'Quarantaine levée');
}

async function verify(interaction) {
  const ok = await verifyMember(interaction.member);
  await ephemeral(interaction, ok ? 'Bienvenue, tu as maintenant accès au serveur.' : 'Tu as déjà accès au serveur.');
  if (ok) await welcome(interaction.member).catch(() => {});
}

const DAY = 86_400_000;

async function liftTimeout(member, reason) {
  if (!(member?.communicationDisabledUntilTimestamp > Date.now())) return false;
  await member.timeout(null, reason);
  return true;
}

async function liftBan(guild, userId, reason) {
  if (!(await guild.bans.fetch(userId).catch(() => null))) return false;
  await guild.members.unban(userId, reason);
  return true;
}

async function caseAction(interaction, action, id) {
  const { guild } = interaction;
  const c = getCase(Number(id));
  if (!c || c.guildId !== guild.id) return ephemeral(interaction, 'Cas introuvable.');
  const by = interaction.member.displayName;
  const reason = `MAGI, cas #${c.id}, par ${interaction.user.tag}`;
  const member = await guild.members.fetch(c.userId).catch(() => null);
  let change;
  let event;
  try {
    if (action === 'cas-lever') {
      const lifted = await liftTimeout(member, reason);
      change = { excluded: false, excludedUntil: null };
      event = lifted ? `exclusion levée par ${by}` : `exclusion déjà terminée (${by})`;
    } else if (action === 'cas-debannir') {
      const lifted = await liftBan(guild, c.userId, reason);
      change = { banned: false };
      event = lifted ? `débanni par ${by}` : `n'était plus banni (${by})`;
    } else if (action === 'cas-infraction') {
      if (c.infractionId) revokeInfraction(c.infractionId);
      change = { infractionRevoked: true };
      event = `infraction retirée par ${by}`;
    } else if (action === 'cas-annuler' || action === 'appel-ok') {
      const done = [(await liftTimeout(member, reason)) && 'exclusion levée', (await liftBan(guild, c.userId, reason)) && 'débanni', c.infractionId && !c.infractionRevoked && revokeInfraction(c.infractionId) && 'infraction retirée'].filter(Boolean);
      change = { status: 'annulee', excluded: false, excludedUntil: null, banned: false, infractionRevoked: true, ...(action === 'appel-ok' && { appeal: { ...c.appeal, state: 'acceptée' } }) };
      event = `${action === 'appel-ok' ? 'contestation acceptée' : 'tout annulé'} par ${by}${done.length ? ` : ${done.join(', ')}` : ''}`;
      bumpStat(guild.id, 'cas_annules');
    } else if (action === 'appel-non') {
      change = { appeal: { ...c.appeal, state: 'refusée' } };
      event = `contestation refusée par ${by}`;
    } else if (action === 'cas-exclure') {
      if (!member) return ephemeral(interaction, "Ce membre n'est plus sur le serveur.");
      await member.timeout(DAY, reason);
      notifySanction(guild, c.userId, { sanction: 'Exclusion 24 h', reason: c.reasons.join(', '), caseId: c.id, until: Date.now() + DAY });
      change = { excluded: true, excludedUntil: Date.now() + DAY, status: 'active' };
      event = `exclu 24 h par ${by}`;
    } else if (action === 'cas-bannir') {
      await notifySanction(guild, c.userId, { sanction: 'Ban', reason: c.reasons.join(', '), caseId: c.id });
      await guild.members.ban(c.userId, { reason, deleteMessageSeconds: 86_400 });
      change = { banned: true, status: 'active' };
      event = `banni par ${by}`;
    } else return ephemeral(interaction, 'Action inconnue.');
  } catch (err) {
    return ephemeral(interaction, `Impossible : ${err.message}`);
  }
  const updated = updateCase(guild, c.id, change, { event });
  log.notice('moderation', `cas #${c.id} : ${event}`, { guild, quiet: true });
  if (action.startsWith('appel-')) answerAppeal(guild, c, action === 'appel-ok');
  return interaction.update(await cardPayload(guild, updated));
}

export async function handleSecurityButton(interaction) {
  const [scope, action, target] = interaction.customId.split(':');
  if (scope === 'magi-sec' && action === 'verifier') return verify(interaction);
  if (!isOperator(interaction.member)) return ephemeral(interaction, 'Réservé aux opérateurs MAGI.');
  if (scope === 'magi-mod' && action === 'annuler') return cancelSanction(interaction, target);
  if (scope === 'magi-mod' && action === 'historique') return ephemeral(interaction, history(interaction.guild.id, target));
  if (scope === 'magi-mod' && (action.startsWith('cas-') || action.startsWith('appel-'))) return caseAction(interaction, action, target);
  if (action === 'liberer') return release(interaction, target);
  if (action === 'deverrouiller') {
    const count = await unlock(interaction.guild, `par ${interaction.user.tag}`);
    return done(interaction, `Verrouillage levé (${count} salon(s))`);
  }
  return ephemeral(interaction, 'Action inconnue.');
}
