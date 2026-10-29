import { ApplicationCommandOptionType as O, ApplicationCommandType, PermissionFlagsBits as P } from 'discord.js';

export const DEBUG_COMMANDS = [
  {
    perms: String(P.Administrator),
    data: {
      name: 'debug',
      type: ApplicationCommandType.ChatInput,
      description: 'Mode débogage de MAGI (propriétaire du serveur)',
      options: [
        { type: O.Subcommand, name: 'console', description: 'Ouvrir la console de débogage' },
        { type: O.Subcommand, name: 'importer', description: 'Importer une configuration exportée', options: [{ type: O.Attachment, name: 'fichier', description: 'Le fichier .json exporté', required: true }] },
      ],
    },
  },
];
