import { unitEmote } from '../../core/discord/emotes.js';

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
  casper: { conge: 'classe', fin: 'pouce', merci: 'love', nuit: 'dodo', bye: 'salut', rire: 'mdr', ok: 'pouce', ignore: 'facepalm' },
  melchior: { conge: 'clope', fin: 'lunettes', merci: 'love', nuit: 'dodo', bye: 'cafe', rire: 'lunettes', ok: 'pouce', ignore: 'hmm' },
  balthasar: { conge: 'the', fin: 'pouce', merci: 'love', nuit: 'dodo', bye: 'salut', rire: 'rire', ok: 'pouce', ignore: 'inquiete' },
};

export function unitReaction(persona, kind, fallback) {
  const name = UNIT_EMOTES[persona]?.[kind];
  return name ? unitEmote(persona, name, fallback) : fallback;
}

const MOOD_CHANCE = 0.3;
const MOOD_EMOTES = {
  casper: { nouvelle: 'fete', souci: 'choc', chambrage: 'nargue', debat: 'juge' },
  melchior: { nouvelle: 'pouce', souci: 'hmm', chambrage: 'juge', debat: 'loupe' },
  balthasar: { nouvelle: 'fiere', souci: 'inquiete', confidence: 'inquiete', chambrage: 'gene' },
};
const BAD_NEWS = /perdu|rat[ée]|larg|plaqu|vir[ée]|licenci|mort|d[ée]c[èe]s|enterr|accident|cass[ée]|vol[ée]|recal|malade|hospital|[ée]chou|rupture/i;

export function moodReaction(persona, register, text, random = Math.random) {
  if (random() >= MOOD_CHANCE) return null;
  const mood = register === 'nouvelle' && BAD_NEWS.test(text) ? 'confidence' : register;
  const name = MOOD_EMOTES[persona]?.[mood];
  return name ? unitEmote(persona, name) : null;
}

const QUIET_EMOTES = {
  casper: { mdr: 'franchement drôle', nargue: 'à taquiner', juge: 'choix douteux', choc: 'surprenant', cache: 'potin à suivre en douce', demon: 'plan fourbe', fete: 'bonne nouvelle à fêter' },
  melchior: { hmm: 'affirmation douteuse sans enjeu', loupe: 'détail curieux', lunettes: 'remarque bien vue' },
  balthasar: { rire: 'drôle et tendre', fiere: 'quelqu’un a bien réussi', love: 'moment attendrissant', the: 'moment calme et agréable', gene: 'situation gênante' },
};

export function quietChoices(personas) {
  return personas.flatMap((persona) => Object.entries(QUIET_EMOTES[persona] ?? {}).filter(([name]) => unitEmote(persona, name)).map(([name, when]) => ({ choice: `${persona}_${name}`, when })));
}

export function quietEmote(choice) {
  const [persona, name] = choice.split('_');
  return name ? unitEmote(persona, name) : null;
}

function normalize(text) {
  return text
    .replace(NAMES, ' ')
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[!?.,;:…~*_-]+/g, ' ')
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

export function floodCheck(key, now = Date.now()) {
  const last = lastRequest.get(key) ?? -Infinity;
  if (now - last < COOLDOWN) {
    const alreadyWarned = (warned.get(key) ?? -Infinity) >= last;
    warned.set(key, now);
    return alreadyWarned ? 'ignore' : 'warn';
  }
  lastRequest.set(key, now);
  return 'ok';
}
