import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { framed, SIGNATURE } from '../../core/discord/embeds.js';
import { deletePublication, findPublication, recentPublications, renamePublication, savePublication } from './publications-store.js';
import { setSetting, setting } from '../../core/settings.js';
import { targetChannel } from './resolve.js';
import { discordTime } from '../../core/util.js';

const KINDS = { __proto__: null, annonce: 'Annonce', reglement: 'Règlement', information: 'Information', evenement: 'Événement', faq: 'FAQ' };
const STYLE_VERSION = '2';
const textArgs = {
  type: { type: 'string', enum: Object.keys(KINDS), description: "Nature du message, affichée en en-tête avec le nom du serveur. Déduis-la de la demande." },
  titre: { type: 'string', description: 'Titre affiché en haut (256 caractères au plus). Vide si le texte contient déjà son titre en #.' },
  entete: { type: 'boolean', description: "En-tête « Nature · Serveur » au-dessus, true par défaut ; false si la personne n'en veut pas." },
  texte: {
    type: 'string',
    description:
      "Contenu en Markdown Discord (4000 caractères au plus) : phrases courtes, sections en ## sous-titres pour un texte long, listes à puces, **gras** pour l'essentiel. Pas de formule d'introduction ni de signature, l'en-tête et le pied sont ajoutés automatiquement.",
  },
};
const publicationArg = { publication: { type: 'string', description: 'Titre, lien ou identifiant du message. Vide pour la dernière publication.' } };

function guessKind(title = '') {
  if (/r[èe]gle/i.test(title)) return 'reglement';
  if (/faq|questions/i.test(title)) return 'faq';
  if (/[ée]v[ée]nement|soir[ée]e|tournoi|event/i.test(title)) return 'evenement';
  if (/annonce|nouveaut|mise à jour/i.test(title)) return 'annonce';
  return 'information';
}

function kindOf(message) {
  const label = message.embeds[0]?.author?.name?.split(' · ')[0];
  return Object.keys(KINDS).find((k) => KINDS[k] === label) ?? guessKind(message.embeds[0]?.title ?? '');
}

export function publicationEmbed(guild, { titre, texte, type, entete = true }, fallback = 'information') {
  if (!texte?.trim()) throw new Error('le texte est vide');
  const embed = framed(guild, { label: KINDS[type] ?? KINDS[fallback], title: titre?.trim(), text: texte.trim() });
  return entete ? embed : embed.setAuthor(null);
}

export async function restylePublications(guild) {
  if (setting(guild.id, 'publication_style') === STYLE_VERSION) return 0;
  let restyled = 0;
  for (const publication of recentPublications(guild.id)) {
    const message = await guild.channels.cache.get(publication.channel_id)?.messages.fetch(publication.message_id).catch(() => null);
    const old = message?.embeds[0];
    if (!old?.description || old.footer?.text === SIGNATURE) continue;
    await message.edit({ embeds: [publicationEmbed(guild, { titre: old.title, texte: old.description }, guessKind(old.title ?? ''))] });
    restyled++;
  }
  setSetting(guild.id, 'publication_style', STYLE_VERSION);
  return restyled;
}

function publishable(guild, ref) {
  const channel = targetChannel(guild, ref);
  if (!channel.isTextBased()) throw new Error(`${channel.name} n'est pas un salon textuel`);
  const perms = channel.permissionsFor(guild.members.me);
  if (!perms.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) throw new Error(`MAGI ne peut pas écrire dans ${channel.name}`);
  return channel;
}

function existing(guild, ref) {
  const publication = findPublication(guild.id, ref);
  if (!publication) throw new Error(ref ? `publication introuvable : ${ref}` : 'aucune publication de MAGI sur ce serveur');
  return publication;
}

async function fetchPublication(guild, publication) {
  const channel = guild.channels.cache.get(publication.channel_id);
  const message = await channel?.messages.fetch(publication.message_id).catch(() => null);
  if (!message) {
    deletePublication(publication.id);
    throw new Error(`le message « ${publication.title} » n'existe plus`);
  }
  return message;
}

