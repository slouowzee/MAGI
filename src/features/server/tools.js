import { isOperator } from '../../core/installation.js';
import { setting } from '../../core/settings.js';
import { MODES, naming, PRESETS, SEASONS } from './styles.js';
import { diffPlan, FEATURES, makePlan, preview } from './plan.js';
import { applyPlan, lastSetup, rollback } from './apply.js';
import { auditStructure } from './audit.js';
import { discordTemplate, findTemplate, listTemplates, saveTemplate } from './templates.js';

const TTL = 30 * 60_000;
const pending = new Map();
const silent = { allowedMentions: { parse: [] } };

export function serverStyle(guild, overrides = {}) {
  return { ...naming((key) => setting(guild.id, key)), ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v)) };
}

export function serverFeatures(guild) {
  const raw = setting(guild.id, 'server_features');
  return raw === null ? Object.keys(FEATURES) : raw.split(',').filter((f) => FEATURES[f]);
}

export function pendingPlan(guild) {
  const entry = pending.get(guild.id);
  return entry && Date.now() - entry.at < TTL ? entry : null;
}

export const dropPlan = (guild) => pending.delete(guild.id);

function remember(guild, entry) {
  pending.set(guild.id, { ...entry, at: Date.now() });
  return pending.get(guild.id);
}

export async function proposePlan(guild, { consigne, style, features, retouche = false, season = null }) {
  const base = retouche ? pendingPlan(guild) : null;
  if (retouche && !base) throw new Error("aucun plan récent à retoucher, demande d'abord un plan");
  const st = base?.style ?? style;
  const ft = base?.features ?? features;
  const plan = await makePlan(guild, { consigne, style: st, features: ft, previous: base?.plan ?? null, season: base?.season ?? season });
  const ops = diffPlan(guild, plan, st, ft).filter((op) => !(base?.season ?? season) || op.kind === 'renommer');
  return remember(guild, { plan, style: st, features: ft, ops, season: base?.season ?? season });
}

export function templatePlan(guild, name, mode = 'completer') {
  const template = findTemplate(guild, name);
  const style = { ...serverStyle(guild), casing: 'libre', decor: 'libre', mode };
  const features = serverFeatures(guild);
  return remember(guild, { plan: template.plan, style, features, ops: diffPlan(guild, template.plan, style, features), season: null, template: template.name });
}

export async function runPlan(guild, entry, reason, progress) {
  if (pending.get(guild.id) === entry) pending.delete(guild.id);
  return applyPlan(guild, entry.ops, { reason, progress, features: entry.features, journalKey: entry.season ? 'season_journal' : 'server_journal' });
}

