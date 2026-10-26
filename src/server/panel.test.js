import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Collection, PermissionsBitField } from 'discord.js';

process.env.DB_PATH = ':memory:';
const { panelPage } = await import('./panel.js');
const { setMutedChannels } = await import('./config.js');

const guild = { id: 'panel-test', client: { user: { id: '1' } }, members: { me: { permissions: new PermissionsBitField() } }, channels: { cache: new Collection() } };

test('un seul panneau à pages, chaque page valide pour Discord', () => {
  setMutedChannels('panel-test', ['111111111111111111']);
  const pages = ['modules', 'salons', 'logs', 'securite', 'permissions'];
  for (const [i, name] of pages.entries()) {
    const { embeds, components } = panelPage(guild, name);
    const embed = embeds[0].toJSON();
    assert.ok(embed.description.length > 0);
    assert.equal(embed.footer.text, `Page ${i + 1}/5`);
    assert.ok(components.length <= 5, name);
    for (const row of components) assert.doesNotThrow(() => row.toJSON(), name);
    const nav = components[0].toJSON().components;
    assert.deepEqual(nav.map((b) => b.custom_id), pages.map((p) => `magi-config:page:${p}`));
    assert.deepEqual(nav.filter((b) => b.disabled).map((b) => b.custom_id), [`magi-config:page:${name}`]);
  }
  assert.equal(panelPage(guild).embeds[0].toJSON().title, 'Configuration de MAGI · Modules');
});
