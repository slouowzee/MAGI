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
];
