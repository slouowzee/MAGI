import { test } from 'bun:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { findPublication, savePublication } = await import('./publications.js');

test('retrouver une publication par lien, titre ou par défaut la dernière', () => {
  savePublication({ guildId: 'g', channelId: '111111111111111111', messageId: '222222222222222222', title: 'Règlement' }, 1);
  savePublication({ guildId: 'g', channelId: '111111111111111111', messageId: '333333333333333333', title: 'Annonce tournoi' }, 2);
  assert.equal(findPublication('g', '').title, 'Annonce tournoi');
  assert.equal(findPublication('g', 'https://discord.com/channels/9/111111111111111111/222222222222222222').title, 'Règlement');
  assert.equal(findPublication('g', 'tournoi').message_id, '333333333333333333');
  assert.equal(findPublication('g', 'introuvable'), null);
  assert.equal(findPublication('autre', ''), null);
});
