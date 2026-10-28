import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { MessageFlags } from 'discord.js';
import { handleInteraction, registerAction, takeAction } from './buttons.js';

const owner = { id: 'owner' };
const action = { label: 'Compléter', allowed: (m) => m.id === 'owner', refusal: 'Réservé au propriétaire.', run: async () => 'fait' };

test('seule la personne autorisée peut utiliser le bouton, une seule fois', () => {
  const id = registerAction(action, 0);
  assert.deepEqual(takeAction(id, { id: 'lea' }, 1_000), { error: 'Réservé au propriétaire.' });
  assert.equal(takeAction(id, owner, 1_000).action.label, 'Compléter');
  assert.match(takeAction(id, owner, 2_000).error, /expiré/);
});

test('le bouton expire après 15 minutes', () => {
  const id = registerAction(action, 0);
  assert.match(takeAction(id, owner, 16 * 60_000).error, /expiré/);
});

test('une action de nettoyage efface la demande et la réponse, et répond en privé', async () => {
  const deleted = [];
  const replies = [];
  const id = registerAction({ ...action, cleanup: { delete: async () => deleted.push('demande') } });
  await handleInteraction({
    isButton: () => true,
    customId: `magi:${id}`,
    member: owner,
    update: async () => {},
    followUp: async (payload) => replies.push(payload),
    message: { delete: async () => deleted.push('réponse') },
  });
  assert.deepEqual(deleted.sort(), ['demande', 'réponse']);
  assert.equal(replies[0].flags, MessageFlags.Ephemeral);
});
