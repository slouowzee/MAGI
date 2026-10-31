const NAMES = /(?<![\p{L}\p{N}])(?:magi|melchior|balthasar|casper)(?![\p{L}\p{N}])/giu;

const QUICK = [
  { kind: 'conge', emoji: '🫡', ends: true, always: true, words: ['repos', 'repos soldat', 'rompez', 'à vos ordres', 'a vos ordres', 'garde à vous', 'au rapport', 'dispose', 'disposez'] },
  { kind: 'fin', emoji: '👌', ends: true, always: true, words: ['ça ira', 'ca ira', "c'est sûr", "c'est sur", 'pas de souci', 'pas de soucis', 'pas de problème', 'pas de probleme', "t'inquiète", "t'inquiete", 'tkt', 'ça roule', 'ca roule', 'bien vu', "c'est clair", 'carrément', 'carrement', 'grave', 'laisse tomber', "c'est bon", 'on verra', 'si tu le dis', 'bref', 'exactement', 'exact', 'effectivement', 'clairement', 'trop vrai', 'en effet', 'je sais', 'je vois', "j'avoue", 'ah ok', "ah d'accord", 'oki', 'okk', 'ok ok', 'ok cool'] },
  { kind: 'merci', emoji: '❤️', ends: true, words: ['merci', 'merci beaucoup', 'merci bien', 'thx', 'thanks', 'ok merci', 'super merci', 'top merci', 'nickel merci', 'parfait merci', 'merci pour tout', 'c gentil', "c'est gentil", 'trop gentil'] },
  { kind: 'nuit', emoji: '👋', ends: true, words: ['bonne nuit'] },
  { kind: 'bye', emoji: '👋', ends: true, words: ['bonne soirée', 'bonne journée', 'à plus', 'a plus', 'a+', '++', 'bye', 'ciao', 'tchao', 'à demain', 'a demain', 'au revoir', 'salut et merci', 'je file', 'je te laisse'] },
  { kind: 'rire', emoji: '😄', ends: false, words: ['mdr', 'ptdr', 'lol', 'xd', 'haha', 'hahaha', 'ahah', 'ahahah', 'jpp', 'excellent', 'énorme', 'enorme', 'pas mal'] },
  { kind: 'ok', emoji: '👍', ends: false, words: ['ok', 'okay', "d'accord", 'dac', 'ça marche', 'ca marche', 'top', 'cool', 'parfait', 'nickel', 'génial', 'genial', 'compris', 'noté', 'note', 'vu', 'yes', 'ouais', 'oui'] },
];

const UNIT_EMOTES = {
  casper: { conge: 'pouce', fin: 'pouce', merci: 'love', nuit: 'dodo', bye: 'pouce', rire: 'mdr', ok: 'pouce', ignore: 'facepalm' },
  melchior: { conge: 'clope', fin: 'lunettes', merci: 'lunettes', nuit: 'cafe', bye: 'cafe', rire: 'lunettes', ok: 'lunettes', ignore: 'hmm' },
  balthasar: { conge: 'the', fin: 'the', merci: 'fiere', nuit: 'dodo', bye: 'the', rire: 'the', ok: 'the', ignore: 'inquiete' },
};

export function unitReaction(guild, persona, kind, fallback) {
  const name = UNIT_EMOTES[persona]?.[kind];
  return (name && guild?.emojis?.cache.find((e) => e.name === `${persona}_${name}`)) || fallback;
}

function normalize(text) {
  return text
    .replace(NAMES, ' ')
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[!?.,;:…~*_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const THANKS = /^(?:merci+|merki+|mrc|thx|thanks?|ty|tmtc)$/;
const FILLER = new Set(['ok', 'oki', 'okk', 'okay', 'top', 'super', 'bien', 'beaucoup', 'bcp', 'encore', 'grave', 'vraiment', 'trop', 'et', 'ah', 'parfait', 'nickel', 'cool', 'à', 'toi', 'pour', 'tout', 'ça']);

export function quickReaction(text) {
  const words = normalize(text);
  if (!words) return null;
  const found = QUICK.find((group) => group.words.includes(words));
  if (found) return found;
  const tokens = words.split(' ');
  if (tokens.length <= 4 && tokens.some((t) => THANKS.test(t)) && tokens.every((t) => THANKS.test(t) || FILLER.has(t))) return QUICK.find((group) => group.emoji === '❤️');
  return null;
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
