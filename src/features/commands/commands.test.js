import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Collection, MessageFlags } from 'discord.js';

process.env.DB_PATH = ':memory:';
const { COMMANDS, statusReport, syncCommands } = await import('./commands.js');
const { setModules, MODULES } = await import('../../core/config.js');

test('commandes enregistrées selon le module, /magi, /ecrire et /clear toujours présentes', async () => {
  let sent = [];
  const guild = { id: 'g-commandes', commands: { set: async (list) => (sent = list) } };
  await syncCommands(guild);
  assert.deepEqual(sent.map((c) => c.name), ['Vérifier (Melchior)', 'Avis de Casper', 'Soutien de Balthasar', 'Résumer depuis ici', 'chuchoter', 'magi', 'ecrire', 'clear', 'Publier avec MAGI', 'profil', 'oublier', 'lookup', 'warn', 'mute', 'unmute', 'ban', 'unban', 'kick']);
  setModules(guild.id, Object.keys(MODULES).filter((m) => m !== 'commandes'));
  await syncCommands(guild);
  assert.deepEqual(sent.map((c) => c.name), ['magi', 'ecrire', 'clear', 'Publier avec MAGI', 'profil', 'oublier', 'lookup', 'classement', 'warn', 'mute', 'unmute', 'ban', 'unban', 'kick']);
  assert.ok(COMMANDS.every((c) => c.data.name.length <= 32));
  const perms = Object.fromEntries(sent.map((c) => [c.name, c.default_member_permissions]));
  assert.deepEqual(perms, { magi: '32', ecrire: '32', clear: '8192', 'Publier avec MAGI': '32', profil: null, oublier: null, lookup: '8192', classement: null, warn: '8192', mute: '1099511627776', unmute: '1099511627776', ban: '4', unban: '4', kick: '2' });
  assert.ok(COMMANDS.every((c) => c.perms || c.tier in { membres: 1, moderation: 1, operateurs: 1 }));
});

test('statut des modèles lisible', () => {
  const now = Date.parse('2026-10-27T20:00:00Z');
  const report = statusReport(
    [
      { provider: 'gemini', model: 'gemini-3.5-flash-lite', paused: now + 4 * 60_000, ok: 12, fail: 3, latency: 14200, lastError: 'délai de 12 s dépassé' },
      { provider: 'groq', model: 'openai/gpt-oss-120b', paused: null, ok: 0, fail: 0, latency: null, lastError: null },
    ],
    now,
    3 * 3600 + 25 * 60,
  );
  assert.match(report, /gemini-3\.5-flash-lite\*\* \(gemini\) : en pause encore 4 min, 14\.2 s en moyenne, 12 réponse\(s\), 3 échec\(s\), dernier : délai de 12 s dépassé/);
  assert.match(report, /openai\/gpt-oss-120b\*\* \(groq\) : disponible, pas encore utilisé, 0 réponse\(s\)/);
  assert.match(report, /En ligne depuis 3 h 25 min\./);
});

