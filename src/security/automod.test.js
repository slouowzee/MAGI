import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { AutoModerationActionType as A, AutoModerationRuleTriggerType as T, Collection, PermissionFlagsBits as P, PermissionsBitField } from 'discord.js';

const { syncAutomod, wantedRules } = await import('./automod.js');
const { setModule, setSettingList } = await import('../server/config.js');
const { setSetting } = await import('../storage/settings.js');

function fakeGuild(id, perms, existing = []) {
  const calls = [];
  const rule = (data) => ({ ...data, edit: async (o) => calls.push(['edit', data.name, o]), delete: async () => calls.push(['delete', data.name]) });
  const honeypot = { id: 'hp' };
  const guild = {
    id,
    client: { user: { id: 'magi' } },
    members: { me: { permissions: new PermissionsBitField(perms) } },
    channels: { cache: new Collection([['hp', honeypot]]) },
    autoModerationRules: {
      fetch: async () => new Collection(existing.map((r, i) => [String(i), rule(r)])),
      create: async (o) => calls.push(['create', o.name, o]),
    },
  };
  setSetting(id, 'honeypot', 'hp');
  return { guild, calls };
}

test('AutoMod : règles voulues, filtres choisis, honeypot exempté, exclusion seulement si permise', () => {
  const { guild } = fakeGuild('g-am', [P.ManageGuild]);
  setSettingList('g-am', 'automod_presets', ['injures']);
  const rules = wantedRules(guild);
  assert.deepEqual(rules.map((r) => r.name), ['MAGI · Filtres', 'MAGI · Mentions', 'MAGI · Spam', 'MAGI · Arnaques']);
  assert.deepEqual(rules[0].triggerMetadata.presets, [3]);
  assert.equal(rules[1].triggerMetadata.mentionTotalLimit, 5);
  assert.deepEqual(rules[0].exemptChannels, ['hp']);
  assert.ok(rules.every((r) => !r.actions.some((a) => a.type === A.Timeout)));
  const { guild: strict } = fakeGuild('g-am2', [P.ManageGuild, P.ModerateMembers]);
  assert.ok(wantedRules(strict)[3].actions.some((a) => a.type === A.Timeout));
});

test('AutoMod : crée, met à jour, garde la règle spam existante, supprime quand coupé', async () => {
  const existing = [
    { name: 'MAGI · Filtres', creatorId: 'magi', triggerType: T.KeywordPreset },
    { name: 'Spam du propriétaire', creatorId: 'owner', triggerType: T.Spam },
  ];
  const { guild, calls } = fakeGuild('g-sync', [P.ManageGuild], existing);
  setModule('g-sync', 'automod', true);
  await syncAutomod(guild);
  assert.deepEqual(calls.map(([kind, name]) => `${kind} ${name}`), ['edit MAGI · Filtres', 'create MAGI · Mentions', 'create MAGI · Arnaques']);
  assert.equal(calls[0][2].triggerType, undefined);

  calls.length = 0;
  setModule('g-sync', 'automod', false);
  await syncAutomod(guild);
  assert.deepEqual(calls.map(([kind, name]) => `${kind} ${name}`), ['delete MAGI · Filtres']);

  const { guild: weak, calls: none } = fakeGuild('g-weak', []);
  setModule('g-weak', 'automod', true);
  await syncAutomod(weak);
  assert.deepEqual(none, []);
});
