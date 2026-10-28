import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Collection, MessageFlags, PermissionsBitField } from 'discord.js';

process.env.DB_PATH = ':memory:';
const { alerts, PAGE_MODULES, panelPage } = await import('./panel.js');
const { MODULES, setModules, setMutedChannels } = await import('./config.js');

const guild = { id: 'panel-test', client: { user: { id: '1' } }, members: { me: { permissions: new PermissionsBitField() } }, channels: { cache: new Collection() } };
const pages = ['accueil', 'conversation', 'personas', 'communaute', 'services', 'arrivees', 'securite', 'logs', 'permissions'];

const walk = (node) => [node, ...(node.components ?? []).flatMap(walk), ...(node.accessory ? [node.accessory] : [])];

test('chaque page tient dans les limites de Components V2, avec la navigation', () => {
  setMutedChannels('panel-test', ['111111111111111111']);
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
  assert.match(home, /Mur des confettis\*\* \(Communauté\)/);
  assert.ok(!home.includes('Modèles de langage'));
});
