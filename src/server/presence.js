import { ActivityType } from 'discord.js';
import { moduleEnabled } from './config.js';
import { llmStatus, onLlmActivity } from '../llm/client.js';

const DEBOUNCE = 1_500;

export function presenceText(busy, status) {
  if (busy) return { text: 'En délibération…', status: 'online' };
  const available = status.filter((s) => !s.paused);
  if (!available.length) return { text: 'Unités hors ligne, reprise dans un instant', status: 'idle' };
  if (status[0]?.paused) return { text: `${status[0].model} saturé, relais ${available[0].model}`, status: 'idle' };
  return { text: 'Prêt', status: 'online' };
}

export function startPresence(client) {
  let last = null;
  let timer = null;
  const apply = ({ busy, status }) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const enabled = [...client.guilds.cache.values()].some((g) => moduleEnabled(g.id, 'statut'));
      const next = enabled ? presenceText(busy, status) : { text: null, status: 'online' };
      const key = `${next.status} ${next.text}`;
      if (key === last) return;
      last = key;
      client.user.setPresence({ status: next.status, activities: next.text ? [{ type: ActivityType.Custom, name: 'statut', state: next.text }] : [] });
    }, DEBOUNCE);
  };
  onLlmActivity(apply);
  apply({ busy: 0, status: llmStatus() });
}
