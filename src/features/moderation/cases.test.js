import { test } from 'bun:test';
import assert from 'node:assert/strict';

const { moderate } = await import('./index.js');
const { caseCard, history } = await import('./cases.js');
const { getCase, setModerationMode } = await import('./store.js');
const { setSetting } = await import('../../core/settings.js');

function world(id) {
  const cards = [];
  const timeouts = [];
  let deleted = 0;
  const modlog = { id: `${id}-mod`, name: 'magi-moderation', send: async (payload) => (cards.push(payload), { id: `card-${cards.length}` }), messages: { fetch: async () => null } };
  const guild = { id, ownerId: 'owner', channels: { cache: new Map([[modlog.id, modlog]]) }, roles: { cache: new Map() }, client: { users: { fetch: async () => null } } };
  const member = { id: 'yui', displayName: 'Yui', user: { bot: false, tag: 'yui', createdTimestamp: Date.now() - 3_600_000 }, guild, joinedTimestamp: Date.now() - 300_000, permissions: { has: () => false }, roles: { highest: { position: 0 } }, timeout: async (ms) => timeouts.push(ms) };
  guild.members = { me: { roles: { highest: { position: 10 } } }, cache: new Map([['yui', member]]), fetch: async () => member };
  setSetting(id, 'log_channel:moderation', modlog.id);
  setModerationMode(id, 'active');
  const message = (content) => ({ inGuild: () => true, author: { id: 'yui', bot: false, createdTimestamp: member.user.createdTimestamp }, webhookId: null, guild, member, channel: { id: 'general', name: 'general' }, content, mentions: { users: { size: 0 }, roles: { size: 0 } }, delete: async () => deleted++ });
  return { cards, timeouts, message, deleted: () => deleted };
}

test('une rafale du même membre donne un seul cas, une seule infraction, une seule sanction', async () => {
  const w = world('g-rafale');
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => moderate(w.message(`free https://dlscord.com/nitro${i}`))));
  assert.deepEqual(results, [true, true, true, true, true]);
  assert.equal(w.cards.length, 1);
  assert.equal(w.timeouts.length, 1);
  assert.equal(w.deleted(), 5);
  const c = getCase(1) ?? null;
  assert.ok(c);
  assert.equal(c.deleted, 5);
  assert.equal(c.infraction, 1);
});

test('carte de cas : couleur et boutons selon l’état, identifiants uniques', () => {
  const base = { id: 7, userId: 'yui', kind: 'spam', reasons: ['10 messages en 3 s'], verdict: 'spam', action: 'suppression + exclusion 1 h', deleted: 10, sample: 'youre such a tryhard', infraction: 2, infractionId: 5, excluded: false, status: 'active', events: [{ at: 1_793_021_041_000, text: 'exclu 1 h' }] };
  const json = (c) => caseCard(c).toJSON();
  const ids = (c) => JSON.stringify(json(c)).match(/"custom_id":"[^"]+"/g);
  const active = json(base);
  assert.equal(active.accent_color, 0xef9f27);
  assert.match(JSON.stringify(active), /Cas #7 · Spam/);
  assert.match(JSON.stringify(active), /10 messages supprimés/);
  assert.match(JSON.stringify(active), /et 9 autres/);
  assert.deepEqual(ids(base), ['"custom_id":"magi-mod:cas-infraction:7"', '"custom_id":"magi-mod:cas-exclure:7"', '"custom_id":"magi-mod:cas-bannir:7"', '"custom_id":"magi-mod:historique:yui"']);
  const both = { ...base, excluded: true, excludedUntil: 1_793_024_641_000, banned: true, infractionId: 3, infraction: 3 };
  assert.deepEqual(ids(both), ['"custom_id":"magi-mod:cas-lever:7"', '"custom_id":"magi-mod:cas-debannir:7"', '"custom_id":"magi-mod:cas-infraction:7"', '"custom_id":"magi-mod:cas-annuler:7"', '"custom_id":"magi-mod:historique:yui"']);
  assert.equal(json(both).accent_color, 0xe24b4a);
  assert.match(JSON.stringify(json(both)), /En cours\*\* : exclu jusqu'à <t:1793024641:t> · banni · infraction 3\/30 j/);
  const lifted = { ...both, excluded: false, banned: false, infractionRevoked: true };
  assert.equal(json(lifted).accent_color, 0x1d9e75);
  assert.match(JSON.stringify(json(lifted)), /infraction retirée/);
  assert.deepEqual(ids({ ...both, excluded: false }), ['"custom_id":"magi-mod:cas-debannir:7"', '"custom_id":"magi-mod:cas-infraction:7"', '"custom_id":"magi-mod:cas-annuler:7"', '"custom_id":"magi-mod:historique:yui"']);
  assert.deepEqual(ids({ ...base, status: 'annulee' }), ['"custom_id":"magi-mod:historique:yui"']);
  assert.equal(json({ ...base, status: 'annulee' }).accent_color, 0x1d9e75);
  assert.deepEqual(ids({ ...base, observing: true }), ['"custom_id":"magi-mod:cas-exclure:7"', '"custom_id":"magi-mod:cas-bannir:7"', '"custom_id":"magi-mod:historique:yui"']);
  assert.match(JSON.stringify(json({ ...base, observing: true })), /Aurait fait/);
  assert.match(history('g-rafale', 'yui'), /#1 · .* · Infraction flagrante/);
});

test('vote de ban : une icône par unité', async () => {
  const { shortVote } = await import('./index.js');
  assert.equal(shortVote([{ persona: 'melchior', verdict: 'APPROUVÉ' }, { persona: 'balthasar', verdict: 'APPROUVÉ' }, { persona: 'casper', verdict: 'REFUSÉ' }]), 'Melchior ✅ · Balthasar ✅ · Casper ❌');
  assert.equal(shortVote([{ persona: 'casper', verdict: 'ABSTENTION' }]), 'Casper ➖');
});

test('boutons de carte : une seule rangée quand ils tiennent, annulations en vert', () => {
  const rows = (c) => caseCard(c).toJSON().components.filter((x) => x.type === 1);
  const base = { id: 9, userId: 'yui', kind: 'spam', reasons: ['x'], action: 'avertissement', deleted: 1, infraction: 1, infractionId: 4, status: 'active', events: [] };
  const single = rows(base);
  assert.equal(single.length, 1);
  assert.deepEqual(single[0].components.map((b) => [b.label, b.style]), [["Retirer l'infraction", 3], ['Mute 24 h', 2], ['Bannir', 4], ['Historique', 2]]);
  assert.equal(rows({ ...base, excluded: true, banned: true }).length, 2);
});
