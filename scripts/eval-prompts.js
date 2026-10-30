process.env.DB_PATH = ':memory:';
process.env.LOG_LEVEL ??= 'warning';
const { chat, forReply } = await import('../src/core/llm/client.js');
const { buildMessages, cleanReply, MAX_TOKENS } = await import('../src/core/llm/prompts.js');
const { conversationPrompt } = await import('../src/core/discord/history.js');
const { acceptable, examplesNote, registerOf, rememberReply, repetitionNote, staleness } = await import('../src/features/conversation/examples.js');
const { quickReaction } = await import('../src/features/conversation/rules.js');

const MESSAGES = [
  'je viens de finir mon projet de bot discord, 3 semaines dessus',
  "vous pensez quoi de l'ananas sur la pizza ?",
  "j'ai encore oublié mes clés chez moi, je suis bloqué dehors",
  "c'est quoi la différence entre let et const en js ?",
  "j'en peux plus des cours, je suis épuisée",
  't’es vraiment inutile comme bot',
  'je me lance dans la cuisine japonaise ce week-end',
  "il pleut depuis ce matin, ça me saoule",
  "j'ai eu mon code du premier coup !",
  'tu préfères les chats ou les chiens ?',
  'on se fait un film ce soir, des idées ?',
  'je comprends rien aux impôts',
  "je me sens un peu seul en ce moment",
  'comment je fais pour arrêter de procrastiner ?',
  "mon pc fait un bruit bizarre depuis hier",
  'qui a la meilleure musique, les années 80 ou 2000 ?',
  "t'as pas d'humour en fait",
  'je viens de me faire larguer',
  "j'ai acheté un clavier mécanique, je regrette rien",
  'pourquoi les avions laissent des traînées blanches ?',
  'demain je passe un entretien, je stresse',
  'le dernier épisode de la série était nul',
  'tu dors jamais toi ?',
  "j'ai mangé trop de raclette",
  'il est 3 h et je joue encore',
  "c'est quoi ton jeu préféré ?",
  'ma plante est en train de mourir',
  'on parie que je finis le jeu ce soir ?',
  "je crois que mon chat me déteste",
  "bonne nouvelle, j'ai trouvé un appart",
];

const CONVERSATIONS = [
  ['casper ?', "c'est déjà bien mieux niveau réponse", 'ça ira.', 'repos, soldat.'],
  ['melchior ?', 'tu me fais une petite config pour un nas ?', 'bof, un truc basique, un raid 1 et des disques de 8to', 'et tu me recommandes quoi ?'],
  ['melchior, tu fais quoi ce soir ?', 'cool, et tu me conseilles quoi comme film ?', "c'est sûr", 'merci'],
  ['balthasar ?', "j'ai le nez qui coule", "peut être bien oui, d'autres idées ?", 'oki, merki'],
  ["balthasar, j'ai eu une journée pourrie", "mon chef m'a engueulé devant tout le monde", 'ouais', 'merci, ça fait du bien'],
  ['casper, pizza ou burger ce soir ?', 'nan mais sérieux', 't’es bête mdr', 'bon je vais manger'],
];

const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const named = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const personas = named.length ? named : ['melchior', 'balthasar', 'casper'];

async function reply(persona, text, lines) {
  const register = registerOf(text);
  const extra = [examplesNote('banc', persona, register, Math.random, text), repetitionNote('banc', persona)].filter(Boolean).join('\n');
  const messages = buildMessages(persona, [{ role: 'user', content: conversationPrompt(lines, 'slou') }], 'courte', extra);
  let answer = await chat({ messages, options: { num_predict: MAX_TOKENS.courte }, ...forReply() }).catch((err) => ({ content: `ÉCHEC : ${err.message}`, model: '-' }));
  const stale = staleness('banc', persona, cleanReply(answer.content));
  if (stale) {
    const retry = await chat({ messages: [...messages, { role: 'assistant', content: answer.content }, { role: 'user', content: `Réécris ta réponse autrement : ${stale}. Même idée si elle est bonne, mais d'autres mots et une autre construction, sans reprendre aucune de tes réponses précédentes.` }], options: { num_predict: MAX_TOKENS.courte }, ...forReply() }).catch(() => null);
    if (retry?.content?.trim() && acceptable('banc', persona, cleanReply(retry.content))) answer = retry;
  }
  const cleaned = cleanReply(answer.content);
  rememberReply('banc', persona, cleaned);
  return { cleaned, register, model: answer.model, stale };
}

async function converse(persona, turns) {
  const out = [];
  const lines = [];
  for (const text of turns) {
    lines.push(`slou : ${text}`);
    const quick = quickReaction(text);
    if (quick) {
      out.push(`  slou : ${text}\n    → [réaction ${quick.emoji}${quick.ends ? ', fin' : ''}]`);
      if (quick.ends) break;
      continue;
    }
    const { cleaned } = await reply(persona, text, lines);
    lines.push(`Toi (à slou) : ${cleaned}`);
    out.push(`  slou : ${text}\n    → ${cleaned}`);
  }
  return out.join('\n');
}

async function run(persona) {
  const lines = [`\n=== ${persona}`];
  for (const turns of CONVERSATIONS.filter((c) => c[0].toLowerCase().startsWith(persona))) lines.push(`[conversation]\n${await converse(persona, turns)}`);
  if (flags.includes('--conversations')) return lines.join('\n');
  const times = [];
  let rewritten = 0;
  for (const text of MESSAGES) {
    const register = registerOf(text);
    const extra = [examplesNote('banc', persona, register, Math.random, text), repetitionNote('banc', persona)].filter(Boolean).join('\n');
    const messages = buildMessages(persona, [{ role: 'user', content: conversationPrompt([`slou : ${text}`], 'slou') }], 'courte', extra);
    const started = performance.now();
    let reply = await chat({ messages, options: { num_predict: MAX_TOKENS.courte }, ...forReply() }).catch((err) => ({ content: `ÉCHEC : ${err.message}`, model: '-' }));
    const stale = staleness('banc', persona, cleanReply(reply.content));
    if (stale) {
      rewritten++;
      const retry = await chat({ messages: [...messages, { role: 'assistant', content: reply.content }, { role: 'user', content: `Réécris ta réponse autrement : ${stale}. Même idée si elle est bonne, mais d'autres mots et une autre construction, sans reprendre aucune de tes réponses précédentes.` }], options: { num_predict: MAX_TOKENS.courte }, ...forReply() }).catch(() => null);
      if (retry?.content?.trim() && acceptable('banc', persona, cleanReply(retry.content))) reply = retry;
    }
    const seconds = (performance.now() - started) / 1000;
    times.push(seconds);
    const cleaned = cleanReply(reply.content);
    rememberReply('banc', persona, cleaned);
    lines.push(`[${register}] « ${text} »\n  → ${cleaned}  (${reply.model}, ${seconds.toFixed(1)} s${stale ? ', réécrite' : ''})`);
  }
  times.sort((a, b) => a - b);
  lines.push(`${times.length} réponses, médiane ${times[Math.floor(times.length / 2)].toFixed(1)} s, max ${times.at(-1).toFixed(1)} s, ${rewritten} réécrite(s)`);
  return lines.join('\n');
}

for (const block of await Promise.all(personas.map(run))) console.log(block);
