import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { ChannelType, Collection } from 'discord.js';

const { crossed, rateOf } = await import('./synchro.js');
const { celebrate, datesToCelebrate, parisDay } = await import('./birthdays.js');
const { handleVoiceState, isTemporary } = await import('./voice.js');
const { COMMUNITY_TOOLS } = await import('./tools.js');
const { setBirthday } = await import('./store.js');
const { setModules, MODULES } = await import('../../core/config.js');
const { setSetting } = await import('../../core/settings.js');

const tool = (name) => COMMUNITY_TOOLS.find((t) => t.name === name);

test('taux de synchronisation : progression et paliers franchis', () => {
  assert.deepEqual([rateOf(0), rateOf(100), rateOf(625), rateOf(20_000)], [0, 40, 100, 400]);
  assert.deepEqual(crossed(48, 52), [50]);
  assert.deepEqual(crossed(70, 160), [75, 100, 150]);
  assert.deepEqual(crossed(51, 60), []);
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
