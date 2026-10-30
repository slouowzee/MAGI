import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits as P } from 'discord.js';

const { parseDuration, punish } = await import('./manual.js');
const { addNote, infractionLine, lookupCard, notesOf } = await import('./lookup.js');
const { getCase } = await import('./store.js');
const { setSetting } = await import('../../core/settings.js');

function world(id) {
  const calls = [];
  const cards = [];
  const modlog = { id: `${id}-mod`, name: 'magi-moderation', send: async (payload) => (cards.push(payload), { id: `card-${cards.length}` }), messages: { fetch: async () => null } };
  const guild = { id, ownerId: 'owner', channels: { cache: new Map([[modlog.id, modlog]]) }, roles: { cache: new Map() } };
  const perms = (list) => ({ has: (p) => list.includes(p) });
  const person = (uid, position, list = []) => ({
    id: uid,
    displayName: uid,
    toString: () => `<@${uid}>`,
    guild,
    user: { id: uid, tag: uid, bot: false, createdTimestamp: Date.now() - 86_400_000, username: uid, displayAvatarURL: () => 'https://x/a.png', bannerURL: () => null },
    displayAvatarURL: () => 'https://x/a.png',
    joinedTimestamp: Date.now() - 3_600_000,
    roles: { highest: { position }, cache: new Map() },
    permissions: perms(list),
    moderatable: true,
    kickable: true,
    communicationDisabledUntilTimestamp: null,
    timeout: async (ms) => calls.push(['timeout', uid, ms]),
    kick: async () => calls.push(['kick', uid]),
  });
  const mod = person('mod', 5, [P.ModerateMembers, P.ManageMessages]);
  const yui = person('yui', 1);
  const boss = person('boss', 9);
  const members = new Map([['mod', mod], ['yui', yui], ['boss', boss]]);
  guild.members = { me: { roles: { highest: { position: 10 } } }, cache: members, fetch: async (uid) => members.get(uid) ?? Promise.reject(new Error('Unknown Member')) };
  guild.bans = { fetch: async () => null };
  guild.client = { users: { fetch: async (uid) => members.get(uid)?.user ?? null } };
  guild.fetchAuditLogs = async () => ({ entries: new Map() });
  setSetting(id, 'log_channel:moderation', modlog.id);
  return { guild, mod, yui, calls, cards };
}

