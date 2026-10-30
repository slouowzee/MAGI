import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';

const { ROLE_TOOLS } = await import('./roles.js');
const tool = (name) => ROLE_TOOLS.find((t) => t.name === name);

function hierarchy() {
  const calls = [];
  const names = ['MAGI', 'Synchro 25%', 'Synchro 50%', 'Synchro 75%', 'Synchro 100%'];
  const roles = new Collection(names.map((name, i) => [`r${i}`, { id: `r${i}`, name, position: names.length - i, managed: name === 'MAGI' }]));
  const guild = { id: 'g-roles', roles: { cache: roles, everyone: { id: 'g-roles', name: '@everyone', position: 0 }, setPositions: async (list) => calls.push(list) }, members: { me: { roles: { highest: roles.get('r0') } } } };
  return { guild, calls, roles };
}

test('ordonner_roles : inverse une série en un appel, garde la même zone, signale ce qui ne bouge pas', async () => {
  const { guild, calls } = hierarchy();
  const wanted = ['Synchro 100%', 'Synchro 75%', 'Synchro 50%', 'Synchro 25%'];
  const result = await tool('ordonner_roles').run({ guild, args: { roles: wanted }, reason: 'test' });
  assert.deepEqual(calls[0], [{ role: 'r4', position: 4 }, { role: 'r3', position: 3 }, { role: 'r2', position: 2 }, { role: 'r1', position: 1 }]);
  assert.match(result, /^Ordre appliqué, du plus haut au plus bas : Synchro 100% > Synchro 75% > Synchro 50% > Synchro 25% \(avant : Synchro 25% > Synchro 50%/);
  assert.match(await tool('ordonner_roles').run({ guild, args: { roles: ['Synchro 25%', 'Synchro 50%'] } }), /^Rien à changer/);
  await assert.rejects(tool('ordonner_roles').run({ guild, args: { roles: ['Synchro 25%', 'MAGI'] } }), /intégration/);
  await assert.rejects(tool('ordonner_roles').run({ guild, args: { roles: ['Synchro 25%', 'Synchro 25%'] } }), /deux fois/);
});

test('deplacer_role : dit quand le rôle était déjà à sa place', async () => {
  const { guild } = hierarchy();
  assert.match(await tool('deplacer_role').run({ guild, args: { role: 'Synchro 25%', au_dessus_de: 'Synchro 50%' } }), /^Rien à changer/);
});
