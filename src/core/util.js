const PARIS = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const discordTime = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;

export function parisParts(ms) {
  const p = Object.fromEntries(PARIS.formatToParts(ms).map(({ type, value }) => [type, Number(value)]));
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute };
}

export function parisDate(ms) {
  const { year, month, day } = parisParts(ms);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
