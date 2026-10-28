import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createTracker, detect, hosts } from './detect.js';

test('liens d’arnaque imitant Discord, Steam ou Nitro : flagrant', () => {
  assert.equal(detect({ content: 'FREE NITRO 🎁 https://discord-gift.ru/claim' }).level, 'flagrant');
  assert.equal(detect({ content: 'free https://dlscord.com/nitro' }).level, 'flagrant');
  assert.equal(detect({ content: 'trade https://steamcommunlty.com/tradeoffer' }).level, 'flagrant');
  assert.equal(detect({ content: 'regarde https://discord.com/channels/1/2' }), null);
  assert.equal(detect({ content: 'mon cadeau https://discord.gift/abc' }), null);
  assert.equal(detect({ content: 'le guide https://discordjs.guide/ et https://nitro.build' }), null);
  assert.equal(detect({ content: 'mon bot sur https://discord-bot-list.example' }), null);
});

test('messages normaux : rien à signaler', () => {
  assert.equal(detect({ content: "quelqu'un est chaud pour une game ce soir ?" }), null);
  assert.equal(detect({ content: 'la doc est ici https://bun.sh/docs', accountAge: 400 * 86_400_000, memberAge: 30 * 86_400_000 }), null);
});

test('signaux suspects : invitations, cadeaux, mentions, rafales, comptes récents', () => {
  assert.equal(detect({ content: 'rejoins discord.gg/abcdef' }).level, 'suspect');
  assert.equal(detect({ content: 'airdrop gratuit https://crypto-x100.io' }).level, 'suspect');
  assert.equal(detect({ content: 'hey', mentionCount: 6 }).level, 'suspect');
  assert.equal(detect({ content: 'hey', mentionCount: 12 }).level, 'flagrant');
  assert.equal(detect({ content: 'yo', activity: { burst: 7, duplicateChannels: 1 } }).level, 'suspect');
  assert.equal(detect({ content: 'https://bun.sh', accountAge: 3_600_000 }).level, 'suspect');
});

test('même message dans plusieurs salons en peu de temps : flagrant', () => {
  const track = createTracker();
  track('u', 'a', 'Achetez mes crypto maintenant', 0);
  track('u', 'b', 'achetez   mes crypto maintenant', 10_000);
  const activity = track('u', 'c', 'Achetez mes crypto maintenant', 20_000);
  assert.equal(activity.duplicateChannels, 3);
  assert.equal(detect({ content: 'Achetez mes crypto maintenant', activity }).level, 'flagrant');
  assert.equal(track('u', 'd', 'Achetez mes crypto maintenant', 500_000).duplicateChannels, 1);
});

test('extraction des domaines', () => {
  assert.deepEqual(hosts('voir https://www.Discord.com/x et http://a.b.ru:8080/y'), ['discord.com', 'a.b.ru']);
});

test('barème : avertissement, exclusion 1 h, puis exclusion 24 h et vote ; flagrant = exclusion immédiate', async () => {
  process.env.DB_PATH = ':memory:';
  const { decide } = await import('./index.js');
  assert.deepEqual(decide('suspect', 1), { label: 'suppression + avertissement', warn: true });
  assert.equal(decide('suspect', 2).timeout, 3_600_000);
  assert.equal(decide('suspect', 3).vote, true);
  assert.equal(decide('suspect', 3).timeout, 24 * 3_600_000);
  assert.equal(decide('flagrant', 1).timeout, 3_600_000);
});

test('insultes fortes : suspect, le LLM juge selon le contexte', () => {
  assert.equal(detect({ content: "Nan c'est ta mère qui les a lâché pendant que je la baisais" }).level, 'suspect');
  assert.deepEqual(detect({ content: 'Encule ta pote' }).reasons, ['insulte ou propos grossier']);
  assert.equal(detect({ content: 'FTG' }).level, 'suspect');
  assert.equal(detect({ content: 'tu peux me passer la photo de ta maison ?' }), null);
  assert.equal(detect({ content: 'il faut que je baisse le son' }), null);
});

test('membre récent : les liens Discord et les gifs ne sont pas suspects', () => {
  const recent = { memberAge: 3_600_000 };
  assert.equal(detect({ content: 'https://cdn.discordapp.com/attachments/1/2/ezgif.gif', ...recent }), null);
  assert.equal(detect({ content: 'https://tenor.com/view/chat-123', ...recent }), null);
  assert.equal(detect({ content: 'https://media.discordapp.net/x.png https://inconnu.example', ...recent }).level, 'suspect');
});
