import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { LEVELS, log } from './log.js';
import { setSetting, setting } from '../storage/settings.js';

const PATH = process.env.HOST_JOURNAL ?? 'data/host-journal.fifo';
const SSH_WINDOW = 10 * 60_000;
const SSH = new Set(['sshd', 'sshd-session']);
const NOISE = [/Duplicate line for path/, /Foreign process '.+' changed sysctl/];
const failures = new Map();
let failureTimer = null;
let lastAt = Number(setting('global', 'host_journal_at') ?? 0);

const text = (value) => (Array.isArray(value) ? Buffer.from(value).toString() : typeof value === 'string' ? value : '').trim();

export function classify(raw) {
  const component = raw.SYSLOG_IDENTIFIER ?? raw._COMM ?? 'inconnu';
  const message = text(raw.MESSAGE);
  if (!message) return null;
  const level = LEVELS[Number(raw.PRIORITY)] ?? 'info';
  if (NOISE.some((pattern) => pattern.test(message))) return { level: 'debug', component, message };
  if (SSH.has(component)) {
    if (message.startsWith('Accepted ')) return { level: 'notice', component: 'sshd', message };
    const failed = message.match(/^(?:Failed \S+ for (?:invalid user )?\S+|Invalid user \S*) from (\S+)/);
    if (failed) return { level: 'info', component: 'sshd', message, failedFrom: failed[1] };
    return { level: level === 'info' ? 'debug' : level, component: 'sshd', message };
  }
  if (component === 'sudo') {
    if (message.includes('COMMAND=')) return { level: 'notice', component, message };
    if (/authentication failure|incorrect password/.test(message)) return { level: 'warning', component, message };
    return { level: 'debug', component, message };
  }
  if (component === 'kernel' && /Out of memory|oom-kill|Killed process/.test(message)) return { level: 'crit', component, message };
  if (/Failed to start|Failed with result|Main process exited, code=(?:killed|dumped)/.test(message)) return { level: 'err', component, message };
  return { level, component, message };
}

export function reportFailures() {
  clearTimeout(failureTimer);
  failureTimer = null;
  if (!failures.size) return null;
  const total = [...failures.values()].reduce((a, b) => a + b, 0);
  const [ip, count] = [...failures].sort((a, b) => b[1] - a[1])[0];
  const addresses = failures.size;
  failures.clear();
  return log.warning('sshd', `${total} échec(s) d'authentification en 10 min, ${addresses} IP, max ${ip} (${count})`, { host: 'vps' });
}

export function handleLine(line) {
  let raw;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  const at = Number(raw.__REALTIME_TIMESTAMP ?? 0);
  if (at && at <= lastAt) return null;
  if (at) {
    lastAt = at;
    setSetting('global', 'host_journal_at', at);
  }
  const entry = classify(raw);
  if (!entry) return null;
  if (entry.failedFrom) {
    failures.set(entry.failedFrom, (failures.get(entry.failedFrom) ?? 0) + 1);
    failureTimer ??= setTimeout(reportFailures, SSH_WINDOW);
  }
  return log[entry.level](entry.component, entry.message, { host: 'vps', at: at ? new Date(at / 1000) : new Date() });
}

export function followHostJournal(path = PATH) {
  if (!existsSync(path)) return log.info('journal', `${path} absent, journal du VPS non suivi`);
  log.info('journal', `suivi de ${path}`);
  const open = async () => {
    try {
      for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) handleLine(line);
    } catch (err) {
      log.warning('journal', `lecture interrompue : ${err.message}`);
    }
    setTimeout(open, 5_000);
  };
  open();
}
