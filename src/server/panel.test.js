import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Collection, PermissionsBitField } from 'discord.js';

process.env.DB_PATH = ':memory:';
const { panelSection } = await import('./panel.js');
const { setMutedChannels } = await import('./config.js');

const guild = { id: 'panel-test', client: { user: { id: '1' } }, members: { me: { permissions: new PermissionsBitField() } }, channels: { cache: new Collection() } };

test('les quatre sections du panneau sont valides pour Discord', () => {
  setMutedChannels('panel-test', ['111111111111111111']);
  for (const name of ['permissions', 'modules', 'salons', 'securite']) {
    const { embeds, components } = panelSection(guild, name);
    assert.ok(embeds[0].toJSON().description.length > 0);
    for (const row of components) assert.doesNotThrow(() => row.toJSON(), name);
  }
});
