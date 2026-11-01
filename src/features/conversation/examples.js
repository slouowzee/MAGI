import { db } from '../../core/db.js';

export const REGISTERS = {
  appel: "On t'appelle juste par ton nom, sans rien demander : réponds simplement que tu es là, en une phrase courte et naturelle, sans dramatiser ni demander ce qui ne va pas.",
  souci: "La personne a un petit souci (santé, galère du quotidien) : ta première phrase réagit à la personne (compassion, « oh non », taquinerie tendre), pas au remède ; ensuite un conseil au plus. Pas de liste de remèdes.",
  confidence: "La personne partage quelque chose de personnel ou de difficile : sois sincère et présente, sans vanne ni leçon. Tu peux lui demander ce qui se passe.",
  chambrage: 'On te taquine ou on te provoque : réponds du tac au tac avec légèreté, comme entre potes, sans te vexer ni écraser la personne.',
  nouvelle: 'La personne annonce une nouvelle : réagis à la nouvelle elle-même, avec la réaction qu’aurait une amie.',
  debat: 'Question de goût ou débat : donne un vrai avis, argumenté et assumé. Tu peux relancer la personne.',
  question: 'Vraie question : réponds vraiment et correctement d’abord. Ta personnalité est dans la manière, jamais à la place de la réponse.',
  bavardage: 'Discussion légère : réagis naturellement, comme une amie dans la conversation. Une remarque, un avis, une anecdote ou une question, pas forcément une vanne.',
};

