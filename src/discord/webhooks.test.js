import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { personaOf, replyHeader, speak } from './webhooks.js';

const client = { application: { id: 'magi' } };
const msg = (username, { webhookId = 'wh', applicationId = 'magi' } = {}) => ({ webhookId, applicationId, client, author: { username } });

test('reconnaît les personas de MAGI, y compris sous leur ancien nom', () => {
  assert.equal(personaOf(msg('Casper')), 'casper');
  assert.equal(personaOf(msg('BALTHASAR-2')), 'balthasar');
  assert.equal(personaOf(msg('Inconnu')), null);
});

test("ignore les webhooks d'autres applications et les messages ordinaires", () => {
  assert.equal(personaOf(msg('Casper', { applicationId: 'pluralkit' })), null);
  assert.equal(personaOf(msg('Casper', { applicationId: null })), null);
  assert.equal(personaOf(msg('Casper', { webhookId: null })), null);
});

function fakeChannel(id, existing = []) {
  const calls = [];
  const channel = {
    id,
    calls,
    isThread: () => false,
    client: { user: { id: 'bot' } },
    fetchWebhooks: async () => new Collection(existing.map((wh) => [wh.name, wh])),
    createWebhook: async ({ name }) => {
      calls.push(`create ${name}`);
      return { name, send: async ({ content }) => calls.push(`send ${content}`) };
    },
  };
  return channel;
}

test('un seul webhook créé pour des envois simultanés', async () => {
  const channel = fakeChannel('salon-simultane');
  await Promise.all([speak(channel, 'casper', 'a'), speak(channel, 'casper', 'b')]);
  assert.equal(channel.calls.filter((c) => c.startsWith('create')).length, 1);
});

test('les anciens webhooks sont supprimés une fois, avant la création', async () => {
  let channel;
  const old = {
    name: 'MAGI CASPER-3 v12',
    owner: { id: 'bot' },
    delete: async () => {
      await Promise.resolve();
      channel.calls.push('delete');
    },
  };
  channel = fakeChannel('salon-ancien', [old]);
  await Promise.all([speak(channel, 'casper', 'a'), speak(channel, 'melchior', 'b')]);
  assert.equal(channel.calls[0], 'delete');
  assert.equal(channel.calls.filter((c) => c === 'delete').length, 1);
});

test("l'en-tête de réponse mentionne l'auteur et renvoie au message, sans lien brut ni crochets", () => {
  const msg = { author: { id: '42' }, content: 'regarde [ça] https://exemple.fr/une-page-tres-longue', url: 'https://discord.com/channels/1/2/3' };
  assert.equal(replyHeader(msg), '-# ↪ <@42> [regarde ça lien](https://discord.com/channels/1/2/3)');
  const long = replyHeader({ ...msg, content: 'x'.repeat(80) });
  assert.match(long, /\[x{50}…\]/);
});
