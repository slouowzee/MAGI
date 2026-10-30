import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { ChannelType, Collection } from 'discord.js';

const { crossed, rateOf, sweepNotices, trackActivity } = await import('./synchro.js');
const { celebrate, datesToCelebrate, parisDay } = await import('./birthdays.js');
const { handleVoiceState, isTemporary } = await import('./voice.js');
const { COMMUNITY_TOOLS } = await import('./tools.js');
const { saveSynchro, setBirthday, synchroOf } = await import('./store.js');
const { setModules, MODULES } = await import('../../core/config.js');
const { listSettings, setSetting } = await import('../../core/settings.js');

const tool = (name) => COMMUNITY_TOOLS.find((t) => t.name === name);

test('taux de synchronisation : progression et paliers franchis', () => {
  assert.deepEqual([rateOf(0), rateOf(100), rateOf(625), rateOf(20_000)], [0, 40, 100, 400]);
  assert.deepEqual(crossed(48, 52), [50]);
  assert.deepEqual(crossed(70, 160), [75, 100, 150]);
  assert.deepEqual(crossed(51, 60), []);
});

test('palier franchi : réaction et annonce en réponse au message, sans mention', async () => {
  const sent = [];
  const reactions = [];
  const deleted = [];
  const guild = { id: 'g-synchro', channels: { cache: new Collection() }, roles: { cache: new Collection() } };
  const channel = {
    id: 'salon',
    guild,
    isThread: () => false,
    client: { user: { id: 'magi' } },
    fetchWebhooks: async () => new Collection(),
    createWebhook: async ({ name }) => ({ name, owner: { id: 'magi' }, send: async (p) => (sent.push(p), { id: 'n1', channelId: 'salon' }) }),
    messages: { delete: async (id) => deleted.push(id) },
  };
  guild.channels.cache.set('salon', channel);
  setModules(guild.id, [...Object.keys(MODULES)]);
  saveSynchro(guild.id, 'u1', 39, 0);
  const message = { guild, channel, id: 'm1', url: 'https://discord.com/channels/g/salon/m1', content: 'salut', createdTimestamp: 120_000, author: { id: 'u1', bot: false }, member: { id: 'u1', user: { tag: 'u1' }, roles: { cache: new Collection() } }, react: async (e) => reactions.push(e) };
  assert.equal(await trackActivity(message), 25);
  assert.equal(synchroOf(guild.id, 'u1').points, 40);
  assert.deepEqual(reactions, ['📈']);
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /^-# ↪ <@u1> \[salut\]\(.+\)\nTaux de synchronisation : 25 %\.$/);
  assert.deepEqual(sent[0].allowedMentions.users, []);
  assert.equal(await trackActivity({ ...message, createdTimestamp: 130_000 }), null);
  assert.deepEqual(listSettings(guild.id, 'synchro_notice:').map((r) => [r.key, r.value]), [['synchro_notice:salon:n1', '150000']]);
  sweepNotices({ guilds: { cache: new Collection([[guild.id, guild]]) } });
  await Bun.sleep(5);
  assert.deepEqual(deleted, ['n1']);
  assert.deepEqual(listSettings(guild.id, 'synchro_notice:'), []);
});

