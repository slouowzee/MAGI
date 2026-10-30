import { test } from 'bun:test';
import assert from 'node:assert/strict';

const { examplesNote, learn, learnedExamples, pickExamples, registerOf, rememberReply, REGISTERS, SEEDS, staleness, unlearn } = await import('./examples.js');

test('type de message reconnu, bavardage par défaut', () => {
  const cases = {
    "je me sens vraiment pas bien ce soir": 'confidence',
    'Casper t’es nulle': 'chambrage',
    "j'ai eu mon permis !": 'nouvelle',
    'pizza ananas, oui ou non ?': 'debat',
    'pourquoi le ciel est bleu ?': 'question',
    'je fais des crêpes ce soir': 'bavardage',
  };
  for (const [text, register] of Object.entries(cases)) assert.equal(registerOf(text), register, text);
});

test('banque : exemples de la bonne unité, du même type d’abord, appris en priorité, jamais plus de 5', () => {
  for (const persona of ['melchior', 'balthasar', 'casper']) for (const register of Object.keys(REGISTERS)) assert.ok(SEEDS.some((e) => e.persona === persona && e.register === register), `${persona} ${register}`);
  const random = () => 0.5;
  const shown = pickExamples('g-banque', 'casper', 'debat', random);
  assert.equal(shown.length, 5);
  assert.ok(shown.every((e) => e.persona === 'casper'));
  assert.ok(shown.slice(0, 2).every((e) => e.register === 'debat'));
  assert.equal(learn('g-banque', { persona: 'casper', input: 'Slou : tu préfères le thé ou le café ?', output: 'Café, et serré. Le thé, c’est de l’eau chaude qui a des ambitions.', by: 'owner' }), true);
  assert.equal(learn('g-banque', { persona: 'casper', input: 'x', output: 'Café, et serré. Le thé, c’est de l’eau chaude qui a des ambitions.', by: 'owner' }), false);
  assert.equal(pickExamples('g-banque', 'casper', 'debat', random)[0].output, 'Café, et serré. Le thé, c’est de l’eau chaude qui a des ambitions.');
  assert.equal(learnedExamples('g-banque')[0].register, 'debat');
  assert.match(examplesNote('g-banque', 'casper', 'debat', random), /^Ce message : Question de goût[\s\S]*« Slou : tu préfères le thé ou le café \? » → « Café, et serré/);
  assert.equal(unlearn('g-banque', 'Café, et serré. Le thé, c’est de l’eau chaude qui a des ambitions.'), true);
  assert.equal(learnedExamples('g-banque').length, 0);
});

test('réponse usée : formule toute faite ou même début qu’une réponse récente', () => {
  assert.match(staleness('g-use', 'melchior', 'Hypothèse notée. Rien ne le prouve.'), /formule usée/);
  rememberReply('g-use', 'casper', 'Franchement ton bot a intérêt à faire le café.');
  assert.match(staleness('g-use', 'casper', 'Franchement ton bot, il est où ?'), /commence comme/);
  assert.equal(staleness('g-use', 'casper', 'Bravo, trois semaines bien investies.'), null);
  assert.equal(staleness('g-use', 'melchior', 'Franchement ton bot a intérêt à faire le café.'), null);
});

test('réaction d’un opérateur : ajoute la réponse et son message d’origine, retire avec l’autre emoji, ignore les autres', async () => {
  const { handleExampleReaction } = await import('./feedback.js');
  const { learnedExamples } = await import('./examples.js');
  const { PERSONAS } = await import('../../core/personas.js');
  const source = { content: 'tu préfères la plage ou la montagne ?', member: { displayName: 'Slou' }, author: { username: 'slou' } };
  const channel = { id: '111111111111111111', messages: { fetch: async () => source } };
  const members = { owner: { id: 'owner', guild: null }, lea: { id: 'lea', guild: null, roles: { cache: new Map() } } };
  const guild = { id: 'g-retour', ownerId: 'owner', channels: { cache: new Map([[channel.id, channel]]) }, members: { fetch: async (id) => members[id] } };
  for (const m of Object.values(members)) m.guild = guild;
  const reply = { guild, guildId: guild.id, webhookId: 'w', applicationId: 'app', client: { application: { id: 'app' } }, author: { username: PERSONAS.casper.name }, content: `-# ↪ <@1> [tu préfères la plage…](https://discord.com/channels/333333333333333333/${channel.id}/222222222222222222)\nMontagne, et sans hésiter.` };
  const react = (name, userId) => handleExampleReaction({ emoji: { name, id: null }, message: reply }, { id: userId, bot: false });
  assert.equal(await react('👍', 'lea'), null);
  assert.equal(await react('🔥', 'owner'), null);
  assert.equal(await react('👍', 'owner'), 'ajoutee');
  const [saved] = learnedExamples('g-retour');
  assert.deepEqual([saved.persona, saved.register, saved.input, saved.output], ['casper', 'debat', 'Slou : tu préfères la plage ou la montagne ?', 'Montagne, et sans hésiter.']);
  assert.equal(await react('👎', 'owner'), 'retiree');
  assert.equal(learnedExamples('g-retour').length, 0);
});

test('ton du serveur : message d’un membre ajouté par un opérateur, montré sans auteur, effacé par /oublier', async () => {
  const { handleExampleReaction } = await import('./feedback.js');
  const { forgetToneOf, toneCountOf, toneNote, toneSamples } = await import('./examples.js');
  const members = { owner: { id: 'owner' } };
  const guild = { id: 'g-ton', ownerId: 'owner', channels: { cache: new Map() }, members: { fetch: async (id) => members[id] } };
  members.owner.guild = guild;
  const said = { guild, guildId: guild.id, webhookId: null, author: { id: 'lea', bot: false, username: 'lea' }, member: { displayName: 'Léa' }, content: 'wsh la team, ce soir on lance une partie ou bien ?' };
  assert.equal(await handleExampleReaction({ emoji: { name: '👍', id: null }, message: said }, { id: 'owner', bot: false }), 'ton');
  assert.deepEqual(toneSamples('g-ton').map((e) => [e.authorId, e.author, e.output]), [['lea', 'Léa', 'wsh la team, ce soir on lance une partie ou bien ?']]);
  assert.match(toneNote('g-ton'), /« wsh la team, ce soir on lance une partie ou bien \? »/);
  assert.ok(!toneNote('g-ton').includes('Léa'));
  assert.equal(await handleExampleReaction({ emoji: { name: '👍', id: null }, message: { ...said, author: { id: 'bot', bot: true } } }, { id: 'owner', bot: false }), null);
  assert.equal(toneCountOf('g-ton', 'lea'), 1);
  assert.equal(forgetToneOf('g-ton', 'lea'), 1);
  assert.equal(toneNote('g-ton'), '');
});
