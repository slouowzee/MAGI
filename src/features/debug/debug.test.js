import { test } from 'bun:test';
import assert from 'node:assert/strict';

const { consolePayload, debugActive, handleDebugInteraction, restoreLogLevels } = await import('./console.js');
const { ACTIONS } = await import('./actions.js');
const { exportConfig, importConfig, readConfig } = await import('./config.js');
const { recordInfraction, recordOf } = await import('../moderation/store.js');
const { setSetting, setting } = await import('../../core/settings.js');
const { forcedProvider } = await import('../../core/llm/client.js');

function world(id) {
  const guild = { id, name: 'Test', ownerId: 'owner', channels: { cache: new Map() }, roles: { cache: new Map() }, members: { cache: new Map() }, client: { user: { id: 'magi' }, guilds: { cache: new Map() } } };
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
      fields: { getTextInputValue: (k) => extra.fields?.[k] ?? '' },
      reply: async (p) => out.push(['reply', p]),
      update: async (p) => out.push(['update', p]),
      deferReply: async () => out.push(['defer']),
      editReply: async (p) => out.push(['edit', p]),
      showModal: async (m) => out.push(['modal', m.toJSON()]),
    };
    return handleDebugInteraction(interaction);
  };
  return { guild, out, click };
}

const count = (node) => 1 + (node.components ?? []).reduce((n, c) => n + count(c), 0) + (node.accessory ? 1 : 0);

test('console : réservée au propriétaire, activation, 25 actions dans les limites de Discord', async () => {
  const w = world('g-debug');
  await w.click('magi-debug:on', { userId: 'intrus' });
  assert.match(w.out.at(-1)[1].content, /réservé au propriétaire/);
  assert.equal(debugActive('g-debug'), false);
  await w.click('magi-debug:on');
  assert.equal(debugActive('g-debug'), true);
  const json = consolePayload(w.guild).components[0].toJSON();
  assert.ok(count(json) <= 40);
  const select = json.components.find((c) => c.type === 1 && c.components[0].type === 3).components[0];
  assert.equal(select.options.length, Object.keys(ACTIONS).length);
  assert.ok(select.options.length <= 25);
  for (const a of Object.values(ACTIONS)) for (const f of a.fields ?? []) assert.ok(f.label.length <= 45, f.label);
});

test('action avec fenêtre et confirmation : effacer les infractions d’un membre', async () => {
  const w = world('g-debug2');
  await w.click('magi-debug:on');
  recordInfraction('g-debug2', 'yui', 'spam');
  recordInfraction('g-debug2', 'yui', 'spam');
  recordInfraction('g-debug2', 'lea', 'spam');
  await w.click('magi-debug:action', { values: ['infractions'] });
  assert.equal(w.out.at(-1)[0], 'modal');
  await w.click('magi-debug:form:infractions', { fields: { membre: '<@123456789012345678>' } });
  assert.equal(w.out.at(-1)[0], 'reply');
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
  await w.click('magi-debug:on');
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
  restoreLogLevels(w.guild.client);
  assert.equal(setting('g-debug3', 'log_level'), null);
  await w.click('magi-debug:off');
  await w.click('magi-debug:action', { values: ['conversations'] });
  assert.match(w.out.at(-1)[1].content, /coupé/);
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
