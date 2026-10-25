const NAMES = /(?<![\p{L}\p{N}])(?:magi|melchior|balthasar|casper)(?![\p{L}\p{N}])/giu;

const QUICK = [
  { emoji: '❤️', ends: true, words: ['merci', 'merci beaucoup', 'merci bien', 'thx', 'thanks', 'ok merci', 'super merci', 'top merci', 'nickel merci', 'parfait merci', 'merci pour tout', 'c gentil', "c'est gentil", 'trop gentil'] },
  { emoji: '👋', ends: true, words: ['bonne nuit', 'bonne soirée', 'bonne journée', 'à plus', 'a plus', 'a+', '++', 'bye', 'ciao', 'tchao', 'à demain', 'a demain', 'au revoir', 'salut et merci', 'je file', 'je te laisse'] },
  { emoji: '😄', ends: false, words: ['mdr', 'ptdr', 'lol', 'xd', 'haha', 'hahaha', 'ahah', 'ahahah', 'jpp', 'excellent', 'énorme', 'enorme', 'pas mal'] },
  { emoji: '👍', ends: false, words: ['ok', 'okay', "d'accord", 'dac', 'ça marche', 'ca marche', 'top', 'cool', 'parfait', 'nickel', 'génial', 'genial', 'compris', 'noté', 'note', 'vu', 'yes', 'ouais', 'oui'] },
];

function normalize(text) {
  return text
    .replace(NAMES, ' ')
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[!?.,;:…~*_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function quickReaction(text) {
  const words = normalize(text);
  if (!words) return null;
  return QUICK.find((group) => group.words.includes(words)) ?? null;
}

const COOLDOWN = 5_000;
const lastRequest = new Map();
const warned = new Map();

export function floodCheck(userId, now = Date.now()) {
  const last = lastRequest.get(userId) ?? -Infinity;
  if (now - last < COOLDOWN) {
    const alreadyWarned = (warned.get(userId) ?? -Infinity) >= last;
    warned.set(userId, now);
    return alreadyWarned ? 'ignore' : 'warn';
  }
  lastRequest.set(userId, now);
  return 'ok';
}