test('les actions réservées sont annoncées au modèle pour qui ne peut pas les faire', async () => {
  const { deniedNote } = await import('../../tools.js');
  const member = { id: 'yui', displayName: 'Yui', guild: { id: 'g-droits', ownerId: 'slou', roles: { cache: new Map() } }, roles: { cache: new Map() }, permissions: { has: () => false } };
  const note = deniedNote(member);
  assert.match(note, /Yui n'a pas le droit/);
  assert.match(note, /publier/);
  assert.match(note, /opérateurs MAGI/);
});

test('clear : par paquets de 100, filtre MAGI, s’arrête aux messages de plus de 14 jours', async () => {
  const { fromMagi, sweep } = await import('./write.js');
  const now = Date.parse('2026-10-28T21:00:00Z');
  const messages = Array.from({ length: 250 }, (_, i) => ({ id: String(1000 - i), createdTimestamp: now - (i < 230 ? i * 60_000 : 20 * 86_400_000), author: { id: i % 2 ? 'slou' : 'magi' }, applicationId: null }));
  const removed = [];
  const channel = {
    messages: { fetch: async ({ before }) => new Map(messages.filter((m) => !before || Number(m.id) < Number(before)).slice(0, 100).map((m) => [m.id, m])) },
    bulkDelete: async (list) => {
      removed.push(...list.map((m) => m.id));
      return new Map(list.map((m) => [m.id, m]));
    },
  };
  assert.deepEqual(await sweep(channel, 150, () => true, now), { deleted: 150, old: 0 });
  removed.length = 0;
  assert.deepEqual(await sweep(channel, 1000, (m) => fromMagi(m, 'magi'), now), { deleted: 115, old: 10 });
  assert.ok(fromMagi({ author: { id: 'webhook' }, applicationId: 'magi' }, 'magi'));
});

test('date des messages programmés : heure de Paris, lendemain si passée, erreurs claires', async () => {
  const { parseWhen } = await import('./write.js');
  const now = Date.parse('2026-10-29T16:00:00Z');
  const at = (text) => parseWhen(text, now).at;
  assert.equal(parseWhen('', now).at, null);
  assert.equal(at('18h30'), Date.parse('2026-10-29T17:30:00Z'));
  assert.equal(at('9h'), Date.parse('2026-10-30T08:00:00Z'));
  assert.equal(at('2h'), Date.parse('2026-10-30T01:00:00Z'));
  assert.equal(at('demain à 9h'), Date.parse('2026-10-30T08:00:00Z'));
  assert.equal(at('dans 2h'), now + 7_200_000);
  assert.equal(at('dans 1h30'), now + 5_400_000);
  assert.equal(at('30min'), now + 1_800_000);
  assert.equal(at('31/10 20h'), Date.parse('2026-10-31T19:00:00Z'));
  assert.equal(at('1/7 12:00'), Date.parse('2027-07-01T10:00:00Z'));
  for (const bad of ['25h', '32/10 10h', 'bientôt', '12h75']) assert.match(parseWhen(bad, now).error, /Date non comprise/);
  assert.match(parseWhen('dans 400j', now).error, /un an/);
});

test('/ecrire programmé : enregistré, annulable, publié à l’heure', async () => {
  const { cancelScheduled, handleWriteModal, scheduledMessages, sendDueMessages } = await import('./write.js');
  const sent = [];
  const guild = { id: 'g-prog', ownerId: 'op', channels: { cache: new Map() }, members: { cache: new Collection(), fetch: async () => {} }, roles: { cache: new Collection() } };
  const channel = { id: 'c-prog', guild, toString: () => '<#c-prog>', send: async (p) => (sent.push(p), { url: 'https://discord.com/x' }) };
  guild.channels.cache.set(channel.id, channel);
  const replies = [];
  const submit = (quand) => handleWriteModal({ customId: 'magi-write:message:c-prog:', guild, member: { id: 'op', guild, toString: () => '<@op>' }, user: { id: 'op' }, isModalSubmit: () => true, fields: { getTextInputValue: (k) => ({ texte: 'Soirée jeux ce soir', quand })[k] }, reply: async (p) => replies.push(p), deferReply: async () => {}, editReply: async (p) => replies.push(p) });
  await submit('demain 32h');
  assert.match(replies.at(-1).content, /Date non comprise[\s\S]*Soirée jeux ce soir/);
  await submit('dans 1h');
  assert.match(replies.at(-1).content, /^Message n°\d+ programmé dans <#c-prog>/);
  const [first] = scheduledMessages('g-prog');
  await submit('dans 2h');
  const cancel = replies.at(-1).components[0].toJSON().components[0].custom_id;
  const updates = [];
  await handleWriteModal({ customId: cancel, guild, member: { id: 'op', guild, toString: () => '<@op>' }, update: async (p) => updates.push(p.content) });
  assert.match(updates[0], /annulé/);
  await sendDueMessages({ guilds: { cache: new Map([['g-prog', guild]]) } }, Date.now() + 3 * 3_600_000);
  assert.deepEqual(sent.map((p) => p.content), ['Soirée jeux ce soir']);
  assert.equal(scheduledMessages('g-prog').length, 0);
  assert.equal(cancelScheduled(first.id, 'g-prog'), false);
});

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const fieldsOf = (values, selects = {}, files = {}) => ({ getTextInputValue: (k) => values[k] ?? '', getStringSelectValues: (k) => selects[k] ?? [], getUploadedFiles: (k) => files[k] ?? null });

function publishing(guildId, messageId) {
  const out = [];
  const sent = [];
  const guild = { id: guildId, ownerId: 'op', name: 'Test', channels: { cache: new Map() }, members: { cache: new Collection(), fetch: async () => {} }, roles: { cache: new Collection() } };
  const channel = { id: `${guildId}-c`, guild, toString: () => `<#${guildId}-c>`, send: async (p) => (sent.push(p), { id: messageId, url: `https://discord.com/${messageId}` }), messages: { fetch: async () => channel.target } };
  guild.channels.cache.set(channel.id, channel);
  const base = { guild, member: { id: 'op', guild, toString: () => '<@op>' }, user: { id: 'op' }, client: { user: { id: 'magi' } }, reply: async (p) => out.push(['reply', p]), deferReply: async () => out.push(['defer']), editReply: async (p) => out.push(['edit', p]), deferUpdate: async () => out.push(['deferUpdate']), update: async (p) => out.push(['update', p]), followUp: async (p) => out.push(['followUp', p]), showModal: async (m) => out.push(['modal', m.toJSON()]) };
  return { out, sent, guild, channel, base };
}

test('/ecrire publication : couleur, images, bouton lien, section, aperçu, publication puis modification', async () => {
  const { handleWriteModal, openWrite } = await import('./write.js');
  const { publicationMeta } = await import('./publication.js');
  const id = '123456789012345678';
  const { out, sent, channel, base } = publishing('g-pub', id);
  const uploads = new Collection([['u1', { url: PNG, name: 'chat.png', contentType: 'image/png' }], ['u2', { url: PNG, name: 'chien.JPG', contentType: 'image/jpeg' }], ['u3', { url: PNG, name: 'notes.txt', contentType: 'text/plain' }]]);
  await handleWriteModal({ ...base, customId: `magi-write:publication:${channel.id}:`, isModalSubmit: () => true, fields: fieldsOf({ titre: 'Soirée jeux', texte: 'Ce soir 21 h', quand: '' }, { couleur: ['bleu'] }, { images: uploads }) });
  const preview = out.at(-1)[1];
  const card = preview.components[1].toJSON();
  assert.equal(card.accent_color, 0x378add);
  assert.match(card.components[0].content, /^### Soirée jeux\nCe soir 21 h$/);
  assert.deepEqual(card.components.find((c) => c.type === 12).items.map((i) => i.media.url), ['attachment://image-1.png', 'attachment://image-2.jpg']);
  assert.equal(preview.files.length, 2);
  const controls = preview.components[2].toJSON().components.map((b) => b.custom_id);
  const token = controls[0].split(':').at(-1);
  await handleWriteModal({ ...base, customId: controls[0] });
  assert.equal(out.at(-1)[0], 'modal');
  await handleWriteModal({ ...base, customId: `magi-write:draft:bouton-set:${token}`, fields: fieldsOf({ texte: 'Rejoindre', url: 'pas un lien' }) });
  assert.match(out.at(-1)[1].content, /https:\/\//);
  await handleWriteModal({ ...base, customId: `magi-write:draft:bouton-set:${token}`, fields: fieldsOf({ texte: 'Rejoindre', url: 'https://discord.gg/x' }) });
  await handleWriteModal({ ...base, customId: `magi-write:draft:section-set:${token}`, fields: fieldsOf({ texte: 'Programme : Among Us puis Mario Kart' }) });
  const updated = out.at(-1)[1].components[1].toJSON();
  assert.ok(updated.components.some((c) => c.type === 14));
  assert.deepEqual(updated.components.at(-1).components.map((b) => [b.label, b.url]), [['Rejoindre', 'https://discord.gg/x']]);
  await handleWriteModal({ ...base, customId: `magi-write:draft:modifier:${token}` });
  const draftModal = JSON.stringify(out.at(-1)[1]);
  assert.match(draftModal, /"value":"Ce soir 21 h"/);
  assert.match(draftModal, /Nouvelles images \(vide = garder\)/);
  await handleWriteModal({ ...base, customId: `magi-write:draft:modifier-set:${token}`, fields: fieldsOf({ titre: 'Soirée jeux', texte: 'Ce soir 21 h, venez nombreux', quand: '' }, { couleur: ['violet'] }) });
  const edited = out.at(-1)[1].components[1].toJSON();
  assert.equal(edited.accent_color, 0x7f77dd);
  assert.match(edited.components[0].content, /venez nombreux/);
  assert.equal(edited.components.find((c) => c.type === 12).items.length, 2);
  await handleWriteModal({ ...base, customId: `magi-write:draft:bouton-set:${token}`, fields: fieldsOf({ texte: 'En trop', url: 'https://x.y' }) });
  const select = out.at(-1)[1].components[3].toJSON().components[0];
  assert.deepEqual(select.options.map((o) => o.value), ['bouton:0', 'bouton:1', 'section:0', 'images']);
  await handleWriteModal({ ...base, customId: select.custom_id, values: ['bouton:1'] });
  assert.equal(out.at(-1)[1].components[1].toJSON().components.at(-1).components.length, 1);
  await handleWriteModal({ ...base, customId: `magi-write:draft:publier:${token}` });
  assert.equal(sent[0].flags, MessageFlags.IsComponentsV2);
  assert.equal(sent[0].files.length, 2);
  assert.match(out.at(-1)[1].components[0].toJSON().content, /^Publié : /);
  assert.deepEqual(publicationMeta('g-pub', id).images, ['image-1.png', 'image-2.jpg']);

  const edits = [];
  channel.target = { id, url: `https://discord.com/${id}`, author: { id: 'magi' }, flags: { has: () => true }, attachments: new Collection([['a1', { id: 'a1', name: 'image-1.png', url: 'https://cdn/1.png' }], ['a2', { id: 'a2', name: 'image-2.jpg', url: 'https://cdn/2.jpg' }]]), edit: async (p) => edits.push(p) };
  await openWrite({ ...base, channel, options: { getString: (k) => ({ forme: 'publication', modifier: `https://discord.com/channels/g/${channel.id}/${id}` })[k], getChannel: () => channel } });
  const modal = JSON.stringify(out.at(-1)[1]);
  assert.match(modal, /"value":"Soirée jeux"/);
  assert.match(modal, /"value":"violet","default":true/);
  await handleWriteModal({ ...base, customId: `magi-write:publication:${channel.id}:${id}`, isModalSubmit: () => true, fields: fieldsOf({ titre: 'Soirée jeux', texte: 'Ce soir 22 h' }, { couleur: ['vert'] }) });
  const editPreview = out.at(-1)[1];
  assert.equal(editPreview.components[1].toJSON().accent_color, 0x1d9e75);
  assert.equal(editPreview.files.length, 0);
  const update = editPreview.components[2].toJSON().components.find((b) => b.label === 'Mettre à jour').custom_id;
  await handleWriteModal({ ...base, customId: update });
  assert.deepEqual(edits[0].attachments.map((a) => a.id), ['a1', 'a2']);
  const final = edits[0].components[0].toJSON();
  assert.deepEqual(final.components.find((c) => c.type === 12).items.map((i) => i.media.url), ['attachment://image-1.png', 'attachment://image-2.jpg']);
  assert.match(final.components[0].content, /Ce soir 22 h/);
  assert.equal(final.accent_color, 0x1d9e75);
  assert.equal(final.components.at(-1).components[0].label, 'Rejoindre');
});

test('/ecrire publication programmée : images gardées jusqu’à l’envoi puis effacées', async () => {
  const { handleWriteModal, scheduledMessages, sendDueMessages } = await import('./write.js');
  const { out, sent, guild, channel, base } = publishing('g-pub-prog', '223456789012345678');
  await handleWriteModal({ ...base, customId: `magi-write:publication:${channel.id}:`, isModalSubmit: () => true, fields: fieldsOf({ titre: '', texte: 'Tournoi demain', quand: 'dans 1h' }, {}, { images: new Collection([['u1', { url: PNG, name: 'affiche.png', contentType: 'image/png' }]]) }) });
  const controls = out.at(-1)[1].components[2].toJSON().components;
  assert.ok(controls.some((b) => b.label === 'Programmer'));
  await handleWriteModal({ ...base, customId: controls.find((b) => b.label === 'Programmer').custom_id });
  const [row] = scheduledMessages('g-pub-prog');
  assert.ok(existsSync(join(tmpdir(), 'programmes', String(row.id), 'image-1.png')));
  await sendDueMessages({ guilds: { cache: new Map([[guild.id, guild]]) } }, Date.now() + 2 * 3_600_000);
  assert.equal(sent[0].files.length, 1);
  assert.equal(sent[0].files[0].name, 'image-1.png');
  assert.ok(!existsSync(join(tmpdir(), 'programmes', String(row.id))));
});

test('mentions et emojis écrits en texte : convertis, ambigus et inconnus signalés', async () => {
  const { resolveMentions } = await import('./mentions.js');
  const member = (id, displayName, username) => [id, { id, displayName, user: { username, globalName: null } }];
  const guild = {
    id: 'g',
    members: { cache: new Collection([member('1', 'Yui', 'yui.traces'), member('2', 'Miss Fortune', 'mf'), member('3', 'Léa', 'lea'), member('4', 'Léa', 'lea2')]) },
    roles: { cache: new Collection([['g', { id: 'g', name: '@everyone' }], ['r1', { id: 'r1', name: 'Modération' }]]) },
    channels: { cache: new Collection([['c1', { id: 'c1', name: '💬・general' }], ['c2', { id: 'c2', name: 'règles' }]]) },
    emojis: { cache: new Collection([['e1', { id: 'e1', name: 'pepe', animated: false }], ['e2', { id: 'e2', name: 'dance', animated: true }]]) },
  };
  const { text, unknown } = resolveMentions(guild, '# Soirée\nSalut @Miss Fortune et @yui, voir #general et #règles, ping @Modération :pepe: :dance: :inconnu: @Léa @personne @everyone a@b.fr 10:30:45 <@1>');
  assert.equal(text, '# Soirée\nSalut <@2> et <@1>, voir <#c1> et <#c2>, ping <@&r1> <:pepe:e1> <a:dance:e2> :inconnu: @Léa @personne @everyone a@b.fr 10:30:45 <@1>');
  assert.deepEqual(unknown, ['@Léa (plusieurs correspondances)', '@personne', ':inconnu:']);
});

test('clic droit « Publier avec MAGI » : brouillon repris du message, salon au choix, original gardé', async () => {
  const { draftFromMessage, handleWriteModal } = await import('./write.js');
  const { out, sent, channel, base } = publishing('g-clic', '323456789012345678');
  const deleted = [];
  channel.messages.delete = async (id) => deleted.push(id);
  const source = { id: 'src', channel, author: { id: 'op' }, content: 'Tournoi samedi <@1>', attachments: new Collection([['a', { url: PNG, name: 'affiche.png', contentType: 'image/png' }]]) };
  await draftFromMessage({ ...base, targetMessage: source });
  const preview = out.at(-1)[1];
  assert.match(preview.components[1].toJSON().components[0].content, /^Tournoi samedi <@1>$/);
  assert.equal(preview.files.length, 1);
  const where = preview.components.at(-1).toJSON().components[0];
  assert.equal(where.type, 8);
  assert.deepEqual(where.default_values, [{ id: channel.id, type: 'channel' }]);
  const annonces = { id: 'annonces', guild: channel.guild, toString: () => '<#annonces>', send: async (p) => (sent.push(['annonces', p]), { id: '423456789012345678', url: 'https://discord.com/annonces' }) };
  channel.guild.channels.cache.set('annonces', annonces);
  await handleWriteModal({ ...base, customId: where.custom_id, values: ['annonces'] });
  assert.match(out.at(-1)[1].components[0].toJSON().content, /dans <#annonces>/);
  const publish = out.at(-1)[1].components[2].toJSON().components.find((b) => b.label === 'Publier').custom_id;
  await handleWriteModal({ ...base, customId: publish });
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'annonces');
  assert.deepEqual(deleted, []);
});

test('publication : une ligne --- devient un séparateur, y compris dans une section avec vignette', async () => {
  const { publicationCard } = await import('./publication.js');
  const card = publicationCard({ title: 'Règles', text: 'Un\n---\nDeux\n  -----  \nTrois', color: 'magi', images: [], buttons: [], sections: [{ text: 'A\n---\nB', thumb: { name: 'vignette-1.png', url: 'https://cdn/v.png' } }] }).toJSON();
  assert.deepEqual(card.components.map((c) => c.type), [10, 14, 10, 14, 10, 14, 9, 14, 10, 10]);
  assert.deepEqual(card.components.filter((c) => c.type === 10).map((c) => c.content), ['### Règles\nUn', 'Deux', 'Trois', 'B', '-# Publié par MAGI']);
  assert.equal(card.components[6].components[0].content, 'A');
});
