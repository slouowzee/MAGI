export const LEVELS = ['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug'];
export const severity = (level) => LEVELS.indexOf(level);

const PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'longOffset',
});
const sinks = [];

export function timestamp(date = new Date()) {
  const p = Object.fromEntries(PARTS.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${p.timeZoneName.replace('GMT', '') || '+00:00'}`;
}

export function where({ guild, channel }) {
  if (channel) return `${guild?.name ?? channel.guild?.name} #${channel.name}`;
  return guild?.name ?? null;
}

export function serverLine(entry) {
  const place = where(entry);
  return `${timestamp(entry.at)} ${entry.host} ${entry.component}: ${entry.level}: ${place ? `[${place}] ` : ''}${entry.message.replace(/\s*\n\s*/g, ' ')}`;
}

function serverThreshold() {
  const level = severity(process.env.LOG_LEVEL ?? 'info');
  return level >= 0 ? level : severity('info');
}

function emit(level, component, message, context = {}) {
  const entry = {
    at: context.at ?? new Date(),
    host: context.host ?? 'magi',
    level,
    component,
    message: String(message),
    guild: context.guild ?? context.channel?.guild ?? null,
    channel: context.channel ?? null,
    mention: context.mention ?? null,
  };
  if (entry.host === 'magi' && severity(level) <= serverThreshold()) {
    (severity(level) <= severity('warning') ? console.error : console.log)(serverLine(entry));
  }
  for (const sink of sinks) {
    try {
      sink(entry);
    } catch (err) {
      console.error(`${timestamp()} magi log: err: ${err.message}`);
    }
  }
  return entry;
}

export const log = Object.fromEntries(LEVELS.map((level) => [level, (component, message, context) => emit(level, component, message, context)]));

export function addSink(sink) {
  sinks.push(sink);
  return () => sinks.splice(sinks.indexOf(sink), 1);
}
