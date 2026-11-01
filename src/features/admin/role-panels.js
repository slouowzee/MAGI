import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { framed } from '../../core/discord/embeds.js';
import { savePublication } from './publications-store.js';
import { targetChannel, targetRole } from './resolve.js';

const PREFIX = 'magi-role:';
const UNIQUE_PREFIX = 'magi-role1:';
const REASON = 'MAGI, rôle en libre-service';
const silent = { allowedMentions: { parse: [] } };
const DANGEROUS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.MentionEveryone,
];

export const isDangerous = (role) => DANGEROUS.some((p) => role.permissions.has(p, false));

function selfAssignable(guild, ref) {
  const role = targetRole(guild, ref);
  if (isDangerous(role)) throw new Error(`${role.name} donne des permissions de gestion ou de modération, il ne peut pas être en libre-service`);
  return role;
}

function panel(guild, args) {
  const names = [...new Set(args.roles ?? [])];
  if (!names.length) throw new Error('aucun rôle indiqué');
  if (names.length > 25) throw new Error('25 rôles au maximum');
  const roles = names.map((ref) => selfAssignable(guild, ref));
  const title = args.titre?.trim() || 'Choisis tes rôles';
  const description = [args.texte?.trim(), args.unique ? 'Un seul rôle à la fois.' : 'Clique pour prendre ou rendre un rôle.', roles.map((r) => `- ${r}`).join('\n')]
    .filter(Boolean)
    .join('\n\n');
  return { roles, title, embed: framed(guild, { label: 'Rôles', title, text: description }) };
}

function buttons(roles, unique) {
  const rows = [];
  for (let i = 0; i < roles.length; i += 5) {
    rows.push(
      new ActionRowBuilder().addComponents(
        roles.slice(i, i + 5).map((r) => new ButtonBuilder().setCustomId(`${unique ? UNIQUE_PREFIX : PREFIX}${r.id}`).setLabel(r.name.slice(0, 80)).setStyle(ButtonStyle.Secondary)),
      ),
    );
  }
  return rows;
}

export function rolePanel(guild, args) {
  const { roles, embed } = panel(guild, args);
  return { embeds: [embed], components: buttons(roles, args.unique), ...silent };
}

export const ROLE_PANEL_TOOLS = [
  {
    name: 'panneau_roles',
    description:
      "Publie un message à boutons qui permet aux membres de prendre ou rendre eux-mêmes des rôles (jeux, notifications, pronoms…). Les rôles doivent exister et ne donner aucune permission de gestion. Aperçu et confirmation avant publication.",
    parameters: {
      type: 'object',
      properties: {
        salon: { type: 'string', description: 'Mention, identifiant ou nom du salon.' },
        roles: { type: 'array', items: { type: 'string' }, description: 'Noms ou mentions des rôles, 25 au plus.' },
        titre: { type: 'string' },
        texte: { type: 'string', description: "Courte explication au-dessus de la liste." },
        unique: { type: 'boolean', description: 'Un seul rôle de la liste à la fois (par exemple une couleur).' },
      },
      required: ['salon', 'roles'],
    },
    access: 'operator',
    preview: ({ guild, args }) => panel(guild, args).embed,
    confirm({ guild, args }) {
      const { roles } = panel(guild, args);
      return `Publier le panneau de ${roles.length} rôle(s) dans #${targetChannel(guild, args.salon).name}`;
    },
    async run({ guild, args }) {
      const channel = targetChannel(guild, args.salon);
      if (!channel.isTextBased()) throw new Error(`${channel.name} n'est pas un salon textuel`);
      const { roles, title, embed } = panel(guild, args);
      const sent = await channel.send({ embeds: [embed], components: buttons(roles, args.unique), ...silent });
      savePublication({ guildId: guild.id, channelId: channel.id, messageId: sent.id, title: `Rôles : ${title}` });
      return `Panneau de rôles publié dans ${channel} : ${sent.url}`;
    },
  },
];

export function isRoleButton(customId) {
  return customId.startsWith(PREFIX) || customId.startsWith(UNIQUE_PREFIX);
}

export async function handleRoleButton(interaction) {
  const unique = interaction.customId.startsWith(UNIQUE_PREFIX);
  const roleId = interaction.customId.slice((unique ? UNIQUE_PREFIX : PREFIX).length);
  const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, ...silent }).catch(() => {});
  try {
    const role = selfAssignable(interaction.guild, roleId);
    const { member } = interaction;
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role, REASON);
      return reply(`Rôle ${role} retiré.`);
    }
    if (unique) {
      const others = interaction.message.components
        .flatMap((row) => row.components)
        .map((c) => c.customId?.slice(UNIQUE_PREFIX.length))
        .filter((id) => id && id !== role.id && member.roles.cache.has(id));
      if (others.length) await member.roles.remove(others, REASON);
    }
    await member.roles.add(role, REASON);
    return reply(`Rôle ${role} ajouté.`);
  } catch (err) {
    return reply(`Impossible : ${err.message}.`);
  }
}
