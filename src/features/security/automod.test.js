import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { AutoModerationActionType as A, AutoModerationRuleTriggerType as T, Collection, PermissionFlagsBits as P, PermissionsBitField } from 'discord.js';

const { FAMILIES, lockedRule, setAutomodAllowList, setAutomodRules, syncAutomod, wantedRules } = await import('./automod.js');
const { setModule, setSettingList } = await import('../../core/config.js');
const { setSetting } = await import('../../core/settings.js');
const { panelPage } = await import('../../panel/index.js');

function fakeGuild(id, perms, existing = []) {
  const calls = [];
  const rule = (data) => ({ ...data, edit: async (o) => calls.push(['edit', data.name, o]), delete: async () => calls.push(['delete', data.name]) });
  const guild = {
    id,
    client: { user: { id: 'magi' } },
    members: { me: { permissions: new PermissionsBitField(perms) } },
    channels: { cache: new Collection([['hp', { id: 'hp' }]]) },
    autoModerationRules: {
      fetch: async () => new Collection(existing.map((r, i) => [String(i), rule(r)])),
      create: async (o) => calls.push(['create', o.name, o]),
    },
  };
  setSetting(id, 'honeypot', 'hp');
  return { guild, calls };
}

const matches = (family, text) => (FAMILIES[family].regex ?? []).some((p) => new RegExp(p, 'i').test(text));

test('familles d’arnaques : attrapent les arnaques, laissent passer les conversations', () => {
  assert.ok(matches('recrutement', 'Looking for 5 people, earn $500 a day, only 2 hours a day'));
  assert.ok(matches('recrutement', 'I need someone to rent your Upwork account, payment weekly'));
  assert.ok(matches('recrutement', 'tu gagnes 300€ par jour depuis chez toi'));
  assert.ok(!matches('recrutement', 'je bosse sur upwork depuis deux ans'));
  assert.ok(!matches('recrutement', "j'ai gagné 50 xp par jour"));
  assert.ok(matches('giveaways', 'MrBeast is doing a $2500 giveaway, claim your reward'));
  assert.ok(matches('giveaways', 'first 50 people get free nitro'));
  assert.ok(!matches('giveaways', 't’as vu la dernière vidéo de mr beast ?'));
  assert.ok(matches('crypto', 'enter your seed phrase to validate your wallet'));
  assert.ok(!matches('crypto', 'le bitcoin a encore baissé'));
  assert.ok(matches('support', 'Hey, I accidentally reported your account, contact this admin'));
  assert.ok(matches('support', "j'ai signalé ton compte par erreur"));
  assert.ok(matches('adulte', 'hot girls waiting for you discord.gg/xxxx'));
  assert.ok(!matches('adulte', 'a bunch of free stuff'));
});

test('AutoMod : règles voulues, choix des familles, honeypot exempté, exclusion seulement si permise', () => {
  const { guild } = fakeGuild('g-am', [P.ManageGuild]);
  setSettingList('g-am', 'automod_presets', ['injures']);
  const rules = wantedRules(guild);
  assert.deepEqual(rules.map((r) => r.name), ['MAGI · Filtres', 'MAGI · Mentions', 'MAGI · Spam', 'MAGI · Faux recrutement', 'MAGI · Faux giveaways', 'MAGI · Arnaques crypto', 'MAGI · Faux support', 'MAGI · Bots 18+', 'MAGI · Nitro et faux domaines', 'MAGI · Pseudos suspects']);
  assert.deepEqual(rules[0].triggerMetadata.presets, [3]);
  assert.equal(rules[1].triggerMetadata.mentionTotalLimit, 5);
  assert.deepEqual(rules[0].exemptChannels, ['hp']);
  assert.ok(rules[3].triggerMetadata.regexPatterns.every((p) => p.startsWith('(?i)') && p.length <= 260));
  assert.deepEqual(rules.at(-1).actions.map((a) => a.type), [A.BlockMemberInteraction]);
  assert.ok(rules.every((r) => !r.actions.some((a) => a.type === A.Timeout)));
  const { guild: strict } = fakeGuild('g-am2', [P.ManageGuild, P.ModerateMembers]);
  assert.ok(wantedRules(strict)[3].actions.some((a) => a.type === A.Timeout));

  setAutomodRules('g-am', ['crypto']);
  setAutomodAllowList('g-am', 'seed phrase, wallet\nseed phrase');
  const few = wantedRules(guild);
  assert.deepEqual(few.map((r) => r.name).slice(3), ['MAGI · Arnaques crypto']);
  assert.deepEqual(few[3].triggerMetadata.allowList, ['seed phrase', 'wallet']);
  setAutomodRules('g-am', []);
  assert.equal(wantedRules(guild).length, 3);
});

test('AutoMod : crée, met à jour, reprend la règle de mentions existante, supprime quand coupé', async () => {
  const existing = [
    { name: 'MAGI · Filtres', creatorId: 'magi', triggerType: T.KeywordPreset },
    { name: 'Block Mention Spam', creatorId: 'owner', triggerType: T.MentionSpam, enabled: true },
  ];
  const { guild, calls } = fakeGuild('g-sync', [P.ManageGuild], existing);
  setModule('g-sync', 'automod', true);
  setAutomodRules('g-sync', ['nitro']);
  await syncAutomod(guild);
  assert.deepEqual(calls.map(([kind, name]) => `${kind} ${name}`), ['edit MAGI · Filtres', 'edit Block Mention Spam', 'create MAGI · Spam', 'create MAGI · Nitro et faux domaines']);
  assert.equal(calls[1][2].name, 'MAGI · Mentions');
  assert.equal(calls[0][2].triggerType, undefined);

  calls.length = 0;
  setModule('g-sync', 'automod', false);
  await syncAutomod(guild);
  assert.deepEqual(calls.map(([kind, name]) => `${kind} ${name}`), ['delete MAGI · Filtres']);

  const locked = { name: 'Block Mention Spam', creatorId: 'owner', triggerType: T.MentionSpam, enabled: false };
  const { guild: community, calls: tried } = fakeGuild('g-community', [P.ManageGuild], [locked]);
  community.autoModerationRules.fetch = async () => new Collection([['0', { ...locked, edit: async () => { throw Object.assign(new Error('404: Not Found'), { status: 404 }); } }]]);
  setModule('g-community', 'automod', true);
  await syncAutomod(community);
  assert.ok(!tried.some(([, name]) => name === 'MAGI · Mentions'));
  assert.equal(lockedRule('g-community', T.MentionSpam), 'Block Mention Spam');
  assert.ok(JSON.stringify(panelPage(community, 'automod').components[0].toJSON()).includes('verrouillée par Discord'));

  const { guild: weak, calls: none } = fakeGuild('g-weak', []);
  setModule('g-weak', 'automod', true);
  await syncAutomod(weak);
  assert.deepEqual(none, []);
});
