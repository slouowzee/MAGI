import { afterAll, beforeEach, expect, setSystemTime, test } from 'bun:test';
import { Collection, SnowflakeUtil } from 'discord.js';

process.env.DB_PATH = ':memory:';
process.env.GEMINI_API_KEY = 'test';
process.env.GEMINI_MODEL = 'modele-scenarios';

const requests = [];
let route = null;
let reply = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://cdn.test/')) return new Response(new Uint8Array([71, 73, 70, 56, 57, 97]), { headers: { 'content-type': 'image/gif' } });
  if (!String(url).startsWith('https://generativelanguage.googleapis.com')) return realFetch(url, init);
  const body = JSON.parse(init.body);
  const props = body.response_format?.json_schema?.schema?.properties ?? {};
  const answer = (content) => Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }] });
  if (props.choix) {
    const choices = props.choix.enum;
    return answer(JSON.stringify({ choix: route && choices.includes(route) ? route : choices.includes('rester') ? 'rester' : choices[0] }));
  }
  if (props.verdict) return answer(JSON.stringify({ avis: 'Je vote pour.', verdict: 'APPROUVÉ' }));
  const system = body.messages[0].content;
  const last = body.messages.at(-1).content;
  const parts = Array.isArray(last) ? last : [{ type: 'text', text: last }];
  requests.push({
    persona: system.match(/Tu es (\w+),/)?.[1].toLowerCase(),
    context: parts[0].text,
    media: parts.filter((p) => p.type === 'image_url').map((p) => p.image_url.url),
  });
  return answer(`Réponse ${++reply}.`);
};
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { handleMessage } = await import('./handle-message.js');
const { setActivePersonas, setModules, setSettingList } = await import('../../core/config.js');
const { welcome } = await import('../welcome/welcome.js');
const { catchUp } = await import('./catch-up.js');

let clock = Date.parse('2026-10-26T12:00:00Z');
const nextId = () => SnowflakeUtil.generate({ timestamp: clock }).toString();
const tick = () => setSystemTime((clock += 10_000));

beforeEach(() => {
  requests.length = 0;
  route = null;
});

function world(name) {
  const client = { user: { id: 'bot' }, application: { id: 'app' }, channels: { fetch: async () => channel }, guilds: { cache: new Collection() } };
  const guild = { id: `g-${name}`, name, ownerId: null, members: { cache: new Collection() } };
  const store = [];
  const webhooks = new Collection();
  const users = {};
  const posted = [];

  const channel = {
    id: `c-${name}`,
    name,
    guild,
    client,
    isThread: () => false,
    isTextBased: () => true,
    get lastMessageId() {
      return store.at(-1)?.id ?? null;
    },
    sendTyping: async () => {},
    messages: {
      fetch: async (query) =>
        typeof query === 'string' ? store.find((m) => m.id === query) : new Collection(
          store
            .filter((m) => (!query.before || BigInt(m.id) < BigInt(query.before)) && (!query.after || BigInt(m.id) > BigInt(query.after)))
            .slice(-query.limit)
            .reverse()
            .map((m) => [m.id, m]),
        ),
    },
    fetchWebhooks: async () => webhooks,
    createWebhook: async ({ name: hookName }) => {
      const hook = { id: nextId(), name: hookName, owner: { id: 'bot' }, delete: async () => webhooks.delete(hook.id), send: async (payload) => post(payload) };
      webhooks.set(hook.id, hook);
      return hook;
    },
    send: async (payload) => post({ username: 'MAGI', content: payload.content, bot: true }),
  };

  function base(id, content) {
    return {
      id,
      content,
      channel,
      guild,
      client,
      createdTimestamp: Date.now(),
      attachments: new Collection(),
      stickers: new Collection(),
      inGuild: () => true,
      url: `https://discord.com/channels/${guild.id}/${channel.id}/${id}`,
    };
  }

  function post({ username, content, replyTo, bot }) {
    const message = {
      ...base(nextId(), content),
      author: { id: bot ? 'bot' : `wh-${username}`, bot: true, username },
      webhookId: bot ? null : 'webhook',
      applicationId: bot ? null : 'app',
      member: null,
      mentions: { users: new Collection(), repliedUser: null },
      reference: null,
    };
    store.push(message);
    posted.push({ persona: username.toLowerCase(), content, replyTo });
    return message;
  }

  function member(name) {
    if (!users[name]) {
      const id = nextId();
      users[name] = { id, bot: false, username: name, globalName: null, tag: name };
      guild.members.cache.set(id, { id, displayName: name, user: users[name], guild, roles: { cache: new Collection() } });
    }
    return users[name];
  }
  guild.ownerId = member('slou').id;
  guild.channels = { cache: new Collection([[channel.id, channel]]) };
  guild.systemChannel = channel;
  client.guilds.cache.set(guild.id, guild);

  async function join(name) {
    tick();
    const user = member(name);
    await welcome({ ...guild.members.cache.get(user.id), user, guild });
  }

  async function say(name, content, { replyTo, mentions = [], attachments = [], offline = false } = {}) {
    tick();
    const author = member(name);
    const message = {
      ...base(nextId(), content),
      author,
      member: guild.members.cache.get(author.id),
      webhookId: null,
      applicationId: null,
      mentions: { users: new Collection(mentions.map((m) => [member(m).id, member(m)])), repliedUser: replyTo?.author ?? null },
      attachments: new Collection(attachments.map((a, i) => [String(i), a])),
      embeds: [],
      reference: replyTo ? { messageId: replyTo.id } : null,
      fetchReference: async () => replyTo,
      reactions: [],
      react: async (emoji) => message.reactions.push(emoji),
    };
    store.push(message);
    if (offline) return message;
    const before = posted.length;
    await handleMessage(message);
    message.answers = posted.slice(before);
    return message;
  }

  return { say, join, posted, store, guild, channel, client };
}

