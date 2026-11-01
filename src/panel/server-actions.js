import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { preview } from '../features/server/plan.js';
import { rollback } from '../features/server/apply.js';
import { auditStructure } from '../features/server/audit.js';
import { discordTemplate, saveTemplate } from '../features/server/templates.js';
import { dropPlan, pendingPlan, progressBar, proposePlan, runPlan, serverFeatures, serverStyle } from '../features/server/tools.js';
import { id } from './ui.js';
import { COLOR } from '../core/discord/embeds.js';

const PRIVATE = { flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
const buttons = (...list) => [new ActionRowBuilder().addComponents(list.map(([field, label, style]) => new ButtonBuilder().setCustomId(id(field)).setLabel(label).setStyle(style)))];

function planMessage(entry) {
  if (!entry.ops.length) return { content: 'Le plan ne change rien au serveur.', embeds: [], components: [] };
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`Plan : ${entry.ops.length} changement(s)`)
    .setDescription(preview(entry.ops, 3900))
    .setFooter({ text: "Rien n'est appliqué tant que tu ne cliques pas sur Appliquer. Une sauvegarde est faite avant." });
  return {
    content: '',
    embeds: [embed],
    components: buttons(['server_apply', 'Appliquer', ButtonStyle.Success], ['server_retouch', 'Retoucher', ButtonStyle.Secondary], ['server_discard', 'Abandonner', ButtonStyle.Secondary]),
  };
}

function modal(field, title, label, placeholder) {
  const input = new TextInputBuilder().setCustomId('texte').setLabel(label).setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true).setPlaceholder(placeholder);
  return new ModalBuilder().setCustomId(id(field)).setTitle(title).addComponents(new ActionRowBuilder().addComponents(input));
}

async function withProgress(interaction, label, work) {
  let last = 0;
  const progress = (done, total) => {
    if (done < total && Date.now() - last < 2_000) return;
    last = Date.now();
    interaction.editReply({ content: `${label} : ${progressBar(done, total)}`, embeds: [], components: [] }).catch(() => {});
  };
  const result = await work(progress).catch((err) => `Échec : ${err.message}`);
  await interaction.editReply({ content: result.slice(0, 2000), embeds: [], components: [] });
  return result;
}

const reason = (interaction) => `MAGI, demandé par ${interaction.user.tag}`;

export const SERVER_ACTIONS = {
  async server_preview(interaction) {
    await interaction.deferReply(PRIVATE);
    const { guild } = interaction;
    const entry = await proposePlan(guild, { consigne: '', style: serverStyle(guild), features: serverFeatures(guild) }).catch((err) => err);
    if (entry instanceof Error) return interaction.editReply({ content: `Impossible de préparer le plan : ${entry.message}` });
    return interaction.editReply(planMessage(entry));
  },
  server_retouch: (interaction) => interaction.showModal(modal('server_retouch_set', 'Retoucher le plan', 'Ce qu’il faut changer', 'Retire la catégorie jeux, ajoute un salon musique…')),
  async server_retouch_set(interaction) {
    await interaction.deferUpdate();
    const entry = await proposePlan(interaction.guild, { consigne: interaction.fields.getTextInputValue('texte'), retouche: true }).catch((err) => err);
    if (entry instanceof Error) return interaction.editReply({ content: `Impossible : ${entry.message}`, embeds: [], components: [] });
    return interaction.editReply(planMessage(entry));
  },
  async server_apply(interaction) {
    const entry = pendingPlan(interaction.guild);
    if (!entry) return interaction.update({ content: 'Ce plan a expiré, prévisualise à nouveau.', embeds: [], components: [] });
    await interaction.update({ content: 'Mise en place : en cours…', embeds: [], components: [] });
    return withProgress(interaction, 'Mise en place', (progress) => runPlan(interaction.guild, entry, reason(interaction), progress));
  },
  server_discard(interaction) {
    dropPlan(interaction.guild);
    return interaction.update({ content: 'Plan abandonné.', embeds: [], components: [] });
  },
  server_rollback: (interaction) =>
    interaction.reply({ content: 'Annuler la dernière mise en place ? Ce qui a été créé sera supprimé, les anciens noms, emplacements et réglages remis.', components: buttons(['server_rollback_ok', 'Confirmer l’annulation', ButtonStyle.Danger]), ...PRIVATE }),
  async server_rollback_ok(interaction) {
    await interaction.update({ content: 'Annulation : en cours…', components: [] });
    return withProgress(interaction, 'Annulation', (progress) => rollback(interaction.guild, reason(interaction), progress));
  },
  server_audit(interaction) {
    const findings = auditStructure(interaction.guild);
    const body = findings.length ? `**${findings.length} point(s) à corriger**\n${findings.map((f) => `- ${f}`).join('\n')}\n-# Pour corriger : « magi, corrige ces points » ou Retoucher après une prévisualisation.` : 'Rien à signaler, la structure est cohérente.';
    return interaction.reply({ content: body.slice(0, 2000), ...PRIVATE });
  },
  server_template: (interaction) => interaction.showModal(modal('server_template_set', 'Enregistrer comme modèle', 'Nom du modèle', 'Mon serveur gaming')),
  server_template_set(interaction) {
    const name = saveTemplate(interaction.guild, interaction.fields.getTextInputValue('texte'));
    return interaction.reply({ content: `Modèle « ${name} » enregistré. Demande « magi, applique le modèle ${name} » sur n'importe lequel de tes serveurs où je suis.`, ...PRIVATE });
  },
  async server_link(interaction) {
    await interaction.deferReply(PRIVATE);
    const link = await discordTemplate(interaction.guild, reason(interaction)).catch((err) => err);
    return interaction.editReply({ content: link instanceof Error ? `Impossible : ${link.message} (il faut la permission Gérer le serveur).` : `Lien de modèle Discord : ${link}` });
  },
};
