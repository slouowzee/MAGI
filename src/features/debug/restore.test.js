import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = `
  const { writeFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { backupDatabase, listBackups } = await import(${JSON.stringify(new URL('../../core/db.js', import.meta.url).href)});
  const { handleDebugInteraction } = await import(${JSON.stringify(new URL('./console.js', import.meta.url).href)});
  const { setSetting } = await import(${JSON.stringify(new URL('../../core/settings.js', import.meta.url).href)});
  const { loadAppOwner } = await import(${JSON.stringify(new URL('../../core/log/discord.js', import.meta.url).href)});
  await loadAppOwner({ application: { fetch: async () => ({ owner: { id: 'owner' } }) } });
  for (let i = 0; i < 10; i++) {
    backupDatabase('c' + i);
    await Bun.sleep(15);
  }
  const oldest = listBackups().at(-1).name;
  writeFileSync(join(dirname(process.env.DB_PATH), 'copies', 'memoire-recente.db'), 'x');
  console.log(listBackups().every((b) => b.name.startsWith('magi-')) ? 'copies-ok' : 'copies-ko');
  setSetting('g', 'debug_until', 'infini');
  let reply;
  const interaction = (customId) => ({
    customId,
    guild: { id: 'g', ownerId: 'owner' },
    user: { id: 'owner', tag: 'owner' },
    member: { id: 'owner', displayName: 'Slou', toString: () => '<@owner>' },
    client: {},
    fields: { getTextInputValue: () => oldest },
    deferReply: async () => {},
    update: async () => {},
    editReply: async (p) => { reply = p; },
    reply: async (p) => { reply = p; },
  });
  await handleDebugInteraction(interaction('magi-debug:form:restaurer'));
  await handleDebugInteraction(interaction(reply.components[0].components[0].data.custom_id));
  console.log(oldest);
  process.exit(0);
`;

test('restaurer la copie la plus ancienne : la rotation ne la supprime pas', () => {
  const dir = mkdtempSync(join(tmpdir(), 'magi-restore-'));
  try {
    const run = Bun.spawnSync(['bun', '-e', SCRIPT], { env: { ...process.env, DB_PATH: join(dir, 'magi.db'), LOG_LEVEL: 'emerg' } });
    const lines = run.stdout.toString().trim().split('\n');
    const oldest = lines.at(-1);
    expect(lines.at(-2)).toBe('copies-ok');
    expect(run.exitCode).toBe(0);
    expect(existsSync(join(dir, 'copies', oldest))).toBe(true);
    expect(readFileSync(join(dir, 'restaurer'), 'utf8')).toBe(oldest);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);