test('classement : synchro par pages de 10, boutons aux bords désactivés', async () => {
  const { handleLeaderboardInteraction, leaderboard } = await import('./leaderboard.js');
  const guild = { id: 'g-classement', name: 'Test' };
  setModules(guild.id, [...Object.keys(MODULES)]);
  for (let i = 1; i <= 23; i++) saveSynchro(guild.id, `u${i}`, i * 10, 0);
  saveSynchro(guild.id, 'zero', 0, 0);
  const first = leaderboard(guild).toJSON();
  const shown = JSON.stringify(first);
  assert.match(shown, /1\. <@u23> · 60 %[^"]*10\. <@u14> · 47 %"/);
  assert.match(shown, /Page 1\/3/);
  assert.match(shown, /### Taux de synchronisation/);
  assert.ok(!/Hall of Fame|semaine|zero|Test/.test(shown));
  const buttons = first.components.at(-1).components;
  assert.deepEqual(buttons.map((b) => [b.custom_id, Boolean(b.disabled)]), [['magi-rank:page:-1', true], ['magi-rank:page:1', false]]);
  const updates = [];
  await handleLeaderboardInteraction({ customId: 'magi-rank:page:2', guild, update: async (p) => updates.push(p) });
  const last = JSON.stringify(updates[0].components[0].toJSON());
  assert.match(last, /21\. <@u3> · 21 %[^"]*23\. <@u1> · 12 %"/);
  assert.match(last, /Page 3\/3/);
  assert.match(JSON.stringify(leaderboard(guild, 99).toJSON()), /Page 3\/3/);
  setModules(guild.id, []);
  assert.match(JSON.stringify(leaderboard(guild).toJSON()), /coupée/);
});

test('Hall of Fame : carte enrichie avec auteur, contexte, galerie de 4 médias et bouton vers le message', async () => {
  const { starCard } = await import('./hall-of-fame.js');
  const image = (n) => [`a${n}`, { url: `https://cdn/x${n}.png`, contentType: 'image/png' }];
  const message = {
    content: 'La réaction ?',
    url: 'https://discord.com/channels/g/c/m',
    createdTimestamp: 1_793_000_000_000,
    channel: { id: 'c' },
    author: { username: 'mf', displayAvatarURL: () => 'https://cdn/mf.png' },
    member: { displayName: 'Miss Fortune', displayAvatarURL: () => 'https://cdn/mf.png' },
    attachments: new Collection([image(1), image(2), image(3), image(4), image(5)]),
    embeds: [],
  };
  const parent = { content: 't’as vu sa tête quand il a perdu ?', author: { username: 'yui' }, member: { displayName: 'Yui' }, attachments: new Collection(), embeds: [] };
  const card = starCard(message, { count: 12, emoji: '🔥', parent }).toJSON();
  const shown = JSON.stringify(card);
  assert.equal(card.accent_color, 0xd85a30);
  assert.equal(card.components[0].components.length, 1);
  assert.match(card.components[0].components[0].content, /^### 🔥 12 · Miss Fortune\n-# <#c> · <t:1793000000:f>\n-# ↪ Yui : t’as vu sa tête quand il a perdu \?\nLa réaction \?$/);
  assert.equal(card.components.find((c) => c.type === 12).items.length, 4);
  const link = card.components.at(-1).components[0];
  assert.deepEqual([link.style, link.url, link.label], [5, message.url, 'Aller au message']);
  const { heat } = await import('./hall-of-fame.js');
  assert.deepEqual([1, 5, 10, 15, 30].map(heat), [0xfac775, 0xef9f27, 0xd85a30, 0xe24b4a, 0xa32d2d]);
});

test('Hall of Fame : la carte suit les réactions, le commentaire de Casper ne bouge pas', async () => {
  const { refreshCard } = await import('./hall-of-fame.js');
  const { PERSONAS } = await import('../../core/personas.js');
  const edits = [];
  const guild = { id: 'g-hof', channels: { cache: new Collection() } };
  const posted = { id: 'p1', webhookId: 'w', applicationId: 'app', client: { application: { id: 'app' } }, author: { username: PERSONAS.casper.name }, components: [{ type: 10, content: 'Un feu pour une phrase pareille.' }] };
  const wall = {
    id: 'mur',
    isThread: () => false,
    client: { user: { id: 'magi' } },
    messages: { fetch: async (id) => (id === 'p1' ? posted : null) },
    fetchWebhooks: async () => new Collection(),
    createWebhook: async ({ name }) => ({ name, owner: { id: 'magi' }, editMessage: async (id, p) => edits.push([id, p]) }),
  };
  guild.channels.cache.set('mur', wall);
  setSetting(guild.id, 'stars_channel', 'mur');
  const message = {
    content: 'Sur ce message',
    url: 'https://discord.com/channels/g/c/m',
    createdTimestamp: 1_793_000_000_000,
    channel: { id: 'c' },
    author: { username: 'slou', displayAvatarURL: () => 'https://cdn/s.png' },
    member: { displayName: 'Slou', displayAvatarURL: () => 'https://cdn/s.png' },
    attachments: new Collection(),
    embeds: [],
    reactions: { cache: new Collection([['🔥', { emoji: { name: '🔥', id: null }, count: 11 }]]) },
  };
  message.fetch = async () => message;
  assert.equal(await refreshCard(guild, message, 'p1'), true);
  const [id, payload] = edits[0];
  assert.equal(id, 'p1');
  assert.equal(payload.components[0].toJSON().content, 'Un feu pour une phrase pareille.');
  const card = payload.components[1].toJSON();
  assert.equal(card.accent_color, 0xd85a30);
  assert.match(card.components[0].components[0].content, /^### 🔥 11 · Slou/);
  assert.equal(await refreshCard(guild, message, 'inconnu'), false);
});

test('paliers : points restants, message perso avec {membre} et {taux}, rôle vérifié', async () => {
  const { milestoneLine, nextMilestone, pointsFor, setMilestone, paliers } = await import('./synchro.js');
  assert.deepEqual([25, 50, 100, 400].map(pointsFor), [40, 157, 625, 10000]);
  assert.deepEqual([0, 25, 399, 400].map(nextMilestone), [25, 50, 400, null]);
  const ok = { id: 'r-ok', name: 'Pilote', editable: true, permissions: { has: () => false } };
  const admin = { id: 'r-admin', name: 'Admin', editable: true, permissions: { has: () => true } };
  const guild = { id: 'g-palier', roles: { cache: new Collection([['r-ok', ok], ['r-admin', admin]]) } };
  assert.equal(milestoneLine(guild.id, 50, 'u1'), 'Taux de synchronisation : 50 %.');
  setMilestone(guild, 50, { message: 'Bienvenue chez les pilotes, {membre} : {taux} atteint.', roleId: 'r-ok' });
  assert.equal(paliers(guild.id)[50], 'r-ok');
  assert.equal(milestoneLine(guild.id, 50, 'u1', [ok]), 'Bienvenue chez les pilotes, <@u1> : 50 % atteint.\n-# Rôle Pilote accordé.');
  assert.throws(() => setMilestone(guild, 50, { roleId: 'r-admin' }), /permissions de gestion/);
  assert.throws(() => setMilestone(guild, 60, {}), /palier inconnu/);
  setMilestone(guild, 50, {});
  assert.equal(paliers(guild.id)[50], undefined);
  assert.equal(milestoneLine(guild.id, 50, 'u1'), 'Taux de synchronisation : 50 %.');
});

test('rôles de palier rangés automatiquement, le plus haut palier en haut', async () => {
  const { orderMilestoneRoles } = await import('./synchro.js');
  const calls = [];
  const names = { r25: 8, r50: 7, r100: 6, r400: 5 };
  const roles = new Collection(Object.entries(names).map(([id, position]) => [id, { id, name: id, position, managed: false }]));
  const guild = { id: 'g-rang', roles: { cache: roles, setPositions: async (list) => calls.push(list) }, members: { me: { roles: { highest: { position: 16 } } } } };
  setSetting(guild.id, 'synchro_roles', JSON.stringify({ 25: 'r25', 50: 'r50', 100: 'r100', 400: 'r400' }));
  assert.equal(await orderMilestoneRoles(guild), true);
  assert.deepEqual(calls[0], [{ role: 'r400', position: 8 }, { role: 'r100', position: 7 }, { role: 'r50', position: 6 }, { role: 'r25', position: 5 }]);
  for (const { role, position } of calls[0]) roles.get(role).position = position;
  assert.equal(await orderMilestoneRoles(guild), false);
});

test("anniversaires : une fois par jour, à partir de 9 h à Paris", async () => {
  const sent = [];
  const channel = { id: 'c', isThread: () => false, send: async (p) => sent.push(p) };
  const guild = { id: 'g-anniv', systemChannel: channel, channels: { cache: new Map() }, members: { fetch: async (id) => ({ id, displayName: 'Léa', user: { tag: 'lea' } }) } };
  setModules(guild.id, [...Object.keys(MODULES)]);
  setBirthday(guild.id, 'lea', 10, 27);
  assert.equal(parisDay(Date.parse('2026-10-27T06:30:00Z')).hour, 7);
  assert.equal(await celebrate(guild, Date.parse('2026-10-27T06:30:00Z')), 0);
  const webhooks = await import('../../core/discord/webhooks.js');
  assert.ok(webhooks.speak);
  assert.deepEqual(datesToCelebrate({ year: 2027, month: 2, day: 28 }), [[2, 28], [2, 29]]);
  assert.deepEqual(datesToCelebrate({ year: 2028, month: 2, day: 28 }), [[2, 28]]);
});

test('salons vocaux temporaires : créé en rejoignant le générateur, supprimé vide', async () => {
  const created = [];
  const moved = [];
  const deleted = [];
  const hub = { id: 'hub', parentId: 'cat', permissionOverwrites: { cache: new Map() } };
  const guild = {
    id: 'g-vocal',
    channels: {
      cache: new Collection([['hub', hub]]),
      create: async (opts) => {
        const c = { id: `temp${created.length}`, ...opts, guild, members: new Collection(), delete: async () => deleted.push(c.id) };
        created.push(c);
        return c;
      },
    },
  };
  setModules(guild.id, [...Object.keys(MODULES)]);
  setSetting(guild.id, 'voice_hub', 'hub');
  const member = { id: 'm1', displayName: 'Slou', user: { tag: 'slou' }, voice: { setChannel: async (c) => moved.push(c.id) } };
  await handleVoiceState({ guild, channelId: null, channel: null }, { guild, channelId: 'hub', channel: hub, member });
  assert.equal(created[0].name, '🔊・Slou');
  assert.equal(created[0].type, ChannelType.GuildVoice);
  assert.equal(created[0].parent, 'cat');
  assert.deepEqual(moved, ['temp0']);
  assert.equal(isTemporary(guild, 'temp0'), true);
  await handleVoiceState({ guild, channelId: 'temp0', channel: created[0] }, { guild, channelId: null, channel: null, member });
  assert.deepEqual(deleted, ['temp0']);
  assert.equal(isTemporary(guild, 'temp0'), false);
});

test('sondage : réponses dédoublonnées, au moins deux', async () => {
  const sent = [];
  const message = { channel: { send: async (p) => (sent.push(p), { url: 'https://discord.com/x' }) } };
  assert.equal(await tool('sondage').run({ message, args: { question: 'Pizza ?', choix: ['Oui', 'Non', 'Oui'], duree_heures: 999 } }), 'Sondage publié : https://discord.com/x');
  assert.deepEqual(sent[0].poll.answers, [{ text: 'Oui' }, { text: 'Non' }]);
  assert.equal(sent[0].poll.duration, 168);
  await assert.rejects(tool('sondage').run({ message, args: { question: 'x', choix: ['seul'] } }), /deux réponses/);
});

test('événement et anniversaire : validations', async () => {
  const guild = { id: 'g-evt', channels: { cache: new Collection() } };
  const member = { id: 'm', displayName: 'Slou', permissions: { has: () => false }, guild: { ownerId: 'o', id: 'g-evt', roles: { cache: new Map() } }, roles: { cache: new Map() } };
  assert.throws(() => tool('evenement').confirm({ guild, member, args: { titre: 'Soirée', debut: '2099-01-01T21:00:00+01:00' } }), /Créer des événements/);
  member.permissions.has = () => true;
  assert.match(tool('evenement').confirm({ guild, member, args: { titre: 'Soirée jeux', debut: '2099-01-01T21:00:00+01:00' } }), /^Créer « Soirée jeux » le jeudi 1 janvier/);
  assert.throws(() => tool('evenement').confirm({ guild, member, args: { titre: 'x', debut: 'vendredi soir' } }), /date de début invalide/);
  await assert.rejects(tool('anniversaire').run({ guild, member, args: { jour: 31, mois: 2 } }), /date invalide/);
  assert.equal(await tool('anniversaire').run({ guild, member, args: { jour: 29, mois: 2 } }), 'Anniversaire de Slou enregistré : 29/2.');
});

test('Hall of Fame : emoji réglable, emoji du serveur reconnu par son identifiant', async () => {
  const { parseEmoji, sameEmoji, wallEmoji } = await import('./hall-of-fame.js');
  assert.equal(wallEmoji('g-emoji'), '🔥');
  setSetting('g-emoji', 'stars_emoji', '❤️');
  assert.ok(sameEmoji({ name: '❤', id: null }, wallEmoji('g-emoji')));
  assert.ok(!sameEmoji({ name: '🔥', id: null }, wallEmoji('g-emoji')));
  assert.ok(sameEmoji({ name: 'pog', id: '123456789012345678' }, '<:pog:123456789012345678>'));
  assert.ok(!sameEmoji({ name: 'pog', id: '999999999999999999' }, '<:pog:123456789012345678>'));
  assert.equal(parseEmoji(' 🏆 '), '🏆');
  assert.equal(parseEmoji('<a:dance:123456789012345678>'), '<a:dance:123456789012345678>');
  assert.equal(parseEmoji('trophée'), null);
});
