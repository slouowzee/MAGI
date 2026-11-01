import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Collection, MessageFlags, PermissionsBitField } from 'discord.js';

process.env.DB_PATH = ':memory:';
const { openPanel, panelPage } = await import('./index.js');
const { setSetting, setting } = await import('../core/settings.js');
const { alerts, PAGE_MODULES } = await import('./ui.js');
const { MODULES, setModules, setSettingList } = await import('../core/config.js');

const guild = { id: 'panel-test', client: { user: { id: '1' } }, members: { me: { permissions: new PermissionsBitField() } }, channels: { cache: new Collection() } };
const pages = ['accueil', 'conversation', 'statut', 'personas', 'reponses', 'communaute', 'services', 'arrivees', 'securite', 'automod', 'serveur', 'logs', 'permissions'];

const walk = (node) => [node, ...(node.components ?? []).flatMap(walk), ...(node.accessory ? [node.accessory] : [])];

test('chaque page tient dans les limites de Components V2, avec la navigation', () => {
  setSettingList('panel-test', 'muted_channels', ['111111111111111111']);
  for (const [i, name] of pages.entries()) {
    const { components, flags } = panelPage(guild, name, { live: true });
    assert.equal(flags, MessageFlags.IsComponentsV2);
    const all = walk(components[0].toJSON());
    assert.ok(all.length <= 40, `${name} : ${all.length} composants`);
    assert.ok(all.filter((c) => c.content).reduce((n, c) => n + c.content.length, 0) <= 4000, name);
    const ids = all.map((c) => c.custom_id).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, name);
    const nav = all.find((c) => c.custom_id === 'magi-config:page');
    assert.deepEqual(nav.options.map((o) => o.value), pages);
    assert.deepEqual(nav.options.filter((o) => o.default).map((o) => o.value), [name]);
    assert.ok(all.find((c) => c.content?.includes(`Page ${i + 1}/${pages.length}`)), name);
  }
});

test('chaque module a un seul interrupteur, sur sa page', () => {
  const toggles = pages.flatMap((name) => walk(panelPage(guild, name).components[0].toJSON()).filter((c) => c.custom_id?.startsWith('magi-config:module:')).map((c) => [name, c.custom_id.split(':')[2]]));
  assert.deepEqual(toggles.map(([, key]) => key).sort(), Object.keys(MODULES).sort());
  for (const [page, key] of toggles) assert.ok(PAGE_MODULES[page].includes(key), key);
});

test('alertes : module actif sans salon ou sans permission', () => {
  setModules('panel-test', ['etoiles', 'sondages', 'memoire']);
  const found = alerts(guild);
  assert.deepEqual(Object.keys(found).sort(), ['etoiles', 'sondages']);
  assert.match(found.etoiles, /salon/);
  assert.match(found.sondages, /permissions/);
  const home = walk(panelPage(guild).components[0].toJSON()).map((c) => c.content ?? '').join('\n');
  assert.match(home, /Hall of Fame\*\* \(Communauté\)/);
  assert.ok(!home.includes('Modèles de langage'));
});

test('/magi config : seulement dans le salon du panneau, republie sans laisser de message', async () => {
  setSetting('panel-test', 'config_channel', 'c-config');
  setSetting('panel-test', 'config_page', 'logs');
  const out = [];
  const run = (channelId) => openPanel({ guild: { ...guild, ownerId: 'owner' }, channelId, member: { id: 'owner', guild: { ...guild, ownerId: 'owner' } }, reply: async (p) => out.push(['reply', p.content]), deferReply: async () => out.push(['defer']), deleteReply: async () => out.push(['delete']) });
  await run('ailleurs');
  assert.deepEqual(out.pop(), ['reply', "Le panneau se trouve dans <#c-config> : lance `/magi config` là-bas pour le republier."]);
  await run('c-config');
  assert.deepEqual(out, [['defer'], ['delete']]);
  assert.equal(setting('panel-test', 'config_page'), null);
});