export const PUBLICATION_TOOLS = [
  {
    name: 'publier',
    description:
      "Publie au nom de MAGI un message mis en forme (règlement, annonce, FAQ, présentation…) dans un salon. Rédige toi-même le texte complet à partir de la demande. Un aperçu et un bouton de confirmation sont affichés avant publication.",
    parameters: {
      type: 'object',
      properties: {
        salon: { type: 'string', description: 'Mention, identifiant ou nom du salon de destination.' },
        ...textArgs,
        epingler: { type: 'boolean' },
        mentionner_tout_le_monde: { type: 'boolean', description: 'Ajoute @everyone, seulement si la personne le demande.' },
      },
      required: ['salon', 'texte'],
    },
    access: 'operator',
    preview: ({ guild, args }) => publicationEmbed(guild, args),
    confirm({ guild, args }) {
      publicationEmbed(guild, args);
      const channel = publishable(guild, args.salon);
      return `Publier dans #${channel.name}${args.mentionner_tout_le_monde ? ' avec @everyone' : ''}`;
    },
    async run({ guild, args }) {
      const channel = publishable(guild, args.salon);
      const everyone = Boolean(args.mentionner_tout_le_monde);
      const sent = await channel.send({
        content: everyone ? '@everyone' : undefined,
        embeds: [publicationEmbed(guild, args)],
        allowedMentions: { parse: everyone ? ['everyone'] : [] },
      });
      if (args.epingler) await sent.pin().catch(() => {});
      savePublication({ guildId: guild.id, channelId: channel.id, messageId: sent.id, title: args.titre?.trim() || args.texte.trim().slice(0, 60) });
      return `Publié dans ${channel}${args.epingler ? ' et épinglé' : ''} : ${sent.url}`;
    },
  },
  {
    name: 'modifier_publication',
    description: "Remplace le titre et le texte d'un message publié par MAGI. Rédige le nouveau texte complet. Aperçu et confirmation avant modification.",
    parameters: { type: 'object', properties: { ...publicationArg, ...textArgs }, required: ['texte'] },
    access: 'operator',
    preview: ({ guild, args }) => publicationEmbed(guild, args),
    confirm({ guild, args }) {
      publicationEmbed(guild, args);
      return `Modifier « ${existing(guild, args.publication).title.slice(0, 50)} »`;
    },
    async run({ guild, args }) {
      const publication = existing(guild, args.publication);
      const message = await fetchPublication(guild, publication);
      if (message.flags.has(MessageFlags.IsComponentsV2)) throw new Error('cette publication a été écrite avec /ecrire : modifie-la avec /ecrire et l’option modifier');
      await message.edit({ embeds: [publicationEmbed(guild, args, kindOf(message))] });
      if (args.titre?.trim()) renamePublication(publication.id, args.titre.trim());
      return `Publication modifiée : ${message.url}`;
    },
  },
  {
    name: 'supprimer_publication',
    description: 'Supprime un message publié par MAGI. Demande une confirmation.',
    parameters: { type: 'object', properties: publicationArg },
    access: 'operator',
    confirm({ guild, args }) {
      return `Supprimer « ${existing(guild, args.publication).title.slice(0, 50)} »`;
    },
    async run({ guild, args }) {
      const publication = existing(guild, args.publication);
      await (await fetchPublication(guild, publication)).delete();
      deletePublication(publication.id);
      return `Publication « ${publication.title} » supprimée.`;
    },
  },
  {
    name: 'lister_publications',
    description: 'Liste les derniers messages publiés par MAGI sur ce serveur.',
    parameters: { type: 'object', properties: {} },
    access: 'operator',
    readonly: true,
    async run({ guild }) {
      const list = recentPublications(guild.id);
      if (!list.length) return 'Aucune publication de MAGI sur ce serveur.';
      return list.map((p) => `- « ${p.title} » dans <#${p.channel_id}>, ${discordTime(p.created_at)} : https://discord.com/channels/${guild.id}/${p.channel_id}/${p.message_id}`).join('\n');
    },
  },
];
