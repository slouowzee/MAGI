import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Collection, PermissionsBitField } from 'discord.js';

process.env.DB_PATH = ':memory:';
const { panelPage } = await import('./panel.js');
const { setMutedChannels } = await import('./config.js');

const guild = { id: 'panel-test', client: { user: { id: '1' } }, members: { me: { permissions: new PermissionsBitField() } }, channels: { cache: new Collection() } };

test('un seul panneau, menu de pages, chaque page valide pour Discord', () => {
  setMutedChannels('panel-test', ['111111111111111111']);
  const pages = ['modules', 'personas', 'salons', 'communaute', 'services', 'securite', 'logs', 'permissions'];
  for (const [i, name] of pages.entries()) {
    const { embeds, components } = panelPage(guild, name);
    const embed = embeds[0].toJSON();
    assert.ok(embed.description.length > 0);
    assert.equal(embed.footer.text, `Page ${i + 1}/${pages.length}`);
    assert.ok(components.length <= 5, name);
    for (const row of components) assert.doesNotThrow(() => row.toJSON(), name);
    const [nav] = components[0].toJSON().components;
    assert.equal(nav.custom_id, 'magi-config:page');
    assert.deepEqual(nav.options.map((o) => o.value), pages);
    assert.deepEqual(nav.options.filter((o) => o.default).map((o) => o.value), [name]);
  }
  assert.equal(panelPage(guild).embeds[0].toJSON().title, 'Configuration de MAGI · Modules');
});
