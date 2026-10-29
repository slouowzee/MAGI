import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Collection, PermissionsBitField } from 'discord.js';

const { debugActive, handleDebugInteraction, tickDebug } = await import('./console.js');
const { panelPage } = await import('../../panel/index.js');
const { ACTIONS } = await import('./actions.js');
const { exportConfig, importConfig, readConfig } = await import('./config.js');
const { recordInfraction, recordOf } = await import('../moderation/store.js');
const { setSetting, setting } = await import('../../core/settings.js');
const { forcedProvider } = await import('../../core/llm/client.js');

function world(id) {
  const guild = { id, name: 'Test', ownerId: 'owner', channels: { cache: new Collection() }, roles: { cache: new Collection() }, members: { cache: new Collection(), me: { permissions: new PermissionsBitField() } }, client: { user: { id: 'magi' }, guilds: { cache: new Map() } } };
  guild.client.guilds.cache.set(id, guild);
  const out = [];
  const click = (customId, extra = {}) => {
    const interaction = {
      customId,
      guild,
      guildId: id,
      user: { id: extra.userId ?? 'owner', tag: 'owner' },
      member: { id: 'owner', displayName: 'Slou', toString: () => '<@owner>' },
      client: guild.client,
      values: extra.values,
      fields: { getTextInputValue: (k) => extra.fields?.[k] ?? '', getStringSelectValues: (k) => [extra.fields?.[k] ?? ''] },
      reply: async (p) => out.push(['reply', p]),
      update: async (p) => out.push(['update', p]),
      deferReply: async () => out.push(['defer']),
      editReply: async (p) => out.push(['edit', p]),
      showModal: async (m) => out.push(['modal', m.toJSON()]),
      message: { edit: async () => out.push(['panel']) },
    };
    return handleDebugInteraction(interaction);
  };
  return { guild, out, click };
}

const walk = (node) => [node, ...(node.components ?? []).flatMap(walk), ...(node.accessory ? [node.accessory] : [])];
const ids = (payload) => walk(payload.components[0].toJSON()).map((c) => c.custom_id).filter(Boolean);
const navPages = (payload) => walk(payload.components[0].toJSON()).find((c) => c.custom_id === 'magi-config:page').options.map((o) => o.value);

test('panneau : activation par le propriétaire, page Débogage, bannière et retour à la normale', async () => {
  const w = world('g-debug');
  const home = panelPage(w.guild);
  assert.ok(ids(home).includes('magi-debug:on:15') && ids(home).includes('magi-debug:on:infini'));
  assert.ok(!navPages(home).includes('debug'));
  await w.click('magi-debug:on:15', { userId: 'intrus' });
  assert.match(w.out.at(-1)[1].content, /réservé au propriétaire/);
  assert.equal(debugActive('g-debug'), false);
  await w.click('magi-debug:on:15');
  assert.equal(debugActive('g-debug'), true);
  const page = w.out.at(-1)[1];
  const json = page.components[0].toJSON();
  assert.equal(json.accent_color, 0xef9f27);
  assert.ok(walk(json).length <= 40);
  assert.equal(new Set(ids(page)).size, ids(page).length);
  assert.match(JSON.stringify(json), /Mode débogage actif/);
  assert.ok(navPages(page).includes('debug'));
  const select = walk(json).find((c) => c.custom_id === 'magi-debug:action');
  assert.equal(select.options.length, Object.keys(ACTIONS).length);
  assert.ok(select.options.length <= 25);
  for (const a of Object.values(ACTIONS)) for (const f of a.fields ?? []) assert.ok(f.label.length <= 45, f.label);
  assert.match(JSON.stringify(panelPage(w.guild).components[0].toJSON()), /Débogage/);
  await w.click('magi-debug:on:infini');
  tickDebug(w.guild.client, Date.now() + 60 * 60_000);
  assert.equal(debugActive('g-debug'), true);
  await w.click('magi-debug:on:15');
  tickDebug(w.guild.client, Date.now() + 16 * 60_000);
  assert.equal(debugActive('g-debug'), false);
  await w.click('magi-debug:on:15');
  await w.click('magi-debug:off');
  assert.equal(debugActive('g-debug'), false);
  assert.equal(w.out.at(-1)[1].components[0].toJSON().accent_color, 0xd65c62);
});

test('action avec fenêtre et confirmation : effacer les infractions d’un membre', async () => {
  const w = world('g-debug2');
  await w.click('magi-debug:on:15');
  recordInfraction('g-debug2', 'yui', 'spam');
  recordInfraction('g-debug2', 'yui', 'spam');
  recordInfraction('g-debug2', 'lea', 'spam');
  await w.click('magi-debug:action', { values: ['infractions'] });
  assert.deepEqual(w.out.slice(-2).map(([kind]) => kind), ['panel', 'modal']);
  await w.click('magi-debug:form:infractions', { fields: { membre: '<@123456789012345678>' } });
  assert.equal(w.out.at(-1)[0], 'edit');
  assert.match(w.out.at(-1)[1].content, /Effacer toutes les infractions de <@123456789012345678>/);
  await w.click('magi-debug:form:infractions', { fields: { membre: '' } });
  const token = w.out.at(-1)[1].components[0].toJSON().components[0].custom_id.split(':')[2];
  await w.click(`magi-debug:ok:${token}`);
  assert.equal(w.out.at(-2)[1].content, 'En cours…');
  assert.equal(w.out.at(-1)[1].content, '3 infractions effacées.');
  assert.equal(recordOf('g-debug2', 'yui').infractions, 0);
  await w.click(`magi-debug:ok:${token}`);
  assert.match(w.out.at(-1)[1].content, /expiré/);
});

test('actions directes : modèles, réglage brut, logs en débogage puis retour', async () => {
  const w = world('g-debug3');
  await w.click('magi-debug:on:15');
  await w.click('magi-debug:form:modeles', { fields: { choix: 'groq' } });
  assert.equal(forcedProvider(), 'groq');
  await w.click('magi-debug:form:modeles', { fields: { choix: 'auto' } });
  assert.equal(forcedProvider(), null);
  setSetting('g-debug3', 'stars_threshold', '7');
  await w.click('magi-debug:form:reglage', { fields: { cle: 'stars_', valeur: '' } });
  assert.match(w.out.at(-1)[1].content, /`stars_threshold` = `7`/);
  await w.click('magi-debug:action', { values: ['logs_debug'] });
  assert.equal(setting('g-debug3', 'log_level'), 'debug');
  setSetting('g-debug3', 'log_level_until', Date.now() - 1);
  tickDebug(w.guild.client);
  assert.equal(setting('g-debug3', 'log_level'), null);
  await w.click('magi-debug:off');
  await w.click('magi-debug:action', { values: ['conversations'] });
  assert.match(w.out.at(-1)[1].content, /désactivé/);
});

test('export puis import de la configuration, sans les données de fonctionnement', () => {
  const guild = { id: 'g-export', name: 'Source' };
  setSetting('g-export', 'stars_threshold', '10');
  setSetting('g-export', 'star:123', '456');
  const data = exportConfig(guild);
  assert.equal(data.settings.stars_threshold, '10');
  assert.equal(data.settings['star:123'], undefined);
  const copy = readConfig(JSON.stringify(data));
  assert.equal(importConfig({ id: 'g-import' }, copy), Object.keys(data.settings).length);
  assert.equal(setting('g-import', 'stars_threshold'), '10');
  assert.throws(() => readConfig('{"a":1}'), /export de configuration MAGI/);
});
