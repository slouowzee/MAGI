import { expect, test } from 'bun:test';
import { framed, SIGNATURE } from './embeds.js';

test('cadre MAGI : nature et serveur en en-tête, signature en pied', () => {
  const guild = { name: 'Le monde de Slou', iconURL: () => 'https://cdn.test/icone.png', client: { user: { displayAvatarURL: () => 'https://cdn.test/magi.png' } } };
  const embed = framed(guild, { label: 'Annonce', title: 'Mise à jour', text: 'Nouveau salon **#media**.' }).toJSON();
  expect(embed.author).toEqual({ name: 'Annonce · Le monde de Slou', icon_url: 'https://cdn.test/icone.png' });
  expect(embed.title).toBe('Mise à jour');
  expect(embed.footer).toEqual({ text: SIGNATURE, icon_url: 'https://cdn.test/magi.png' });
  expect(embed.timestamp).toBeDefined();
  expect(framed({ name: 'Sans icône' }, { label: 'Rôles', text: 'x' }).toJSON().author).toEqual({ name: 'Rôles · Sans icône' });
});
