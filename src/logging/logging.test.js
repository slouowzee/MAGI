import { afterAll, expect, test } from 'bun:test';

process.env.DB_PATH = ':memory:';
const { addSink, log, serverLine, timestamp } = await import('./log.js');
const { ansiLine, deliver, flush, plain, sourceOf } = await import('./discord.js');
const { classify, handleLine, reportFailures } = await import('./host.js');
const { db } = await import('../storage/db.js');
const { setSetting } = await import('../storage/settings.js');

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

test('sur Discord : mentions en clair, markdown retiré, couleur par niveau', () => {
  const { guild } = fakeGuild('g-texte');
  expect(plain('**Ban** de <@42> par <@&7>, arrivé le <t:1793021041>', guild)).toBe('Ban de @Slou par @Opérateur MAGI, arrivé le 2026-10-26 14:24');
  const line = ansiLine({ at: new Date('2026-10-26T13:24:01Z'), host: 'vps', component: 'sshd', level: 'warning', message: 'échec' }, guild);
  expect(line).toBe('\u001b[30m14:24:01\u001b[0m \u001b[34mvps sshd\u001b[0m: \u001b[33mwarning\u001b[0m: échec');
});

test('sur Discord : regroupées par salon, répétitions comptées, sous le seuil ignorées', async () => {
  const { guild, sent, general } = fakeGuild('g-lots');
  const entry = (level, component, message) => ({ at: new Date(), host: 'magi', level, component, message, guild, channel: general, mention: null });
  await deliver(guild, entry('notice', 'config', 'personas → casper'));
  await deliver(guild, entry('warning', 'llm', 'gemini lent'));
  await deliver(guild, entry('warning', 'llm', 'gemini lent'));
  await deliver(guild, entry('info', 'conversation', 'trop détaillé'));
  await flush(`g-lots-magi-logs`);
  await flush(`g-lots-magi-système`);
  expect(sent['magi-logs']).toHaveLength(1);
  expect(sent['magi-logs'][0].content).toStartWith('```ansi\n');
  expect(sent['magi-logs'][0].content).toContain('#général personas → casper');
  expect(sent['magi-système'][0].content.match(/gemini lent/g)).toHaveLength(1);
  expect(sent['magi-système'][0].content).toContain('(×2)');
  expect(sent['magi-système'][0].content).not.toContain('trop détaillé');
  setSetting('g-lots', 'log_level', 'info');
  await deliver(guild, entry('info', 'conversation', 'détaillé'));
  await flush(`g-lots-magi-système`);
  expect(sent['magi-système'][1].content).toContain('détaillé');
});

test('sur Discord : une alerte avec mention part seule et notifie', async () => {
  const { guild, sent } = fakeGuild('g-alerte');
  await deliver(guild, { at: new Date(), host: 'magi', level: 'alert', component: 'antinuke', message: 'trop de suppressions', guild, channel: null, mention: { users: ['42'], roles: ['7'] } });
  expect(sent['magi-sécurité'][0].content).toStartWith('<@42> <@&7>\n```ansi\n');
  expect(sent['magi-sécurité'][0].allowedMentions).toEqual({ users: ['42'], roles: ['7'] });
});

test('journal du VPS : connexions, sudo et mémoire saturée classés', () => {
  const j = (SYSLOG_IDENTIFIER, MESSAGE, PRIORITY = '6') => classify({ SYSLOG_IDENTIFIER, MESSAGE, PRIORITY });
  expect(j('sshd-session', 'Accepted publickey for slouowze from 1.2.3.4 port 5555 ssh2')).toMatchObject({ level: 'notice', component: 'sshd' });
  expect(j('sshd-session', 'Invalid user admin from 5.6.7.8 port 22')).toMatchObject({ level: 'info', failedFrom: '5.6.7.8' });
  expect(j('sshd-session', 'Connection closed by 5.6.7.8 port 22 [preauth]')).toMatchObject({ level: 'debug' });
  expect(j('sudo', 'slouowze : TTY=pts/0 ; PWD=/home/slouowze ; USER=root ; COMMAND=/usr/bin/systemctl restart docker', '5')).toMatchObject({ level: 'notice', component: 'sudo' });
  expect(j('kernel', 'Out of memory: Killed process 1234 (ollama)', '3')).toMatchObject({ level: 'crit', component: 'kernel' });
  expect(j('systemd', 'docker.service: Failed with result \'exit-code\'.', '4')).toMatchObject({ level: 'err' });
  expect(j('CRON', 'pam_unix(cron:session): session opened', '6')).toMatchObject({ level: 'info', component: 'CRON' });
  expect(classify({ SYSLOG_IDENTIFIER: 'x', MESSAGE: [104, 105] })).toMatchObject({ message: 'hi' });
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
  expect(summary.message).toBe("3 échec(s) d'authentification en 10 min, 2 IP, max 5.6.7.8 (2)");
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
