import { listSettings, setSetting } from '../../core/settings.js';
import { MODES, moderationMode, setModerationMode } from '../moderation/store.js';
import { interventionChannels, replaceInterventions } from '../conversation/interventions.js';

const RUNTIME = ['star:', 'ticket:', 'tempvoice:', 'quarantine:', 'stats:', 'notes:', 'synchro_notice:', 'stars_test', 'publication:', 'config_message', 'config_panel', 'config_page', 'honeypot_message', 'birthday_done', 'digest_done', 'raid_', 'debug_', 'server_journal', 'season_journal', 'log_level_'];
const runtime = (key) => RUNTIME.some((prefix) => key.startsWith(prefix));

export function exportConfig(guild, now = Date.now()) {
  return {
    format: 'magi-config',
    version: 1,
    guild: { id: guild.id, name: guild.name },
    at: new Date(now).toISOString(),
    settings: Object.fromEntries(listSettings(guild.id, '').filter((row) => !runtime(row.key)).map((row) => [row.key, row.value])),
    moderation: moderationMode(guild.id).mode,
    interventions: interventionChannels(guild.id),
  };
}

export function readConfig(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("ce fichier n'est pas du JSON");
  }
  if (data?.format !== 'magi-config' || !data.settings || typeof data.settings !== 'object') throw new Error("ce n'est pas un export de configuration MAGI");
  return data;
}

export function importConfig(guild, data) {
  const entries = Object.entries(data.settings).filter(([key, value]) => typeof key === 'string' && !runtime(key) && (typeof value === 'string' || value === null));
  for (const [key, value] of entries) setSetting(guild.id, key, value);
  if (MODES.includes(data.moderation)) setModerationMode(guild.id, data.moderation);
  if (Array.isArray(data.interventions)) replaceInterventions(guild.id, data.interventions.filter((id) => /^\d{17,20}$/.test(id)));
  return entries.length;
}
