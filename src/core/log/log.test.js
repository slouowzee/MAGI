import { afterAll, expect, test } from 'bun:test';

process.env.DB_PATH = ':memory:';
const { addSink, log, serverLine, timestamp } = await import('./log.js');
const { deliver, flush, plain, smartLine, sourceOf } = await import('./discord.js');
const { classify, handleLine, reportFailures } = await import('./host.js');
const { db } = await import('../db.js');
const { setSetting } = await import('../settings.js');

const entries = [];
const detach = addSink((entry) => entries.push(entry));
afterAll(detach);

function fakeGuild(id) {
  const sent = {};
  const channel = (name) => {
    const c = { id: `${id}-${name}`, name, send: async (payload) => (sent[name] ??= []).push(payload) };
    return c;
  };
  const channels = ['magi-logs', 'magi-modération', 'magi-sécurité', 'magi-système', 'général'].map(channel);
  const guild = {
    id,
    name: 'Serveur test',
    channels: { cache: new Map(channels.map((c) => [c.id, c])) },
    members: { cache: new Map([['42', { displayName: 'Slou' }]]) },
    roles: { cache: new Map([['7', { name: 'Opérateur MAGI' }]]) },
    client: { users: { cache: new Map() } },
  };
  db.query('INSERT INTO guilds (guild_id, operator_role_id, log_channel_id) VALUES (?, ?, ?)').run(id, '7', `${id}-magi-logs`);
  setSetting(id, 'log_channel:moderation', `${id}-magi-modération`);
  setSetting(id, 'log_channel:securite', `${id}-magi-sécurité`);
  setSetting(id, 'log_channel:systeme', `${id}-magi-système`);
  return { guild, sent, general: guild.channels.cache.get(`${id}-général`) };
}

test('ligne serveur au format syslog, heure de Paris', () => {
  const at = new Date('2026-10-26T13:24:01Z');
  expect(timestamp(at)).toBe('2026-10-26T14:24:01+01:00');
  expect(timestamp(new Date('2026-07-14T10:00:00Z'))).toBe('2026-07-14T12:00:00+02:00');
  const line = serverLine({ at, host: 'magi', component: 'conversation', level: 'info', guild: { name: 'Slou' }, channel: { name: 'général' }, message: 'slou → casper' });
  expect(line).toBe('2026-10-26T14:24:01+01:00 magi conversation: info: [Slou #général] slou → casper');
  expect(serverLine({ at, host: 'magi', component: 'llm', level: 'err', message: 'HTTP 503 : [{\n  "code": 503\n}]' })).toEndWith('llm: err: HTTP 503 : [{ "code": 503 }]');
});

test('les sources Discord suivent le composant', () => {
  expect([sourceOf('moderation'), sourceOf('sshd'), sourceOf('antinuke'), sourceOf('config'), sourceOf('llm'), sourceOf('kernel')]).toEqual(['moderation', 'securite', 'securite', 'logs', 'systeme', 'systeme']);
});

test('sur Discord : lignes lisibles, heure locale, icône, erreurs expliquées', async () => {
  const { guild } = fakeGuild('g-texte');
  expect(plain('**Ban** de <@42> par <@&7>, arrivé le <t:1793021041>', guild)).toBe('Ban de @Slou par @Opérateur MAGI, arrivé le 2026-10-26 14:24');
  const at = new Date('2026-10-26T13:24:01Z');
  expect(smartLine({ at, host: 'magi', component: 'tickets', level: 'notice', message: '<@1> a ouvert un ticket' })).toBe('🎫 <@1> a ouvert un ticket');
  expect(smartLine({ at, host: 'magi', component: 'moderation', level: 'err', message: 'échec exclusion : Unknown Member' })).toBe('❌ **moderation** · échec exclusion : Unknown Member *(le membre a déjà quitté le serveur)*');
  expect(smartLine({ at, host: 'vps', component: 'sudo', level: 'notice', message: '# titre' })).toBe('🔐 **vps sudo** · \\# titre');
  expect(smartLine({ at, host: 'magi', component: 'membres', level: 'notice', message: 'yui est partie · membre depuis peu' })).toContain('🚶');
  const { guild: g, sent } = fakeGuild('g-blanc');
  await deliver(g, { at, host: 'magi', level: 'err', component: 'llm', message: 'a\nb', guild: g, channel: null, mention: null });
  await flush('g-blanc-magi-système');
  expect(sent['magi-système'][0].embeds).toEqual([{ description: '❌ **llm** · a\nb', color: 0xe24b4a, timestamp: '2026-10-26T13:24:01.000Z' }]);
});

