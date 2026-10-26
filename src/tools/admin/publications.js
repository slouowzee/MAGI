import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { deletePublication, findPublication, recentPublications, renamePublication, savePublication } from '../../storage/publications.js';
import { targetChannel } from './resolve.js';

const COLOR = 0xd65c62;
const textArgs = {
  titre: { type: 'string', description: 'Titre affiché en haut (256 caractères au plus).' },
  texte: { type: 'string', description: 'Contenu en Markdown Discord : **gras**, listes, ## sous-titres (4000 caractères au plus).' },
};
const publicationArg = { publication: { type: 'string', description: 'Titre, lien ou identifiant du message. Vide pour la dernière publication.' } };

function embed({ titre, texte }) {
  if (!texte?.trim()) throw new Error('le texte est vide');
  const built = new EmbedBuilder().setColor(COLOR).setDescription(texte.trim().slice(0, 4000));
  if (titre?.trim()) built.setTitle(titre.trim().slice(0, 256));
  return built;
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
    preview: ({ args }) => embed(args),
    confirm({ guild, args }) {
      embed(args);
      const channel = publishable(guild, args.salon);
      return `Publier dans #${channel.name}${args.mentionner_tout_le_monde ? ' avec @everyone' : ''}`;
    },
    async run({ guild, args }) {
      const channel = publishable(guild, args.salon);
      const everyone = Boolean(args.mentionner_tout_le_monde);
      const sent = await channel.send({
        content: everyone ? '@everyone' : undefined,
        embeds: [embed(args)],
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
    preview: ({ args }) => embed(args),
    confirm({ guild, args }) {
      embed(args);
      return `Modifier « ${existing(guild, args.publication).title.slice(0, 50)} »`;
    },
    async run({ guild, args }) {
      const publication = existing(guild, args.publication);
      const message = await fetchPublication(guild, publication);
      await message.edit({ embeds: [embed(args)] });
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
    async run({ guild }) {
      const list = recentPublications(guild.id);
      if (!list.length) return 'Aucune publication de MAGI sur ce serveur.';
      return list.map((p) => `- « ${p.title} » dans <#${p.channel_id}>, <t:${Math.floor(p.created_at / 1000)}:R> : https://discord.com/channels/${guild.id}/${p.channel_id}/${p.message_id}`).join('\n');
    },
  },
];
