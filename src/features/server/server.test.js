import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { ChannelType, PermissionFlagsBits as P } from 'discord.js';

const { diffPlan, missingFromPlan, preview } = await import('./plan.js');
const { styleName } = await import('./styles.js');
const { accessOverwrites, rollback, sortOps } = await import('./apply.js');
const { auditStructure } = await import('./audit.js');
const { setSetting } = await import('../../core/settings.js');

const libre = { preset: 'libre', mode: 'restyler', separator: 'point', casing: 'libre', decor: 'libre', emoji: true, english: false };
const everyone = { id: 'g' };
const perms = (deny = []) => ({ has: (p) => !deny.includes(p) });
const ch = (id, name, type, parentId = null, deny = []) => ({ id, name, type, parentId, isThread: () => false, rawPosition: 0, permissionsFor: () => perms(deny), permissionOverwrites: { cache: new Map() } });
const channels = new Map(
  [ch('c1', '/src/app', ChannelType.GuildCategory), ch('t1', 'index', ChannelType.GuildText, 'c1'), ch('t2', 'annonces', ChannelType.GuildText), ch('v1', 'Général', ChannelType.GuildVoice)].map((c) => [c.id, c]),
);
const roles = new Map([['g', { id: 'g', name: '@everyone', position: 0 }], ['r1', { id: 'r1', name: 'Membre', position: 1 }], ['r2', { id: 'r2', name: 'The MAN', position: 9 }]]);
const guild = { id: 'g', channels: { cache: channels }, roles: { cache: roles, everyone }, members: { me: { id: 'magi', roles: { highest: { position: 5 } } } } };

test("l'existant est reconnu même renommé avec un emoji : renommage et déplacement, pas de doublon", () => {
  const plan = {
    categories: [
      { nom: '📂 /src/app', existant: '/src/app', salons: [{ nom: '💬・index', type: 'texte' }, { nom: '📢・annonces', type: 'texte', acces: 'lecture', fonction: 'annonces' }, { nom: '🚀・projets', type: 'texte' }] },
      { nom: '🔊 /voice', salons: [{ nom: '🔊・général', type: 'vocal', places: 5 }] },
    ],
    roles: [{ nom: 'The MAN' }, { nom: 'Membre', couleur: '#3498DB' }, { nom: 'Maintainer', permissions: ['gerer_messages', 'administrateur'], staff: true }],
  };
  const ops = diffPlan(guild, plan, libre, ['permissions']);
  assert.deepEqual(
    ops.map((o) => `${o.kind}:${o.to ?? o.name ?? o.category?.name ?? o.channel ?? ''}`),
    ['renommer:📂 /src/app', 'renommer:💬・index', 'renommer:📢・annonces', 'deplacer:📢・annonces', 'regler:📢・annonces', 'fonction:📢・annonces', 'creer_salon:🚀・projets', 'creer_categorie:🔊 /voice', 'renommer:🔊・général', 'deplacer:🔊・général', 'regler:🔊・général', 'modifier_role:Membre', 'creer_role:Maintainer', 'ordre_roles:'],
  );
  assert.deepEqual(ops.find((o) => o.kind === 'creer_role').permissions, ['gerer_messages']);
  assert.match(preview(ops), /~ annonces → 📢・annonces/);
  assert.match(preview(ops), /⚙ 📢・annonces : lecture seule/);
  assert.deepEqual(missingFromPlan(guild, plan), []);
  assert.deepEqual(missingFromPlan(guild, { categories: [], roles: [] }).map((c) => c.name).sort(), ['/src/app', 'Général', 'annonces', 'index']);
});

test('modes : compléter ne fait que créer, créer de zéro archive l’ancien', () => {
  const plan = { categories: [{ nom: 'INFOS', salons: [{ nom: 'annonces', existant: 'annonces', type: 'texte' }, { nom: 'règles', type: 'texte', fonction: 'regles' }] }], roles: [{ nom: 'Membre', couleur: '#ffffff' }] };
  const completer = diffPlan(guild, plan, { ...libre, mode: 'completer' }, []);
  assert.deepEqual(completer.map((o) => o.kind), ['creer_categorie', 'creer_salon', 'fonction']);
  const creer = diffPlan(guild, plan, { ...libre, mode: 'creer' }, []);
  assert.deepEqual(creer.filter((o) => o.kind === 'archiver').map((o) => o.name).sort(), ['Général', 'index']);
});

test('nommage : séparateur, casse, décor de catégorie, emoji', () => {
  const style = { ...libre, separator: 'barre', casing: 'capitales', decor: 'lignes' };
  assert.equal(styleName({ nom: 'Discussion générale', emoji: '💬' }, style, 'texte'), '💬┃ᴅɪꜱᴄᴜꜱꜱɪᴏɴ-ɢᴇ\u0301ɴᴇ\u0301ʀᴀʟᴇ');
  assert.equal(styleName({ nom: 'Infos', emoji: '📢' }, style, 'categorie'), '─── 📢 ɪɴꜰᴏꜱ ───');
  assert.equal(styleName({ nom: 'Jeux', emoji: '🎮' }, { ...libre, casing: 'gras', decor: 'sobre' }, 'categorie'), '𝐉𝐄𝐔𝐗');
  assert.equal(styleName({ nom: 'Salon de jeu', emoji: '🎮' }, { ...libre, casing: 'minuscules', decor: 'simple', emoji: false }, 'vocal'), 'salon de jeu');
  assert.equal(styleName({ nom: '🎮・jeux', emoji: '🎮' }, libre, 'texte'), '🎮・jeux');
});

