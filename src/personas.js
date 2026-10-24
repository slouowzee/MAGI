export const PERSONAS = {
  melchior: { name: 'MELCHIOR-1', avatar: process.env.AVATAR_MELCHIOR || undefined },
  balthasar: { name: 'BALTHASAR-2', avatar: process.env.AVATAR_BALTHASAR || undefined },
  casper: { name: 'CASPER-3', avatar: process.env.AVATAR_CASPER || undefined },
};

export function personaByName(username) {
  return Object.keys(PERSONAS).find((key) => PERSONAS[key].name === username) ?? null;
}
