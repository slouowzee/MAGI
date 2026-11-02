import { AsyncLocalStorage } from 'node:async_hooks';
import { isAppOwner } from '../log/discord.js';
import { log } from '../log/log.js';

const HOUR = 60 * 60_000;
const scope = new AsyncLocalStorage();
const calls = new Map();

export const hourlyLimit = () => Number(process.env.GUILD_LLM_PER_HOUR) || 120;

export function forGuild(guild, fn) {
  return guild ? scope.run({ guild, unlimited: isAppOwner(guild.ownerId) }, fn) : fn();
}

export function spend(now = Date.now()) {
  const current = scope.getStore();
  if (!current || current.unlimited) return true;
  const recent = (calls.get(current.guild.id) ?? []).filter((at) => now - at < HOUR);
  if (recent.length >= hourlyLimit()) {
    if (recent.length === hourlyLimit()) log.warning('llm', `${hourlyLimit()} requêtes au modèle dans l'heure : les unités se taisent jusqu'à la fin de l'heure`, { guild: current.guild });
    recent.push(now);
    calls.set(current.guild.id, recent);
    return false;
  }
  recent.push(now);
  calls.set(current.guild.id, recent);
  return true;
}
