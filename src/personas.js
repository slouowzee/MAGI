export const PERSONAS = {
  melchior: { name: 'Melchior', avatar: process.env.AVATAR_MELCHIOR || undefined },
  balthasar: { name: 'Balthasar', avatar: process.env.AVATAR_BALTHASAR || undefined },
  casper: { name: 'Casper', avatar: process.env.AVATAR_CASPER || undefined },
};

export function personaByName(username) {
  return Object.keys(PERSONAS).find((key) => PERSONAS[key].name === username) ?? null;
}
