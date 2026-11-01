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
  const detach = addSink((e) => e.component === 'outils' && seen.push([e.message, e.level]));
  const tools = [
    { name: 'lire', access: 'everyone', readonly: true, run: async () => 'lu' },
    { name: 'agir', access: 'everyone', run: async () => 'fait' },
  ];
  const member = { id: 'm', user: { tag: 'slou' }, guild: { id: 'g-outils', name: 'G' }, toString: () => '<@m>' };
  const ctx = { member, message: { channel: { name: 'test' } } };
  await runTool({ name: 'lire', args: {} }, ctx, tools);
  await runTool({ name: 'agir', args: {} }, ctx, tools);
  detach();
  assert.deepEqual(seen, [['<@m> a utilisé **lire** : lu', 'info'], ['<@m> a utilisé **agir** : fait', 'notice']]);
});

test('outils : les consignes destinées au modèle ne finissent pas dans les logs', async () => {
  const { addSink } = await import('./core/log/log.js');
  const { runTool } = await import('./tools.js');
  const seen = [];
  const detach = addSink((e) => e.component === 'outils' && seen.push(e.message));
  const tools = [{ name: 'rappel', access: 'everyone', run: async () => 'Rappel n°3 enregistré, il tombera à 15:12. Confirme en une phrase et recopie ce format tel quel.' }];
  const member = { id: 'm', user: { tag: 'slou' }, guild: { id: 'g-outils2', name: 'G' }, toString: () => '<@m>' };
  await runTool({ name: 'rappel', args: {} }, { member, message: { channel: { name: 'test' } } }, tools);
  detach();
  assert.deepEqual(seen, ['<@m> a utilisé **rappel** : Rappel n°3 enregistré, il tombera à 15:12.']);
});

test('confirmation : facultative selon le label, droits revérifiés au clic', async () => {
  const conditional = { name: 'conditionnel', access: 'everyone', confirm: ({ args }) => (args.risque ? 'Confirmer' : null), run: async () => 'fait' };
  const reservedLater = { name: 'module_coupe', access: 'operator', confirm: () => 'Confirmer', run: async () => 'fait' };
  const actions = [];
  const owner = member('owner');
  assert.equal(await runTool({ name: 'conditionnel', args: {} }, { member: owner, message: {}, actions }, [conditional]), 'fait');
  assert.equal(actions.length, 0);
  assert.match(await runTool({ name: 'conditionnel', args: { risque: true } }, { member: owner, message: {}, actions }, [conditional]), /bouton de confirmation/);
  assert.equal(actions[0].allowed(owner), true);
  assert.equal(actions[0].allowed(member('lea')), false);
  assert.equal(canUse(reservedLater, owner), false);
});

test('les outils qui touchent aux droits et aux sanctions demandent une confirmation', async () => {
  const { TOOLS } = await import('./tools.js');
  for (const name of ['exclure_temporairement', 'lever_exclusion', 'debannir', 'donner_role', 'retirer_role', 'permissions_salon', 'creer_role', 'modifier_role', 'mode_moderation', 'annuler_sanction', 'palier_synchro']) assert.ok(TOOLS.find((t) => t.name === name).confirm, name);
});