test('sanctions manuelles : droits, hiérarchie, carte de cas et infraction comptée', async () => {
  const w = world('g-manuel');
  assert.match(await punish({ guild: w.guild, moderator: w.mod, userId: 'yui', action: 'warn', reason: 'flood' }), /^<@yui> averti · cas #\d+, infraction 1\/30 j\.$/);
  const muted = await punish({ guild: w.guild, moderator: w.mod, userId: 'yui', action: 'mute', reason: 'insultes', duration: parseDuration('1h') });
  assert.match(muted, /^<@yui> exclu 1 h · cas #\d+, infraction 2\/30 j\.$/);
  assert.deepEqual(w.calls[0], ['timeout', 'yui', 3_600_000]);
  const c = getCase(Number(muted.match(/#(\d+)/)[1]));
  assert.equal(c.kind, 'manuel');
  assert.equal(c.by, 'mod');
  assert.equal(c.excluded, true);
  assert.equal(w.cards.length, 2);
  assert.match(JSON.stringify(w.cards[1]), /par <@mod>/);
  await assert.rejects(punish({ guild: w.guild, moderator: w.mod, userId: 'boss', action: 'warn', reason: 'x' }), /rôle est égal ou supérieur/);
  await assert.rejects(punish({ guild: w.guild, moderator: w.mod, userId: 'yui', action: 'ban', reason: 'x' }), /Bannir des membres/);
  await assert.rejects(punish({ guild: w.guild, moderator: w.mod, userId: 'mod', action: 'warn', reason: 'x' }), /rôle est égal ou supérieur/);
  assert.match(infractionLine('g-manuel', 'yui'), /^- 2 infractions sur les 30 derniers jours\n- Prochaine sanction : suppression \+ exclusion 24 h \+ vote de ban\n- La plus ancienne s'efface <t:\d+:R>$/);
  assert.equal(parseDuration('7 d')[0], '7 j');
  assert.equal(parseDuration('2h'), null);
});

test('lookup complet : identité, infractions, cas, notes, boutons, dans les limites de Discord', async () => {
  const w = world('g-lookup');
  await punish({ guild: w.guild, moderator: w.mod, userId: 'yui', action: 'warn', reason: 'flood' });
  addNote('g-lookup', 'yui', 'mod', 'déjà prévenue en vocal');
  assert.equal(notesOf('g-lookup', 'yui').length, 1);
  const payload = await lookupCard(w.guild, 'yui');
  const json = JSON.stringify(payload.components[0].toJSON());
  for (const part of ['`yui`', '<@yui>', 'Infractions', 'Sanction manuelle', 'déjà prévenue en vocal', 'magi-look:warn:yui', 'magi-look:ban:yui', 'magi-look:note:yui']) assert.ok(json.includes(part), part);
  const texts = payload.components[0].toJSON().components.flatMap((c) => [c, ...(c.components ?? [])]).map((c) => c.content ?? '').join('');
  assert.ok(texts.length < 4000);
});

test('purge : efface cas et infractions du membre, et seulement les siens', async () => {
  const { purgeMember, recordOf } = await import('./store.js');
  const w = world('g-purge');
  await punish({ guild: w.guild, moderator: w.mod, userId: 'yui', action: 'warn', reason: 'a' });
  await punish({ guild: w.guild, moderator: w.mod, userId: 'yui', action: 'warn', reason: 'b' });
  assert.deepEqual([recordOf('g-purge', 'yui').cases.length, recordOf('g-purge', 'yui').infractions], [2, 2]);
  const removed = purgeMember('g-purge', 'yui');
  assert.equal(removed.cases.length, 2);
  assert.deepEqual([recordOf('g-purge', 'yui').cases.length, recordOf('g-purge', 'yui').infractions], [0, 0]);
  assert.equal(infractionLine('g-purge', 'yui'), 'Aucune infraction sur les 30 derniers jours.');
  assert.ok(recordOf('g-manuel', 'yui').cases.length > 0);
});

test('purge : le bouton « Tout effacer » répond et vide le casier', async () => {
  const { handleLookupInteraction } = await import('./lookup.js');
  const { recordOf } = await import('./store.js');
  const w = world('g-bouton');
  await punish({ guild: w.guild, moderator: w.mod, userId: 'yui', action: 'warn', reason: 'a' });
  const owner = { ...w.mod, id: 'owner', permissions: { has: () => true } };
  const replies = [];
  const interaction = { customId: 'magi-look:purge-ok:yui', guild: w.guild, guildId: 'g-bouton', member: owner, user: { tag: 'owner' }, update: async (p) => replies.push(p.content), editReply: async (p) => replies.push(p.content), reply: async (p) => replies.push(p.content) };
  await handleLookupInteraction(interaction);
  assert.equal(replies[0], 'Purge en cours…');
  assert.match(replies[1], /^Casier de <@yui> effacé : 1 cas, 1 infraction/);
  assert.deepEqual([recordOf('g-bouton', 'yui').cases.length, recordOf('g-bouton', 'yui').infractions], [0, 0]);
});

test('profil : la mémoire est visible et le membre peut tout oublier, lui seulement', async () => {
  const { handleLookupInteraction, showProfile } = await import('./lookup.js');
  const { factsAbout, rememberFact } = await import('../memory/store.js');
  const w = world('g-oubli');
  await rememberFact('g-oubli', 'yui', 'joue du piano');
  const replies = [];
  const base = { guild: w.guild, guildId: 'g-oubli', member: w.yui, user: { ...w.yui.user, displayAvatarURL: () => 'https://x/a.png' }, reply: async (p) => replies.push(p), update: async (p) => replies.push(p) };
  await showProfile(base);
  const card = JSON.stringify(replies[0].components[0].toJSON());
  assert.match(card, /joue du piano/);
  assert.match(card, /\*\*Synchronisation\*\* : 0 % · 0 point/);
  assert.match(card, /magi-look:oublier:yui/);
  const { showMemory } = await import('./lookup.js');
  await showMemory(base);
  const memory = JSON.stringify(replies.at(-1).components[0].toJSON());
  assert.match(memory, /Ce que MAGI retient de toi[^"]*joue du piano/);
  assert.match(memory, /magi-look:oublier-ok:yui/);
  await handleLookupInteraction({ ...base, customId: 'magi-look:oublier-ok:yui', user: { id: 'mod' } });
  assert.match(replies.at(-1).content, /Seule la personne concernée/);
  await handleLookupInteraction({ ...base, customId: 'magi-look:oublier:yui' });
  assert.match(replies.at(-1).content, /définitif/);
  await handleLookupInteraction({ ...base, customId: 'magi-look:oublier-ok:yui' });
  assert.match(replies.at(-1).content, /^C’est oublié : 1 souvenir/);
  assert.deepEqual(await factsAbout('g-oubli', 'yui'), []);
});

test('contestation : DM avec bouton, fenêtre, carte du cas, refus et réponse au membre', async () => {
  const { handleAppealInteraction } = await import('./appeal.js');
  const { handleSecurityButton } = await import('../security/actions.js');
  const w = world('g-appel');
  const dms = [];
  w.guild.client = { users: { fetch: async (uid) => ({ id: uid, send: async (p) => (dms.push([uid, p]), {}) }) }, guilds: { cache: new Map([['g-appel', w.guild]]) } };
  await punish({ guild: w.guild, moderator: w.mod, userId: 'yui', action: 'warn', reason: 'flood' });
  await Bun.sleep(5);
  const [to, dm] = dms[0];
  assert.equal(to, 'yui');
  const sent = dm.components[0].toJSON();
  const shown = JSON.stringify(sent);
  assert.equal(dm.flags, 32768);
  assert.equal(sent.accent_color, 0xef9f27);
  assert.match(shown, /\*\*Sanction\*\* : Avertissement\\n\*\*Motif\*\* : flood\\n\*\*Date\*\* : <t:\d+:f>"/);
  assert.ok(!/cas #/i.test(shown));
  const { latestCase } = await import('./cases.js');
  const { id } = latestCase('g-appel', 'yui', () => true);
  const open = sent.components.at(-1).components[0].custom_id;
  const out = [];
  const click = (customId, extra = {}) => handleAppealInteraction({ customId, client: w.guild.client, user: { id: 'yui' }, reply: async (p) => out.push(['reply', p]), update: async (p) => out.push(['update', p]), showModal: async (m) => out.push(['modal', m.toJSON()]), message: { components: dm.components.map((b) => ({ type: b.toJSON().type, toJSON: () => b.toJSON() })) }, ...extra });
  assert.equal(open, 'magi-appeal:open:g-appel');
  await click(open);
  assert.equal(out.at(-1)[1].custom_id, `magi-appeal:send:g-appel:${id}`);
  await click(`magi-appeal:send:g-appel:${id}`, { fields: { getTextInputValue: () => 'Je répondais à un ami, pas du flood.' } });
  const contested = out.at(-1)[1].components[0];
  assert.match(JSON.stringify(contested), /Motif\*\* : flood[\s\S]*Contestation envoyée/);
  assert.equal(contested.components.at(-1).components[0].custom_id, `magi-appeal:state:g-appel:${id}`);
  assert.equal(getCase(id).appeal.state, 'en attente');
  await click(`magi-appeal:send:g-appel:${id}`, { fields: { getTextInputValue: () => 'encore une fois' } });
  assert.match(JSON.stringify(out.at(-1)[1].components[0].toJSON()), /En attente/);
  const owner = { ...w.mod, id: 'owner', displayName: 'Slou', permissions: { has: () => true } };
  const cards = [];
  await handleSecurityButton({ customId: `magi-mod:appel-non:${id}`, guild: w.guild, member: owner, user: { tag: 'owner' }, update: async (p) => cards.push(p) });
  assert.equal(getCase(id).appeal.state, 'refusée');
  assert.ok(!JSON.stringify(cards[0].components[0].toJSON()).includes('appel-ok'));
  await Bun.sleep(5);
  assert.match(JSON.stringify(dms.at(-1)[1].components[0].toJSON()), /Refusée : la sanction est maintenue/);
  await click(`magi-appeal:state:g-appel:${id}`);
  assert.match(JSON.stringify(out.at(-1)[1].components[0].toJSON()), /Refusée/);
  await click(`magi-appeal:state:g-appel:${id}`, { user: { id: 'mod' } });
  assert.equal(out.at(-1)[1].content, 'Cas introuvable.');
});

test('lookup : la fenêtre Mute applique la sanction', async () => {
  const { handleLookupInteraction } = await import('./lookup.js');
  const w = world('g-fenetre');
  const replies = [];
  const fields = { duree: '6h', texte: 'spam en vocal' };
  const interaction = { customId: 'magi-look:mute-set:yui', guild: w.guild, guildId: 'g-fenetre', member: w.mod, user: { tag: 'mod' }, fields: { getTextInputValue: (k) => fields[k] }, deferReply: async () => {}, editReply: async (p) => replies.push(p.content), reply: async (p) => replies.push(p.content) };
  await handleLookupInteraction(interaction);
  assert.match(replies[0], /^<@yui> exclu 6 h · cas #\d+/);
  assert.deepEqual(w.calls.at(-1), ['timeout', 'yui', 6 * 3_600_000]);
});