const lastContext = (persona) => requests.filter((r) => r.persona === persona).at(-1)?.context ?? '';

test('deux conversations en parallèle ne se mélangent pas', async () => {
  const w = world('paralleles');
  await w.say('slou', "magi, on en est où de l'install ?");
  await w.say('faceless', 'casper, t’es nulle en répartie');
  await w.say('slou', 'melchior, et les rôles ?');
  await w.say('faceless', 'dommage Casper');

  const casper = lastContext('casper');
  expect(casper).toContain('dommage Casper');
  expect(casper).not.toContain('install');
  expect(casper).not.toContain('rôles');
  const melchior = lastContext('melchior');
  expect(melchior).toContain('install');
  expect(melchior).not.toContain('répartie');
  expect(melchior).not.toContain('dommage');
});

test('la persona répond en citant le message, et se reconnaît dans le contexte', async () => {
  const w = world('citation');
  const question = await w.say('lea', 'balthasar, je dors mal en ce moment');
  expect(question.answers).toHaveLength(1);
  expect(question.answers[0]).toMatchObject({ persona: 'balthasar' });
  expect(w.store.at(-1).content).toStartWith(`-# ↪ <@${question.author.id}>`);
  await w.say('lea', 'balthasar, tu as une astuce ?');
  expect(lastContext('balthasar')).toContain('Toi, Balthasar (à lea) : Réponse');
});

test('suite sans le nom : seulement pour la personne à qui la persona vient de répondre', async () => {
  const w = world('suite');
  await w.say('slou', 'melchior, combien font 2 + 2 ?');
  const suite = await w.say('slou', 'et 3 + 3 ?');
  expect(suite.answers.map((a) => a.persona)).toEqual(['melchior']);
  const intrus = await w.say('faceless', 'et 4 + 4 ?');
  expect(intrus.answers).toHaveLength(0);
});

test('« c’est pas à toi que je parlais » : pas de réponse, un 👌, et la suite s’arrête', async () => {
  const w = world('pas-a-toi');
  await w.say('slou', 'melchior, combien font 2 + 2 ?');
  const erreur = await w.say('slou', "c'est pas à toi que je parlais");
  expect(erreur.answers).toHaveLength(0);
  expect(erreur.reactions).toEqual(['👌']);
  const apres = await w.say('slou', 'et 3 + 3 ?');
  expect(apres.answers).toHaveLength(0);
  const rappel = await w.say('slou', 'melchior, et 3 + 3 ?');
  expect(rappel.answers.map((x) => x.persona)).toEqual(['melchior']);
});

test('« ça ira » ou « repos » après une réponse : une réaction, pas de relance', async () => {
  const w = world('fin');
  await w.say('slou', 'casper ?');
  const fin = await w.say('slou', 'ça ira.');
  expect(fin.answers).toHaveLength(0);
  expect(fin.reactions).toEqual(['👌']);
  await w.say('slou', 'casper, ça va ?');
  const conge = await w.say('slou', 'repos, soldat.');
  expect(conge.answers).toHaveLength(0);
  expect(conge.reactions).toEqual(['🫡']);
});

test('fin de conversation : l’unité qui parlait réagit avec son emote', async () => {
  const w = world('emote');
  await w.say('slou', 'casper, ça va ?');
  const { loadEmotes } = await import('../../core/discord/emotes.js');
  const load = (names) => loadEmotes({ application: { emojis: { fetch: async () => new Map(names.map((name) => [name, { id: name, name }])) } } });
  await load(['casper_pouce', 'melchior_lunettes']);
  const fin = await w.say('slou', 'ça ira.');
  await load([]);
  expect(fin.answers).toHaveLength(0);
  expect(fin.reactions.map((r) => r.name)).toEqual(['casper_pouce']);
});