test('sur Discord : regroupées par salon, répétitions comptées, sous le seuil ignorées', async () => {
  const { guild, sent, general } = fakeGuild('g-lots');
  const entry = (level, component, message) => ({ at: new Date(), host: 'magi', level, component, message, guild, channel: general, mention: null });
  await deliver(guild, entry('notice', 'outils', 'personas → casper'));
  await deliver(guild, entry('warning', 'llm', 'gemini lent'));
  await deliver(guild, entry('warning', 'llm', 'gemini lent'));
  await deliver(guild, entry('info', 'conversation', 'trop détaillé'));
  await deliver(guild, { ...entry('notice', 'outils', 'invisible'), quiet: true });
  await flush(`g-lots-magi-logs`);
  await flush(`g-lots-magi-système`);
  const text = (name, i = 0) => sent[name][i].embeds.map((e) => e.description).join('\n');
  expect(sent['magi-logs']).toHaveLength(1);
  expect(text('magi-logs')).toContain('<#g-lots-général> · personas → casper');
  expect(sent['magi-logs'][0].embeds[0].color).toBe(0x378add);
  expect(text('magi-logs')).not.toContain('invisible');
  expect(text('magi-système').match(/gemini lent/g)).toHaveLength(1);
  expect(text('magi-système')).toContain('*(×2)*');
  expect(sent['magi-système'][0].embeds[0].color).toBe(0xef9f27);
  expect(text('magi-système')).not.toContain('trop détaillé');
  setSetting('g-lots', 'log_level', 'info');
  await deliver(guild, entry('info', 'conversation', 'détaillé'));
  await flush(`g-lots-magi-système`);
  expect(text('magi-système', 1)).toContain('détaillé');
});

test('sur Discord : changements de config et connexions SSH fusionnés dans un même message', async () => {
  const { guild, sent } = fakeGuild('g-fusion');
  const edits = [];
  const original = guild.channels.cache.get('g-fusion-magi-logs').send;
  guild.channels.cache.get('g-fusion-magi-logs').send = async (payload) => {
    await original(payload);
    return { edit: async (p) => edits.push(p.embeds[0].description) };
  };
  const at = new Date('2026-10-26T13:24:01Z');
  const config = (message, delay) => deliver(guild, { at: new Date(at.getTime() + delay), host: 'magi', level: 'notice', component: 'config', message, guild, channel: null, mention: null });
  await config('critères du filtre = avatar par slouowze', 0);
  await config('critères du filtre = tous par slouowze', 30_000);
  await config('âge minimal à l’arrivée = 7 par slouowze', 60_000);
  expect(sent['magi-logs']).toHaveLength(1);
  expect(edits.at(-1)).toBe('⚙️ **slouowze** a modifié la configuration : critères du filtre = tous ; âge minimal à l’arrivée = 7 *(2 changements)*');
  const { MERGERS } = await import('./discord.js');
  const ssh = MERGERS.sshd;
  const e = (min) => ({ at: new Date(at.getTime() + min * 60_000), host: 'vps', message: 'Accepted publickey for slouowze from 1.2.3.4 port 5 ssh2' });
  const state = ssh.add(ssh.add(ssh.start(ssh.parse(e(0)), e(0)), ssh.parse(e(5)), e(5)), ssh.parse(e(9)), e(9));
  expect(ssh.render(state)).toBe('🔑 **vps** · slouowze connecté en SSH depuis 1.2.3.4 ×3 (<t:1793021041:t> → <t:1793021581:t>)');
});

test('sur Discord : une alerte avec mention part seule et notifie', async () => {
  const { guild, sent } = fakeGuild('g-alerte');
  await deliver(guild, { at: new Date(), host: 'magi', level: 'alert', component: 'antinuke', message: 'trop de suppressions', guild, channel: null, mention: { users: ['42'], roles: ['7'] } });
  expect(sent['magi-sécurité'][0].content).toBe('<@42> <@&7>');
  expect(sent['magi-sécurité'][0].embeds[0]).toMatchObject({ description: '🚨 **antinuke** · trop de suppressions', color: 0xe24b4a });
  expect(sent['magi-sécurité'][0].allowedMentions).toEqual({ users: ['42'], roles: ['7'] });
});