test('accès : lecture seule et staff, le staff et MAGI gardent la main', () => {
  const lecture = accessOverwrites(guild, 'lecture', ['staff1']);
  assert.ok(lecture[0].deny.includes(P.SendMessages) && lecture.some((o) => o.id === 'staff1' && o.allow.includes(P.SendMessages)) && lecture.some((o) => o.id === 'magi'));
  const staff = accessOverwrites(guild, 'staff', ['staff1']);
  assert.ok(staff[0].deny.includes(P.ViewChannel) && staff.some((o) => o.id === 'staff1' && o.allow.includes(P.ViewChannel)));
  assert.equal(accessOverwrites(guild, 'public', []), null);
  assert.deepEqual(sortOps([{ kind: 'contenu' }, { kind: 'creer_salon' }, { kind: 'creer_role' }, { kind: 'fonction' }]).map((o) => o.kind), ['creer_role', 'creer_salon', 'fonction', 'contenu']);
});

test('audit : séparateurs mélangés, doublons, catégorie vide, fuites et annonces ouvertes', () => {
  const rooms = [
    ch('a', '💬・general', ChannelType.GuildText, 'k'),
    ch('b', '💬┃général', ChannelType.GuildText, 'k'),
    ch('c', 'staff', ChannelType.GuildText, 'k'),
    ch('d', '📢・annonces', ChannelType.GuildText, 'k'),
    ch('k', 'TEXTE', ChannelType.GuildCategory),
    ch('e', 'VIDE', ChannelType.GuildCategory),
  ];
  const findings = auditStructure({ ...guild, id: 'g-audit', channels: { cache: new Map(rooms.map((c) => [c.id, c])) } });
  assert.ok(findings.some((f) => f.startsWith('Séparateurs mélangés')));
  assert.ok(findings.some((f) => f.includes('Doublons possibles : 💬・general, 💬┃général')));
  assert.ok(findings.some((f) => f.includes('Catégorie(s) vide(s) : VIDE')));
  assert.ok(findings.some((f) => f.includes('nom de salon privé : staff')));
  assert.ok(findings.some((f) => f.includes('Tout le monde peut écrire dans : 📢・annonces')));
});

test('annulation : défait dans l’ordre inverse et oublie le journal', async () => {
  const done = [];
  const fake = {
    id: 'g-undo',
    channels: { cache: new Map([['x', { id: 'x', delete: async () => done.push('delete x') }], ['y', { id: 'y', setName: async (n) => done.push(`name y ${n}`) }]]) },
    roles: { cache: new Map() },
  };
  setSetting('g-undo', 'server_journal', JSON.stringify({ at: 1, journal: [{ t: 'name', id: 'y', from: 'ancien' }, { t: 'channel', id: 'x' }, { t: 'setting', key: 'stars_channel', before: null }] }));
  setSetting('g-undo', 'stars_channel', 'x');
  assert.match(await rollback(fake, 'test'), /3 étape\(s\)/);
  assert.deepEqual(done, ['delete x', 'name y ancien']);
  assert.match(await rollback(fake, 'test'), /Aucune/);
});

test('un salon de fonction publique n’est jamais caché dans une catégorie staff', () => {
  const plan = { categories: [{ nom: 'STAFF', acces: 'staff', salons: [{ nom: 'tickets', type: 'texte', fonction: 'tickets' }, { nom: 'coulisses', type: 'texte' }] }], roles: [] };
  const ops = diffPlan(guild, plan, { ...libre, mode: 'completer' }, []);
  assert.equal(ops.find((o) => o.name === 'tickets').access, 'lecture');
  assert.equal(ops.find((o) => o.name === 'coulisses').access, null);
});

test('modèles : enregistrer la structure, la retrouver et la réappliquer en complétant', async () => {
  const { saveTemplate, listTemplates, findTemplate, templateOf } = await import('./templates.js');
  const { templatePlan } = await import('./tools.js');
  const ow = (deny) => ({ cache: new Map(deny ? [['g-modele', { deny: { has: (p) => p === deny } }]] : []) });
  const source = {
    ...guild,
    id: 'g-modele',
    name: 'Source',
    channels: {
      cache: new Map([
        ['k', { ...ch('k', 'INFOS', ChannelType.GuildCategory), permissionOverwrites: ow(null) }],
        ['a', { ...ch('a', 'annonces', ChannelType.GuildText, 'k'), permissionOverwrites: ow(P.SendMessages) }],
        ['s', { ...ch('s', 'staff', ChannelType.GuildText, 'k'), permissionOverwrites: ow(P.ViewChannel) }],
      ]),
    },
    roles: { cache: new Map([['g-modele', { id: 'g-modele', name: '@everyone', position: 0 }], ['m', { id: 'm', name: 'Membre', position: 1, managed: false, hoist: true, hexColor: '#3498db', permissions: { has: () => false } }]]), everyone: { id: 'g-modele' } },
  };
  const plan = templateOf(source);
  assert.deepEqual(plan.categories[0].salons.map((s) => `${s.nom}:${s.acces}`), ['annonces:lecture', 'staff:staff']);
  assert.equal(saveTemplate(source, 'Mon modèle'), 'Mon modèle');
  assert.ok(listTemplates().some((t) => t.name === 'Mon modèle'));
  assert.equal(findTemplate('mon modele').from, 'Source');
  const entry = templatePlan(guild, 'Mon modèle');
  assert.ok(entry.ops.some((o) => o.kind === 'creer_categorie' && o.category.name === 'INFOS'));
  assert.ok(entry.ops.every((o) => !['renommer', 'deplacer', 'archiver'].includes(o.kind)));
});