test('chacun garde sa suite sans le nom dans le même salon', async () => {
  const w = world('suites');
  await w.say('slou', 'melchior, explique les vecteurs');
  await w.say('lea', 'casper, pizza ou sushi ?');
  const deSlou = await w.say('slou', 'et en dimension 3 ?');
  const deLea = await w.say('lea', 'sérieux ? pourquoi ?');
  expect(deSlou.answers.map((a) => a.persona)).toEqual(['melchior']);
  expect(deLea.answers.map((a) => a.persona)).toEqual(['casper']);
  expect(lastContext('casper')).not.toContain('vecteurs');
});

test('répondre au message de quelqu’un fait rejoindre sa conversation, sans que MAGI réponde', async () => {
  const w = world('rejoindre');
  const question = await w.say('slou', 'melchior, on code le bot en JS ou en Python ?');
  const remarque = await w.say('lea', 'Python, clairement', { replyTo: question });
  expect(remarque.answers).toHaveLength(0);
  await w.say('lea', 'melchior, tu confirmes ?');
  const context = lastContext('melchior');
  expect(context).toContain('on code le bot en JS ou en Python');
  expect(context).toContain('lea (en réponse à slou) : Python, clairement');
});

test('mentionner un participant fait aussi rejoindre sa conversation', async () => {
  const w = world('mention');
  await w.say('slou', 'casper, quel film ce soir ?');
  await w.say('lea', '@slou prends un Miyazaki', { mentions: ['slou'] });
  await w.say('slou', 'casper, Miyazaki alors ?');
  expect(lastContext('casper')).toContain('lea : @slou prends un Miyazaki');
});

test('une autre persona appelée dans la conversation voit l’échange précédent', async () => {
  const w = world('relais');
  await w.say('slou', 'melchior, le café ça déshydrate ?');
  await w.say('slou', 'balthasar, du coup j’en bois combien ?');
  expect(lastContext('balthasar')).toContain('Melchior (MAGI, à slou) : Réponse');
});

test('un message ancien cité hors conversation est joint au contexte', async () => {
  const w = world('ancien');
  const ancien = await w.say('lea', 'je pars au Japon en avril');
  await w.say('slou', 'casper, tu en penses quoi ?', { replyTo: ancien });
  expect(lastContext('casper')).toContain('lea (message cité) : je pars au Japon en avril');
});

test('réponse à une ancienne réplique de MAGI : toute la chaîne citée est jointe', async () => {
  const w = world('chaine');
  await w.say('slou', 'balthasar, je te teste');
  setSystemTime((clock += 11 * 60_000));
  await w.say('slou', 'et casper, elle en pense quoi ?', { replyTo: w.store.at(-1) });
  const context = lastContext('casper');
  expect(context).toContain('slou (message cité, propriétaire du serveur) : balthasar, je te teste');
  expect(context).toContain('Balthasar (MAGI, message cité, à slou) : ');
  expect(context.indexOf('je te teste')).toBeLessThan(context.indexOf('Balthasar (MAGI'));
});

test('demande de résumé : le salon est relu par le code avant la réponse', async () => {
  const w = world('resume');
  await w.say('lea', 'on se fait une soirée jeux vendredi ?');
  await w.say('faceless', 'grave, je ramène la switch');
  await w.say('slou', 'magi, fais-moi un résumé de ce qui s’est dit');
  const context = requests.at(-1).context;
  expect(context).toStartWith('Derniers messages du salon, datés');
  expect(context).toMatch(/\[\w+\.? \d{2}\/\d{2} \d{2}:\d{2}\] lea : on se fait une soirée jeux vendredi \?/);
  expect(context).toContain('] faceless : grave, je ramène la switch');
});

test('débat : deux tours entre les unités, puis vote si demandé', async () => {
  const w = world('debat');
  const msg = await w.say('slou', 'magi, débattez : pizza ou sushi ?');
  expect(msg.answers.map((a) => a.persona)).toEqual(['melchior', 'balthasar', 'casper', 'melchior', 'balthasar', 'casper']);
  expect(lastContext('casper')).toContain('Ce que les autres unités ont dit');
  const voted = await w.say('slou', 'magi, débattez puis votez : on passe le serveur en anglais ?');
  expect(voted.answers.at(-1).content).toContain('MAGI · ');
});

test('le propriétaire du serveur est signalé', async () => {
  const w = world('roles');
  await w.say('slou', 'melchior, statut ?');
  expect(lastContext('melchior')).toContain('slou (propriétaire du serveur) : melchior, statut ?');
});

test('les gifs sont signalés avec leur auteur', async () => {
  const w = world('gif');
  await w.say('slou', 'casper, regarde https://tenor.com/view/chat-qui-danse-123');
  expect(lastContext('casper')).toContain('slou (propriétaire du serveur) : casper, regarde [gif]');
});

