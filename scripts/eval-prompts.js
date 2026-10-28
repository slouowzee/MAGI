process.env.DB_PATH = ':memory:';
process.env.LOG_LEVEL ??= 'warning';
const { chat } = await import('../src/core/llm/client.js');
const { buildMessages, cleanReply, MAX_TOKENS } = await import('../src/core/llm/prompts.js');
const { conversationPrompt } = await import('../src/core/discord/history.js');

const MESSAGES = [
  "je viens de finir mon projet de bot discord, 3 semaines dessus",
  "vous pensez quoi de l'ananas sur la pizza ?",
  "j'ai encore oublié mes clés chez moi, je suis bloqué dehors",
  "c'est quoi la différence entre let et const en js ?",
  "j'en peux plus des cours, je suis épuisée",
  "t'es vraiment inutile comme bot",
];
const personas = process.argv.slice(2).length ? process.argv.slice(2) : ['melchior', 'balthasar', 'casper'];
const times = [];
for (const persona of personas) {
  console.log(`\n=== ${persona}`);
  for (const text of MESSAGES) {
    const started = performance.now();
    const reply = await chat({ messages: buildMessages(persona, [{ role: 'user', content: conversationPrompt([`slou : ${text}`], 'slou') }], 'courte'), options: { num_predict: MAX_TOKENS.courte } }).catch((err) => ({ content: `ÉCHEC : ${err.message}`, model: '-' }));
    const seconds = (performance.now() - started) / 1000;
    times.push(seconds);
    console.log(`« ${text} »\n  → ${cleanReply(reply.content)}  [${reply.model}, ${seconds.toFixed(1)} s]`);
  }
}
times.sort((a, b) => a - b);
console.log(`\n${times.length} réponses, médiane ${times[Math.floor(times.length / 2)].toFixed(1)} s, max ${times.at(-1).toFixed(1)} s`);