test('palier de synchro réglé depuis le panneau : fenêtre préremplie, message et rôle enregistrés', async () => {
  const { handlePanelInteraction } = await import('./index.js');
  const { milestoneMessages, paliers } = await import('../features/community/synchro.js');
  const role = { id: 'r-pilote', name: 'Pilote', editable: true, permissions: { has: () => false } };
  const g = { ...guild, id: 'panel-palier', ownerId: 'owner', roles: { cache: new Collection([['r-pilote', role]]) } };
  const out = [];
  const base = { guild: g, member: { id: 'owner', guild: g, displayName: 'Slou' }, user: { id: 'owner' }, message: { edit: async () => out.push(['panel']) }, update: async (p) => out.push(['update', p]), reply: async (p) => out.push(['reply', p]), showModal: async (m) => out.push(['modal', m.toJSON()]) };
  await handlePanelInteraction({ ...base, customId: 'magi-config:synchro_palier', values: ['100'] });
  const modal = out.at(-1)[1];
  assert.equal(modal.custom_id, 'magi-config:synchro_palier_set:100');
  assert.deepEqual(modal.components.map((c) => c.component.type), [4, 6]);
  await handlePanelInteraction({ ...base, customId: 'magi-config:synchro_palier_set:100', isModalSubmit: () => true, fields: { getTextInputValue: () => 'GG {membre}, {taux} !', getSelectedRoles: () => new Collection([['r-pilote', role]]) } });
  assert.equal(out.at(-1)[0], 'update');
  assert.equal(paliers('panel-palier')[100], 'r-pilote');
  assert.equal(milestoneMessages('panel-palier')[100], 'GG {membre}, {taux} !');
  const select = walk(out.at(-1)[1].components[0].toJSON()).find((c) => c.custom_id === 'magi-config:synchro_palier');
  assert.equal(select.options.find((o) => o.value === '100').description, '@Pilote · message perso');
});

test('page Réponses : emojis de la banque réglables, emoji du serveur accepté, réponse apprise retirée', async () => {
  const { handlePanelInteraction } = await import('./index.js');
  const { learn, learnedExamples } = await import('../features/conversation/examples.js');
  const { goodEmoji } = await import('../features/conversation/feedback.js');
  const g = { ...guild, id: 'panel-reponses', ownerId: 'owner', roles: { cache: new Collection() } };
  const out = [];
  const base = { guild: g, member: { id: 'owner', guild: g, displayName: 'Slou' }, user: { id: 'owner' }, update: async (p) => out.push(['update', p]), reply: async (p) => out.push(['reply', p]), showModal: async (m) => out.push(['modal', m.toJSON()]) };
  await handlePanelInteraction({ ...base, customId: 'magi-config:examples_good', values: ['⭐'] });
  assert.equal(goodEmoji('panel-reponses'), '⭐');
  await handlePanelInteraction({ ...base, customId: 'magi-config:examples_good', values: ['autre'] });
  assert.equal(out.at(-1)[1].custom_id, 'magi-config:examples_good_set');
  await handlePanelInteraction({ ...base, customId: 'magi-config:examples_good_set', isModalSubmit: () => true, fields: { getTextInputValue: () => '<:magi_ok:123456789012345678>' } });
  assert.equal(goodEmoji('panel-reponses'), '<:magi_ok:123456789012345678>');
  learn('panel-reponses', { persona: 'melchior', input: 'Slou : pâtes ou riz ?', output: 'Pâtes, évidemment.', by: 'owner' });
  await handlePanelInteraction({ ...base, customId: 'magi-config:page:reponses' });
  const select = walk(out.at(-1)[1].components[0].toJSON()).find((c) => c.custom_id === 'magi-config:examples_forget');
  assert.match(select.options[0].label, /^Melchior · Pâtes, évidemment\.$/);
  await handlePanelInteraction({ ...base, customId: 'magi-config:examples_forget', values: [select.options[0].value] });
  assert.equal(learnedExamples('panel-reponses').length, 0);
});
