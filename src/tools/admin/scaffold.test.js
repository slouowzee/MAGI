import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { ChannelType } from 'discord.js';

process.env.DB_PATH = ':memory:';
const { diffPlan, missingFromPlan, preview } = await import('./scaffold.js');

const ch = (id, name, type, parentId = null) => ({ id, name, type, parentId, isThread: () => false });
const channels = new Map(
  [ch('c1', '/src/app', ChannelType.GuildCategory), ch('t1', 'index', ChannelType.GuildText, 'c1'), ch('t2', 'annonces', ChannelType.GuildText), ch('v1', 'Général', ChannelType.GuildVoice)].map((c) => [c.id, c]),
);
const roles = new Map([['g', { id: 'g', name: '@everyone', position: 0 }], ['r1', { id: 'r1', name: 'Membre', position: 1 }], ['r2', { id: 'r2', name: 'The MAN', position: 9 }]]);
const guild = { id: 'g', channels: { cache: channels }, roles: { cache: roles }, members: { me: { roles: { highest: { position: 5 } } } } };

test("l'existant est reconnu même renommé avec un emoji : renommage et déplacement, pas de doublon", () => {
  const plan = {
    categories: [
      { nom: '📂 /src/app', existant: '/src/app', salons: [{ nom: '💬・index', type: 'texte' }, { nom: '📢・annonces', type: 'texte' }, { nom: '🚀・projets', type: 'texte' }] },
      { nom: '🔊 /voice', salons: [{ nom: '🔊・général', type: 'vocal' }] },
    ],
    roles: [{ nom: 'The MAN' }, { nom: 'Membre', couleur: '#3498DB' }, { nom: 'Maintainer', permissions: ['gerer_messages', 'administrateur'] }],
  };
  const ops = diffPlan(guild, plan);
  assert.deepEqual(
    ops.map((o) => `${o.kind}:${o.to ?? o.name ?? o.category?.name}`),
    ['renommer:📂 /src/app', 'renommer:💬・index', 'renommer:📢・annonces', 'deplacer:📢・annonces', 'creer_salon:🚀・projets', 'creer_categorie:🔊 /voice', 'renommer:🔊・général', 'deplacer:🔊・général', 'modifier_role:Membre', 'creer_role:Maintainer'],
  );
  assert.deepEqual(ops.at(-1).permissions, ['gerer_messages']);
  assert.match(preview(ops), /~ annonces → 📢・annonces/);
  assert.deepEqual(missingFromPlan(guild, plan), []);
  assert.deepEqual(missingFromPlan(guild, { categories: [], roles: [] }).sort(), ['/src/app', 'Général', 'annonces', 'index']);
});
