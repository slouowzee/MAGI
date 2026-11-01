export const PERSONAS = {
  __proto__: null,
  melchior: { name: 'Melchior', legacy: 'MELCHIOR-1', avatar: process.env.AVATAR_MELCHIOR || undefined },
  balthasar: { name: 'Balthasar', legacy: 'BALTHASAR-2', avatar: process.env.AVATAR_BALTHASAR || undefined },
  casper: { name: 'Casper', legacy: 'CASPER-3', avatar: process.env.AVATAR_CASPER || undefined },
};

export const personaLabel = (persona) => `${PERSONAS[persona].name} (MAGI)`;