export function progressBar(done, total) {
  const width = 12;
  const filled = Math.round((done / Math.max(total, 1)) * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${done}/${total}`;
}

async function withProgress(channel, label, work) {
  const message = await channel.send({ content: `${label} : en cours…`, ...silent }).catch(() => null);
  let last = 0;
  const progress = (done, total) => {
    if (!message || (done < total && Date.now() - last < 2_500)) return;
    last = Date.now();
    message.edit(`${label} : ${progressBar(done, total)}`).catch(() => {});
  };
  try {
    return await work(progress);
  } finally {
    await message?.delete().catch(() => {});
  }
}

function offerPlan({ guild, member, message, reason, offer }, entry, what) {
  offer({
    label: `${what} (${entry.ops.length} changements)`.slice(0, 80),
    allowed: (m) => m.id === member.id && isOperator(m),
    refusal: `Seul ${member.displayName} peut appliquer ce plan.`,
    run: () => withProgress(message.channel, what, (progress) => runPlan(guild, entry, reason, progress)),
  });
  return `Plan proposé, PAS encore appliqué (${entry.ops.length} changements) :\n${preview(entry.ops, 3000)}\nRecopie ce plan tel quel dans ta réponse, puis dis qu'un bouton permet de l'appliquer et qu'on peut le retoucher en te le demandant.`;
}

const keep = (list, allowed) => (list ?? []).filter((x) => allowed[x]);

export const SERVER_TOOLS = [
  {
    name: 'organiser_serveur',
    description:
      "Met en place, organise ou embellit tout le serveur en une fois, dans un style : catégories, salons, rôles et hiérarchie, permissions (annonces en lecture seule, coulisses staff), fonctions de MAGI branchées (Hall of Fame, tickets, bienvenue…), règlement et messages de départ, réglages du serveur, sécurité. Pour toute demande globale (« setup le serveur en style gaming », « organise le discord », « rends-le beau ») plutôt que d'enchaîner creer_salon. Avec retouche, modifie le dernier plan proposé (« retire la catégorie jeux »). Prépare un plan ; un bouton permet ensuite de l'appliquer.",
    parameters: {
      type: 'object',
      properties: {
        consigne: { type: 'string', description: 'La demande complète, avec tous ses détails.' },
        style: { type: 'string', enum: Object.keys(PRESETS), description: 'Seulement si la personne cite un style.' },
        mode: { type: 'string', enum: Object.keys(MODES), description: 'restyler par défaut ; completer pour seulement ajouter ; creer pour repartir de zéro.' },
        fonctions: { type: 'array', items: { type: 'string', enum: Object.keys(FEATURES) }, description: 'Seulement si la personne limite ce qu’il faut mettre en place.' },
        retouche: { type: 'boolean', description: 'true pour modifier le dernier plan proposé.' },
      },
      required: ['consigne'],
    },
    access: 'operator',
    async run(ctx) {
      const { guild, args } = ctx;
      const features = keep(args.fonctions, FEATURES);
      const entry = await proposePlan(guild, { consigne: args.consigne, style: serverStyle(guild, { preset: PRESETS[args.style] ? args.style : null, mode: MODES[args.mode] ? args.mode : null }), features: features.length ? features : serverFeatures(guild), retouche: Boolean(args.retouche) });
      if (!entry.ops.length) return 'Le plan ne change rien au serveur.';
      return offerPlan(ctx, entry, 'Appliquer le plan');
    },
  },
  {
    name: 'theme_saisonnier',
    description: "Habille temporairement le serveur pour une saison (Halloween, Noël, printemps, été) en renommant catégories et salons, ou retire le thème et remet les noms d'origine. Plan et bouton de confirmation.",
    parameters: { type: 'object', properties: { saison: { type: 'string', enum: [...Object.keys(SEASONS), 'retirer'] } }, required: ['saison'] },
    access: 'operator',
    async run(ctx) {
      const { guild, member, message, args, reason, offer } = ctx;
      if (args.saison === 'retirer') {
        if (!lastSetup(guild, 'season_journal')) return 'Aucun thème saisonnier en place.';
        offer({ label: 'Retirer le thème', allowed: (m) => m.id === member.id && isOperator(m), refusal: `Seul ${member.displayName} peut confirmer.`, run: () => withProgress(message.channel, 'Retrait du thème', (p) => rollback(guild, reason, p, 'season_journal')) });
        return "Un bouton permet de retirer le thème et de remettre les noms d'origine.";
      }
      if (!SEASONS[args.saison]) return 'Saison inconnue.';
      if (lastSetup(guild, 'season_journal')) return 'Un thème est déjà en place : retire-le avant d’en mettre un autre.';
      const entry = await proposePlan(guild, { consigne: `Thème ${SEASONS[args.saison]}`, style: { ...serverStyle(guild), mode: 'restyler', casing: 'libre', decor: 'libre' }, features: [], season: args.saison });
      if (!entry.ops.length) return 'Le thème ne change aucun nom.';
      return offerPlan(ctx, entry, `Appliquer le thème ${SEASONS[args.saison]}`);
    },
  },
  {
    name: 'annuler_mise_en_place',
    description: "Défait la dernière mise en place du serveur faite par MAGI (organiser_serveur ou modèle) : supprime ce qui a été créé, remet les anciens noms, emplacements, permissions et réglages. Bouton de confirmation.",
    parameters: { type: 'object', properties: {} },
    access: 'operator',
    confirm({ guild }) {
      const last = lastSetup(guild);
      if (!last?.journal.length) throw new Error('aucune mise en place à annuler');
      return `Annuler la mise en place du ${new Date(last.at).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}`;
    },
    async run({ guild, message, reason }) {
      return withProgress(message.channel, 'Annulation de la mise en place', (p) => rollback(guild, reason, p));
    },
  },
  {
    name: 'audit_structure',
    description: "Vérifie la cohérence du serveur : noms et séparateurs mélangés, doublons, catégories vides, salons hors catégorie, salons privés visibles par tous, annonces où tout le monde peut écrire. Ne modifie rien.",
    parameters: { type: 'object', properties: {} },
    access: 'operator',
    readonly: true,
    async run({ guild }) {
      const findings = auditStructure(guild);
      return findings.length ? `${findings.length} point(s) à corriger :\n${findings.map((f) => `- ${f}`).join('\n')}\nPour corriger, propose d'appeler organiser_serveur avec ces points dans la consigne.` : 'Rien à signaler, la structure est cohérente.';
    },
  },
  {
    name: 'modele_serveur',
    description: "Modèles de serveur : enregistrer la structure actuelle sous un nom, la réappliquer (ici ou sur un autre serveur du même propriétaire où MAGI est), lister les modèles, ou obtenir un lien de modèle Discord (discord.new).",
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['enregistrer', 'appliquer', 'lister', 'lien_discord'] },
        nom: { type: 'string' },
        mode: { type: 'string', enum: Object.keys(MODES), description: 'Pour appliquer : completer par défaut.' },
      },
      required: ['action'],
    },
    access: 'operator',
    async run(ctx) {
      const { guild, args, reason } = ctx;
      if (args.action === 'lister') return listTemplates(guild).map((t) => `- ${t.name} (depuis ${t.from})`).join('\n') || 'Aucun modèle enregistré.';
      if (args.action === 'enregistrer') return `Modèle « ${saveTemplate(guild, String(args.nom ?? guild.name))} » enregistré.`;
      if (args.action === 'lien_discord') return `Lien de modèle Discord : ${await discordTemplate(guild, reason)}`;
      const entry = templatePlan(guild, String(args.nom ?? ''), MODES[args.mode] ? args.mode : 'completer');
      if (!entry.ops.length) return 'Ce modèle ne change rien au serveur.';
      return offerPlan(ctx, entry, `Appliquer le modèle ${entry.template}`);
    },
  },
];