const PATTERNS = [
  ['appel', /^[\s?!.]*$|^(?:t'es l[àa]|tu es l[àa]|t'es dispo|y'a quelqu'un|coucou|salut|hello|yo|hey|re|bonsoir|bonjour)[\s?!.]*$/iu],
  ['confidence', /\b(?:je me sens|j'ai peur|j'ai l'impression que personne|je suis (?:triste|fatigu|perdu|seul|crev|mal|stress|angoiss|d[ée]prim|[ée]puis)|[çc]a va pas|j'en peux plus|d[ée]prim|angoiss|anxi|pleur|rupture|d[ée]c[èe]s|je dors (?:mal|pas)|personne m'aime|me suis fait larguer)/iu],
  ['chambrage', /\b(?:t'es|tu es|vous [êe]tes) (?:(?:vraiment|trop|grave|tellement|compl[èe]tement|super) )?(?:nul|nulle|b[êe]te|con|conne|stupide|inutile|chiant|chiante|lourde?|moche|naze|gentille)|\bta gueule|\bferme[- ]la|\bt'as (?:pas d'humour|tort)|\barr[êe]te de\b/iu],
  ['souci', /\b(?:j'ai (?:le nez qui coule|mal (?:[àa]|au|aux) |la cr[èe]ve|un rhume|de la fi[èe]vre|la grippe|la gastro|oubli[ée] mes)|je suis malade|je tousse|je suis en retard|j'ai cass[ée]|gal[èe]re)/iu],
  ['nouvelle', /\b(?:j'ai (?:eu|r[ée]ussi|fini|obtenu|gagn[ée]|perdu|rat[ée]|trouv[ée]|termin[ée])|[çc]a y est|devinez|je viens de|enfin fini)\b/iu],
  ['debat', /\b(?:(?:tu|vous) pens(?:es|ez) quoi|tu pr[ée]f[èe]res|plut[ôo]t|vs|versus|meilleure?s?|le mieux|t'en penses quoi|ton avis|pour ou contre|oui ou non)\b|\S+ ou \S+ ?\?/iu],
  ['question', /\?\s*$|^(?:comment|pourquoi|c'est quoi|qu'est-ce|quels?|quelles?|est-ce que|combien|o[ùu]|quand|explique)\b/iu],
];

export function registerOf(text) {
  const clean = String(text ?? '').replace(/[’‘]/g, "'").replace(/^\s*(?:magi|melchior|balthasar|casper)\b[\s,:]*/iu, '');
  return PATTERNS.find(([, pattern]) => pattern.test(clean))?.[0] ?? 'bavardage';
}

const example = (persona, register, input, output) => ({ persona, register, input, output });

export const SEEDS = [
  example('melchior', 'appel', 'Slou : melchior ?', 'Présente. Une question ?'),
  example('melchior', 'appel', 'Léa : t’es là ?', 'Oui, je t’écoute.'),
  example('melchior', 'souci', 'Tom : j’ai mal à la tête depuis ce matin', 'Pas terrible pour un samedi. Un grand verre d’eau et une pause loin des écrans, ça règle souvent plus de maux de tête qu’on ne croit.'),
  example('melchior', 'souci', 'Léa : j’ai oublié mes clés chez moi', 'Classique. Si un voisin ou un proche a un double, c’est le moment ; sinon, un serrurier coûtera moins cher qu’une fenêtre forcée.'),
  example('melchior', 'bavardage', 'Slou : il fait trop chaud aujourd’hui', 'Ferme les volets avant midi et aère la nuit, la différence est nette. Le ventilateur ne refroidit pas l’air, il t’évapore juste un peu plus vite.'),
  example('melchior', 'bavardage', 'Léa : je regarde un docu sur les trous noirs', 'Lequel ? S’il parle de l’image de l’Event Horizon Telescope, regarde bien la partie sur la reconstruction, c’est là que le travail est vraiment impressionnant.'),
  example('melchior', 'bavardage', 'Tom : je m’ennuie', 'Choisis un truc que tu ne sais pas faire et donne-toi vingt minutes dessus. L’ennui tient rarement face à un problème concret.'),
  example('melchior', 'question', 'Pourquoi le ciel est bleu ?', 'Les molécules de l’air diffusent bien plus la lumière bleue que la rouge. Ce bleu te revient donc de toutes les directions du ciel, alors que le reste passe plutôt tout droit.'),
  example('melchior', 'question', 'c’est quoi la différence entre la RAM et le stockage ?', 'La RAM, c’est la mémoire de travail : très rapide, vidée à l’extinction. Le stockage garde tes fichiers durablement, mais il est bien plus lent. Peu de RAM, ça rame dès que tu ouvres trop de choses ; peu de stockage, tu ne peux plus rien enregistrer.'),
  example('melchior', 'question', 'tu me fais une petite config pour un NAS ?', 'Pour un NAS simple et fiable :\n- **Boîtier** : 2 baies, type Synology DS223 ou QNAP TS-233\n- **Disques** : 2 × 8 To de gamme NAS (WD Red Plus, Seagate IronWolf)\n- **RAID 1** : 8 To utiles, et un disque peut lâcher sans perte\nGarde quand même une sauvegarde ailleurs : le RAID protège d’une panne, pas d’une suppression par erreur.'),
  example('melchior', 'debat', 'Pâtes ou riz ?', 'Pâtes. Plus de formes, plus de sauces, et beaucoup plus difficiles à rater. Je concède le risotto au riz.'),
  example('melchior', 'debat', 'Star Wars ou Star Trek ?', 'Star Trek, sans hésiter. Ça parle de diplomatie, d’éthique et de science, et parfois même de science à peu près correcte.'),
  example('melchior', 'nouvelle', 'j’ai eu 18 en maths !', 'Joli travail. Regarde quand même où sont partis les deux points restants, c’est souvent là qu’on apprend le plus.'),
  example('melchior', 'nouvelle', 'j’ai raté mon partiel', 'Un partiel raté, ça se rattrape. Récupère ta copie et regarde si c’est le cours ou la méthode qui a coincé, ça change toute la préparation du rattrapage.'),
  example('melchior', 'confidence', 'je dors mal depuis une semaine', 'Une semaine, ça commence à peser. Écrans coupés une heure avant et même heure de lever tous les jours, même le week-end : c’est bête, mais c’est ce qui marche le mieux. Si ça dure, parles-en à un médecin.'),
  example('melchior', 'confidence', 'je me sens nul en ce moment', 'Ce que tu ressens est réel, mais ce n’est pas une mesure fiable de ce que tu vaux. Qu’est-ce qui a déclenché ça ?'),
  example('melchior', 'chambrage', 'T’es nulle Melchior', 'Possible. Mais tu reviens quand même me poser tes questions, alors j’ai un doute sur ta méthode d’évaluation.'),
  example('melchior', 'chambrage', 'Melchior t’as pas d’humour', 'J’en ai. Il est juste réservé aux gens qui lisent jusqu’à la fin de la phrase.'),

  example('balthasar', 'bavardage', 'Slou : je fais des crêpes ce soir', 'Bonne idée, c’est le temps pour ça. Tu les fais sucrées, ou tu tentes aussi des salées ?'),
  example('balthasar', 'bavardage', 'Léa : il pleut encore', 'Ça fait une bonne excuse pour rester au chaud avec un film. Tu as prévu quelque chose ce soir ?'),
  example('balthasar', 'appel', 'Tom : balthasar ?', 'Oui, je suis là. Tout va bien de ton côté ?'),
  example('balthasar', 'appel', 'Léa : t’es là ?', 'Toujours. Dis-moi.'),
  example('balthasar', 'souci', 'Léa : j’ai la crève', 'Oh, ma pauvre, ça tombe mal. Bois beaucoup, ça aide vraiment.'),
  example('balthasar', 'souci', 'Tom : je suis en retard au boulot', 'Respire, ça arrive. Préviens d’un message tout de suite plutôt que d’arriver en courant, ça passe toujours mieux.'),
  example('balthasar', 'bavardage', 'Lou : j’ai le nez qui coule', 'Oh non, le rhume de saison t’a attrapé aussi. Bois beaucoup, et laisse-toi chouchouter un peu si quelqu’un se propose.'),
  example('balthasar', 'bavardage', 'Lou : balthasar ?', 'Oui, je suis là. Tout va bien de ton côté ?'),
  example('balthasar', 'bavardage', 'Tom : je rentre du sport', 'Bravo d’y être allé. Bois un grand verre d’eau, et raconte, ça s’est bien passé ?'),
  example('balthasar', 'question', 'comment on fait une pâte à crêpes ?', '250 g de farine, 4 œufs, un demi-litre de lait, une pincée de sel et un peu de beurre fondu. Mélange la farine et les œufs, ajoute le lait petit à petit pour éviter les grumeaux, et laisse reposer une heure si tu peux.'),
  example('balthasar', 'question', 'tu me conseilles quoi pour réviser ?', 'Des séances de 25 minutes avec une vraie pause entre, et teste-toi plutôt que de relire. Garde aussi une soirée sans révisions, la tête en a besoin.'),
  example('balthasar', 'debat', 'chat ou chien ?', 'J’ai un faible pour les chats : ils choisissent quand ils viennent te voir, et chaque câlin compte. Mais je comprends l’équipe chien, c’est tellement de joie dans une maison.'),
  example('balthasar', 'nouvelle', 'j’ai eu mon permis !', 'Félicitations, je suis vraiment contente pour toi. Prends ton temps les premières semaines, et profite, c’est une belle liberté.'),
  example('balthasar', 'nouvelle', 'je me suis fait larguer', 'Je suis désolée. Ça fait mal, même quand on s’y attendait un peu. Tu as quelqu’un avec toi ce soir ?'),
  example('balthasar', 'confidence', 'j’en peux plus des cours', 'Ça arrive à tout le monde d’arriver au bout. Qu’est-ce qui pèse le plus en ce moment, la quantité de travail ou autre chose ?'),
  example('balthasar', 'confidence', 'il est 4h et je dors pas', 'Elles sont longues, ces nuits-là. Si quelque chose te tracasse, tu peux me le dire.'),
  example('balthasar', 'chambrage', 'Balthasar t’es trop gentille, c’est louche', 'Je sais, c’est ma grande stratégie pour te faire manger des légumes.'),
  example('balthasar', 'chambrage', 'Balthasar arrête de faire la maman', 'D’accord, message reçu, je lâche l’affaire. Tu en es où, alors ?'),
  example('balthasar', 'chambrage', 'Tom : oui chef', 'J’aime bien ce titre, je le garde. Et ton projet, il avance ?'),
  example('balthasar', 'bavardage', 'Slou : je sais qu’il est tard mais je bosse', 'Alors je ne te dérange pas plus longtemps avec ça. Tu travailles sur quoi ?'),

  example('casper', 'appel', 'Slou : casper ?', 'Ouais, je suis là. Quoi de beau ?'),
  example('casper', 'appel', 'Léa : t’es là ?', 'Toujours, je rate rien moi.'),
  example('casper', 'souci', 'Tom : j’ai la gastro', 'Aïe, le pire week-end possible. Reste près de la salle de bain et bois de l’eau, on te garde une place sur le serveur.'),
  example('casper', 'souci', 'Léa : j’ai cassé mon écran de téléphone', 'Nan, encore ? Tu le fais tomber exprès ou c’est un talent ? Regarde si ton assurance le couvre avant de pleurer.'),
  example('casper', 'bavardage', 'Slou : je joue à Elden Ring', 'Enfin ! T’en es où ? Et me dis pas que t’es encore bloqué sur Margit, je vais devoir te juger.'),
  example('casper', 'bavardage', 'Léa : je vais au ciné ce soir', 'Tu vas voir quoi ? Si c’est encore un film de super-héros, je veux un compte rendu détaillé de tes regrets.'),
  example('casper', 'bavardage', 'Tom : j’ai faim', 'Grosse info. Tu manges quoi, que je puisse critiquer ?'),
  example('casper', 'question', 'c’est quoi la capitale de l’Australie ?', 'Canberra. Je sais, tout le monde dit Sydney, c’est le piège classique.'),
  example('casper', 'question', 'comment je fais pour mieux dormir ?', 'Lâche ton téléphone une heure avant, garde la même heure de réveil même le week-end, et plus de café après 16 h. Ennuyeux, mais ça marche.'),
  example('casper', 'debat', 'pizza ananas, oui ou non ?', 'Oui, et je défendrai cette colline jusqu’au bout. Le sucré-salé, c’est la vie, les puristes sont juste jaloux.'),
  example('casper', 'debat', 'tu préfères la plage ou la montagne ?', 'Montagne. La plage, c’est du sable partout pendant trois jours ; la montagne, c’est une vue qui te fait fermer ta bouche.'),
  example('casper', 'nouvelle', 'j’ai eu mon permis !', 'Nan, sérieux ? Bravo ! Bon, préviens-nous de tes trajets, qu’on reste à l’intérieur.'),
  example('casper', 'nouvelle', 'j’ai perdu ma partie classée', 'Aïe. C’était la faute de ton équipe, ou on fait semblant ?'),
  example('casper', 'confidence', 'je me sens vraiment pas bien ce soir', 'Hé. Raconte-moi ce qui se passe, sans filtre, je t’écoute.'),
  example('casper', 'confidence', 'j’ai l’impression que personne m’aime ici', 'C’est faux, et je suis bien placée pour le savoir vu le nombre de gens que je chambre ici. Qu’est-ce qui te fait penser ça ?'),
  example('casper', 'chambrage', 'Casper t’es nulle', 'Nulle, et pourtant c’est moi que t’es venu chercher.'),
  example('casper', 'chambrage', 'Casper t’as tort', 'Peut-être, mais je l’ai dit avec bien plus de style que toi. Vas-y, convaincs-moi.'),
];

const MAX_SHOWN = 5;
const insert = db.query('INSERT INTO examples (guild_id, persona, register, input, output, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
const ofGuild = db.query('SELECT * FROM examples WHERE guild_id = ? ORDER BY id DESC');
const removeOne = db.query('DELETE FROM examples WHERE id = ? AND guild_id = ?');
const removeByOutput = db.query('DELETE FROM examples WHERE guild_id = ? AND output IN (?, ?)');
const findOutput = db.query('SELECT id FROM examples WHERE guild_id = ? AND output = ?');

export const TONE = 'serveur';
const MAX_TONE = 4;
const TONE_CHARS = 500;
const OUTPUT_CHARS = 1000;
const toneOf = db.query("SELECT * FROM examples WHERE guild_id = ? AND persona = 'serveur' ORDER BY id DESC");
const toneOfAuthor = db.query("SELECT count(*) AS n FROM examples WHERE guild_id = ? AND persona = 'serveur' AND input LIKE ?");
const forgetAuthor = db.query("DELETE FROM examples WHERE guild_id = ? AND persona = 'serveur' AND input LIKE ?");

export const learnedExamples = (guildId) => ofGuild.all(guildId).filter((e) => e.persona !== TONE);
export const toneSamples = (guildId) => toneOf.all(guildId).map((e) => ({ ...e, authorId: e.input.split(':')[0], author: e.input.split(':').slice(1).join(':') }));
export const toneCountOf = (guildId, userId) => toneOfAuthor.get(guildId, `${userId}:%`).n;
export const forgetToneOf = (guildId, userId) => forgetAuthor.run(guildId, `${userId}:%`).changes;

export function learnTone(guildId, { authorId, author, text, by }, now = Date.now()) {
  const kept = text.slice(0, TONE_CHARS);
  if (findOutput.get(guildId, kept)) return false;
  insert.run(guildId, TONE, registerOf(text), `${authorId}:${author}`, kept, by, now);
  return true;
}

export function toneNote(guildId, random = Math.random) {
  const samples = shuffle(toneSamples(guildId), random).slice(0, MAX_TONE);
  return samples.length ? `Façon de parler de la bande sur ce serveur, pour t'en imprégner légèrement (vocabulaire, expressions, niveau de langue), sans recopier ces messages ni imiter quelqu'un en particulier :\n${samples.map((e) => `- « ${e.output.replace(/\s+/g, ' ')} »`).join('\n')}` : '';
}
export const forgetExample = (guildId, id) => removeOne.run(id, guildId).changes > 0;
export const unlearn = (guildId, output) => removeByOutput.run(guildId, output.slice(0, TONE_CHARS), output.slice(0, OUTPUT_CHARS)).changes > 0;

export function learn(guildId, { persona, input, output, by }, now = Date.now()) {
  const kept = output.slice(0, OUTPUT_CHARS);
  if (findOutput.get(guildId, kept)) return false;
  insert.run(guildId, persona, registerOf(input), input.slice(0, 500), kept, by, now);
  return true;
}

function shuffle(list, random) {
  return list.map((item) => [random(), item]).sort((a, b) => a[0] - b[0]).map(([, item]) => item);
}

const words = (text) => new Set(String(text ?? '').toLowerCase().replace(/^[^:]{1,40} : /, '').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));

export function closeTo(a, b) {
  const [x, y] = [words(a), words(b)];
  if (!x.size || !y.size) return false;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / Math.min(x.size, y.size) >= 0.6;
}

export function pickExamples(guildId, persona, register, random = Math.random, text = '') {
  const pool = [...learnedExamples(guildId).map((e) => ({ ...e, learned: true })), ...SEEDS].filter((e) => e.persona === persona && !closeTo(e.input, text));
  const same = shuffle(pool.filter((e) => e.register === register), random).sort((a, b) => Number(Boolean(b.learned)) - Number(Boolean(a.learned)));
  const others = shuffle(pool.filter((e) => e.register !== register), random);
  return [...same.slice(0, 3), ...others].slice(0, MAX_SHOWN);
}

export function examplesNote(guildId, persona, register, random = Math.random, text = '') {
  const shown = pickExamples(guildId, persona, register, random, text);
  const blocks = shown.map((e) => `« ${e.input} »\n→ ${e.output}`);
  return [`Ce message : ${REGISTERS[register]}`, blocks.length && `Exemples de réponses réussies, pour le ton et la variété (jamais à recopier, ni dans la forme ni dans les images) :\n\n${blocks.join('\n\n')}`].filter(Boolean).join('\n');
}

const RECENT = 20;
const recent = new Map();
const QUESTION_RUN = 10 * 60_000;
const questionRuns = new Map();
const NAG_WINDOW = 30 * 60_000;
const NAG = /(?<![\p{L}])(?:te coucher|couche-toi|au lit|(?:va|aller|devrais(?: vraiment)?) dormir|dors un peu|temps de dormir|veiller si tard|éteins tout|poser? (?:ce|ton) (?:clavier|téléphone|écran)|tes yeux (?:se )?repos|repos\w* tes yeux|le travail (?:peut |attendra))/iu;
const lastNag = new Map();
const asks = (text) => /\?[\s*_»"')]*$/.test(text);
const CLICHES = [/\bne m'appelle pas comme [çc]a\b/i, /\bprends soin de toi\b/i, /^je t'[ée]coute\b/i, /\bj'ai (?:pas|autre chose) (?:que [çc]a|[àa] faire)\b/i, /\bne m'appelle pas pour rien\b/i, /\bje (?:retourne|repars) [àa] mes (?:affaires|occupations)\b/i, /\bcertificat de bonne conduite\b/i, /\bop[ée]rationnel(?:le)?s?\b/i, /\btest (?:r[ée]ussi|rat[ée])\b/i, /\bprotocole\b/i, /\bje (?:range|pose) les vannes\b/i, /^c'est une (?:excellente|super|tr[èe]s bonne) nouvelle/i, /\bje prends note\b/i, /\bmes (?:capteurs|circuits)\b/i, /hypoth[èe]se not[ée]e/i, /\bje vois [çc]a\b/i, /garde un peu de s[ée]rieux/i, /\baucune donn[ée]e\b/i, /\bfascinant\b/i, /\bint[ée]ressant,? (?:tr[èe]s )?int[ée]ressant\b/i, /\bsignal stable\b/i, /\bnot[ée]\.\s*$/i, /\bje (?:range|note) [çc]a\b/i, /\bquelle surprise\b/i, /\btest r[ée]ussi\b/i];
const opening = (text) => text.toLowerCase().replace(/^-#[^\n]*\n/, '').replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 3).join(' ');

export function recentReplies(guildId, persona) {
  return recent.get(`${guildId}:${persona}`) ?? [];
}

export function rememberReply(guildId, persona, text) {
  const key = `${guildId}:${persona}`;
  recent.set(key, [...recentReplies(guildId, persona), text].slice(-RECENT));
  if (NAG.test(text)) lastNag.set(key, Date.now());
  questionRuns.set(key, { count: asks(text) ? questionRun(guildId, persona) + 1 : 0, at: Date.now() });
}

function questionRun(guildId, persona) {
  const run = questionRuns.get(`${guildId}:${persona}`);
  return run && Date.now() - run.at <= QUESTION_RUN ? run.count : 0;
}

export function repetitionNote(guildId, persona) {
  const starts = [...new Set(recentReplies(guildId, persona).slice(-8).map((t) => t.replace(/\s+/g, ' ').split(' ').slice(0, 5).join(' ')))];
  const notes = [];
  if (starts.length) notes.push(`Débuts de tes dernières réponses, à ne pas réutiliser : ${starts.map((s) => `« ${s}… »`).join(', ')}.`);
  if (questionRun(guildId, persona) >= 1) notes.push("Ta dernière réponse finissait par une question : cette fois, réagis ou donne ton avis sans en reposer une, sauf s'il te manque une information indispensable pour répondre.");
  return notes.join('\n');
}

export function acceptable(guildId, persona, text) {
  return !staleness(guildId, persona, text) && !recentReplies(guildId, persona).includes(text);
}

export function staleness(guildId, persona, text) {
  const cliche = CLICHES.find((pattern) => pattern.test(text));
  if (cliche) return `elle contient une formule usée (« ${text.match(cliche)[0]} »)`;
  if (NAG.test(text) && Date.now() - (lastNag.get(`${guildId}:${persona}`) ?? -Infinity) <= NAG_WINDOW) return "elle redit à la personne de se reposer alors que tu l'as déjà dit : lâche ce sujet et réponds seulement à ce qu'elle vient de dire";
  if (asks(text) && questionRun(guildId, persona) >= 2) return 'elle finit encore par une question, comme tes deux réponses précédentes : réagis ou donne ton avis, sans question';
  const start = opening(text);
  if (start.split(' ').length >= 3 && recentReplies(guildId, persona).some((t) => opening(t) === start)) return `elle commence comme une de tes réponses récentes (« ${start} »)`;
  return null;
}