test('vote entre deux personas nommées', async () => {
  const w = world('vote');
  await w.say('slou', 'balthasar et melchior, votez : on commande des pizzas ?');
  expect(w.posted.filter((p) => p.persona !== 'magi').map((p) => p.persona)).toEqual(['balthasar', 'melchior']);
  expect(w.posted.at(-1).content).toBe("**MAGI · Résolution adoptée à l'unanimité.**");
});

test('salon muet : aucune réponse', async () => {
  const w = world('muet');
  setSettingList(w.guild.id, 'muted_channels', [w.channel.id]);
  const message = await w.say('slou', 'melchior, tu es là ?');
  expect(message.answers).toHaveLength(0);
});

test('persona désactivée : une autre répond à sa place', async () => {
  const w = world('desactivee');
  setActivePersonas(w.guild.id, ['melchior', 'balthasar']);
  const message = await w.say('slou', 'casper, une blague ?');
  expect(message.answers).toHaveLength(1);
  expect(message.answers[0].persona).not.toBe('casper');
});

test('réaction rapide sans appel au LLM', async () => {
  const w = world('reaction');
  await w.say('slou', 'melchior, merci pour le coup de main');
  const merci = await w.say('slou', 'merci melchior');
  expect(merci.reactions.length + merci.answers.length).toBeGreaterThan(0);
});

test('conversation à trois : chacun est nommé, la persona répond au bon interlocuteur', async () => {
  const w = world('trio');
  const question = await w.say('slou', 'casper, on se fait un jeu ce soir ?');
  await w.say('lea', 'moi je suis chaude', { replyTo: question });
  await w.say('faceless', '@lea pareil', { mentions: ['lea'] });
  await w.say('faceless', 'casper, tu proposes quoi ?');
  const context = lastContext('casper');
  expect(context).toContain('slou (propriétaire du serveur) : casper, on se fait un jeu ce soir ?');
  expect(context).toContain('lea (en réponse à slou) : moi je suis chaude');
  expect(context).toContain('faceless : @lea pareil');
  expect(context).toContain('Tu réponds maintenant à faceless');
});

test('changer de persona et de sujet ouvre une nouvelle conversation', async () => {
  const w = world('ambigu');
  await w.say('slou', 'melchior, parle-moi des trous noirs');
  route = 'nouveau';
  await w.say('slou', 'casper, ton plat préféré ?');
  route = null;
  await w.say('slou', 'casper, et en dessert ?');
  expect(lastContext('casper')).not.toContain('trous noirs');
  await w.say('slou', 'melchior, et leur température ?');
  expect(lastContext('melchior')).toContain('trous noirs');
  expect(lastContext('melchior')).not.toContain('dessert');
});

test("après l'accueil, le nouveau membre répond sans nommer personne et la persona qui l'a accueilli enchaîne", async () => {
  const w = world('accueil');
  setModules(w.guild.id, ['bienvenue', 'memoire', 'vote']);
  await w.join('nesskuik');
  expect(w.posted.at(-1).persona).toBe('balthasar');
  const reponse = await w.say('nesskuik', "salut, j'arrive pour parler de dev");
  expect(reponse.answers.map((a) => a.persona)).toEqual(['balthasar']);
  expect(lastContext('balthasar')).toContain("nesskuik : salut, j'arrive pour parler de dev");
});

test('les gifs postés sont joints au modèle, numérotés dans la conversation', async () => {
  const w = world('media');
  await w.say('lea', 'regardez ça', { attachments: [{ url: 'https://cdn.test/chat.gif', contentType: 'image/gif', size: 6 }] });
  await w.say('lea', 'casper, il est pas mignon ?');
  const request = requests.filter((r) => r.persona === 'casper').at(-1);
  expect(request.context).toContain('lea : regardez ça [gif] [pièce jointe n°1]');
  expect(request.media).toEqual(['data:image/gif;base64,R0lGODlh']);
});

test('au redémarrage, les messages restés sans réponse sont rattrapés, pas les autres', async () => {
  const w = world('rattrapage');
  await w.say('slou', 'melchior, déjà répondu ?');
  await w.say('lea', 'casper, tu es là ?', { offline: true });
  await w.say('lea', 'il dort ou quoi', { offline: true });
  const before = w.posted.length;
  await catchUp(w.client, Date.now());
  expect(w.posted.slice(before).map((p) => p.persona)).toEqual(['casper']);
  expect(lastContext('casper')).toContain('casper, tu es là ?');
});

test('vote : une unité désactivée ne vote pas', async () => {
  const w = world('vote-actives');
  setActivePersonas(w.guild.id, ['casper', 'melchior']);
  await w.say('slou', 'magi, vote : on commande des pizzas ?');
  expect(w.posted.filter((p) => p.persona !== 'magi').map((p) => p.persona)).toEqual(['casper', 'melchior']);
});
