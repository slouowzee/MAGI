import { test } from 'bun:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { canUse, runTool, schemas, toolsFor } = await import('./tools.js');

const guild = { id: 'g', ownerId: 'owner', roles: { cache: new Map() }, members: { me: { roles: { highest: { position: 5 } } } } };
const member = (id) => ({ id, guild, displayName: id, user: { tag: id }, roles: { cache: new Map() } });

const fake = [
  { name: 'pour_tous', access: 'everyone', run: async ({ args }) => `ok ${args.x}` },
  { name: 'pour_proprio', access: 'owner', run: async () => 'proprio' },
  { name: 'pour_operateur', access: 'operator', run: async () => 'op' },
];

test('accès selon le rôle', () => {
  assert.deepEqual(toolsFor(member('owner'), fake).map((t) => t.name), ['pour_tous', 'pour_proprio']);
  assert.deepEqual(toolsFor(member('membre'), fake).map((t) => t.name), ['pour_tous']);
  assert.equal(canUse(fake[2], member('owner')), false);
});

test('le code refuse un outil interdit même si le LLM le demande', async () => {
  const output = await runTool({ name: 'pour_proprio', args: {} }, { member: member('membre'), message: {} }, fake);
  assert.match(output, /^Refusé/);
  assert.match(await runTool({ name: 'inexistant', args: {} }, { member: member('owner'), message: {} }, fake), /^Outil inconnu/);
});

test('schéma transmis au LLM', () => {
  assert.deepEqual(schemas([{ name: 'a', description: 'd', parameters: { type: 'object', properties: {} }, access: 'owner', run() {} }]), [
    { type: 'function', function: { name: 'a', description: 'd', parameters: { type: 'object', properties: {} } } },
  ]);
});

test("rapport d'état de l'installation", async () => {
  const { statusReport } = await import('./core/installation.js');
  const steps = [
    { step: 'rôle créé', done: true, manual: false },
    { step: 'salon créé', done: false, manual: false },
    { step: 'hiérarchie', done: false, manual: true },
  ];
  assert.equal(
    statusReport(steps),
    "État de l'installation :\n- fait : rôle créé\n- manquant : salon créé\n- manquant : hiérarchie (à faire à la main)\nLes étapes non manuelles peuvent être faites par l'outil installer_magi, après accord de la personne.",
  );
  assert.match(statusReport([{ step: 'hiérarchie', done: false, manual: true }]), /Il ne reste que l'étape manuelle/);
  assert.match(statusReport([{ step: 'x', done: true, manual: false }]), /^Installation complète/);
});

test('outils : lectures notées en info, actions en notice', async () => {
  const { addSink } = await import('./core/log/log.js');
  const { runTool } = await import('./tools.js');
  const seen = [];
  const detach = addSink((e) => e.component === 'outils' && seen.push([e.message.split(' ')[0], e.level]));
  const tools = [
    { name: 'lire', access: 'everyone', readonly: true, run: async () => 'lu' },
    { name: 'agir', access: 'everyone', run: async () => 'fait' },
  ];
  const member = { id: 'm', user: { tag: 'slou' }, guild: { id: 'g-outils', name: 'G' } };
  const ctx = { member, message: { channel: { name: 'test' } } };
  await runTool({ name: 'lire', args: {} }, ctx, tools);
  await runTool({ name: 'agir', args: {} }, ctx, tools);
  detach();
  assert.deepEqual(seen, [['lire', 'info'], ['agir', 'notice']]);
});