test('journal du VPS : connexions, sudo et mémoire saturée classés', () => {
  const j = (SYSLOG_IDENTIFIER, MESSAGE, PRIORITY = '6') => classify({ SYSLOG_IDENTIFIER, MESSAGE, PRIORITY });
  expect(j('sshd-session', 'Accepted publickey for slouowze from 1.2.3.4 port 5555 ssh2')).toMatchObject({ level: 'notice', component: 'sshd' });
  expect(j('sshd-session', 'Invalid user admin from 5.6.7.8 port 22')).toMatchObject({ level: 'info', failedFrom: '5.6.7.8' });
  expect(j('sshd-session', 'Connection closed by 5.6.7.8 port 22 [preauth]')).toMatchObject({ level: 'debug' });
  expect(j('sudo', 'slouowze : TTY=pts/0 ; PWD=/home/slouowze ; USER=root ; COMMAND=/usr/bin/systemctl restart docker', '5')).toMatchObject({ level: 'notice', component: 'sudo', message: 'slouowze a lancé en root : systemctl restart docker' });
  expect(j('kernel', 'Out of memory: Killed process 1234 (ollama)', '3')).toMatchObject({ level: 'crit', component: 'kernel' });
  expect(j('systemd', 'docker.service: Failed with result \'exit-code\'.', '4')).toMatchObject({ level: 'err' });
  expect(j('CRON', 'pam_unix(cron:session): session opened', '6')).toMatchObject({ level: 'info', component: 'CRON' });
  expect(classify({ SYSLOG_IDENTIFIER: 'x', MESSAGE: [104, 105] })).toMatchObject({ message: 'hi' });
  expect(j('systemd-tmpfiles', '/usr/lib/tmpfiles.d/legacy.conf:14: Duplicate line for path "/run/lock", ignoring.', '5')).toMatchObject({ level: 'debug' });
  expect(j('systemd-networkd', "Foreign process 'dockerd[728]' changed sysctl '/proc/sys/net/ipv6/conf/eth0/disable_ipv6' from '0' to '1'", '4')).toMatchObject({ level: 'debug' });
});

test('journal du VPS : doublons ignorés, échecs SSH résumés', () => {
  entries.length = 0;
  const line = (at, MESSAGE) => JSON.stringify({ __REALTIME_TIMESTAMP: String(at), SYSLOG_IDENTIFIER: 'sshd-session', PRIORITY: '6', MESSAGE });
  handleLine(line(1_792_999_441_000_000, 'Invalid user admin from 5.6.7.8 port 22'));
  handleLine(line(1_792_999_441_000_000, 'Invalid user admin from 5.6.7.8 port 22'));
  handleLine(line(1_792_999_442_000_000, 'Failed password for root from 5.6.7.8 port 22 ssh2'));
  handleLine(line(1_792_999_443_000_000, 'Failed password for invalid user test from 9.9.9.9 port 22 ssh2'));
  handleLine('pas du json');
  expect(entries.map((e) => [e.host, e.component, e.level])).toEqual([
    ['vps', 'sshd', 'info'],
    ['vps', 'sshd', 'info'],
    ['vps', 'sshd', 'info'],
  ]);
  const summary = reportFailures();
  expect(summary.level).toBe('warning');
  expect(summary.message).toBe('3 connexions SSH refusées en 10 min, depuis 2 adresses (surtout 5.6.7.8, 2 fois)');
  expect(reportFailures()).toBeNull();
});

test('le niveau minimal côté serveur se règle avec LOG_LEVEL', () => {
  const printed = [];
  const original = console.log;
  console.log = (line) => printed.push(line);
  process.env.LOG_LEVEL = 'notice';
  log.info('test', 'caché');
  log.notice('test', 'visible');
  delete process.env.LOG_LEVEL;
  console.log = original;
  expect(printed).toHaveLength(1);
  expect(printed[0]).toEndWith('magi test: notice: visible');
});

test('résumé quotidien : compteurs tirés des logs, texte lisible', async () => {
  const { countEntry, digestText, statsOf } = await import('./digest.js');
  const at = Date.parse('2026-10-27T15:00:00Z');
  const guild = { id: 'g-resume' };
  const e = (component, message, level = 'notice', g = guild) => countEntry({ component, message, level, guild: g }, at);
  e('membres', '<@1> est arrivé · yui · compte créé il y a 1 h');
  e('membres', '<@2> est arrivé · lea · compte créé il y a 2 ans');
  e('membres', 'yui est parti');
  e('tickets', '<@1> a ouvert un ticket : « partenariat »');
  e('conversation', 'slou → casper, conv 3, gemini-3.5-flash-lite, 1.2 s', 'info');
  e('conversation', 'slou → melchior, conv 4, openai/gpt-oss-120b, 4.0 s', 'info');
  e('llm', 'HTTP 503', 'err');
  e('bot', 'Redémarré après 6 s hors ligne · MAGI', 'notice', null);
  const stats = statsOf('g-resume', '2026-10-27');
  expect(stats).toEqual({ arrivees: 2, departs: 1, tickets: 1, reponses: 2, relais: 1, erreurs: 1 });
  expect(digestText('2026-10-27', { ...stats, cas: 2, cas_annules: 1 }, statsOf('global', '2026-10-27'))).toBe(
    '📊 **Résumé du mardi 27 octobre** · 2 arrivées, 1 départ · 2 cas de modération (1 annulé) · 1 ticket · 2 réponses des unités, dont 1 via le relais · 1 redémarrage · ❌ 1 erreur, voir #magi-systeme',
  );
  expect(digestText('2026-10-27', {}, null)).toBe('📊 **Résumé du mardi 27 octobre** · aucune erreur');
});
