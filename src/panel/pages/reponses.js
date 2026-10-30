import { StringSelectMenuBuilder } from 'discord.js';
import { PERSONAS } from '../../core/personas.js';
import { forReply } from '../../core/llm/client.js';
import { learnedExamples, SEEDS, toneSamples } from '../../features/conversation/examples.js';
import { BAD_CHOICES, badEmoji, GOOD_CHOICES, goodEmoji } from '../../features/conversation/feedback.js';
import { id, row, separator, text } from '../ui.js';

function emojiSelect(field, placeholder, choices, current) {
  return row(
    new StringSelectMenuBuilder()
      .setCustomId(id(field))
      .setPlaceholder(placeholder)
      .addOptions([
        ...Object.entries(choices).map(([value, label]) => ({ label: `${value} ${label}`, value, default: value === current })),
        ...(choices[current] ? [] : [{ label: 'Emoji personnalisé actuel', value: 'actuel', default: true }]),
        { label: 'Autre emoji…', value: 'autre', description: 'Un emoji au choix, ou un emoji du serveur' },
      ]),
  );
}

export function repliesSection(guild) {
  const learned = learnedExamples(guild.id);
  const counts = Object.entries(PERSONAS).map(([key, p]) => `${p.name} ${learned.filter((e) => e.persona === key).length}`).join(', ');
  const good = goodEmoji(guild.id);
  const bad = badEmoji(guild.id);
  const blocks = [
    text(`**Modèle des réponses** : ${forReply().model}\n-# Les trois unités répondent avec ce modèle, avec repli automatique si il est saturé.`),
    separator(),
    text(
      `**Banque d'exemples** : ${learned.length} réponse${learned.length > 1 ? 's' : ''} apprise${learned.length > 1 ? 's' : ''} sur ce serveur (${counts}), en plus des ${SEEDS.length} exemples de base.\n-# Un opérateur réagit avec ${good} sur une réponse réussie d'une unité pour l'ajouter, avec ${bad} pour la retirer. À chaque réponse, MAGI montre au modèle 5 exemples au plus, du même type de message en priorité.`,
    ),
    text(`**Ton du serveur** : ${toneSamples(guild.id).length} message${toneSamples(guild.id).length > 1 ? 's' : ''} de membres retenu${toneSamples(guild.id).length > 1 ? 's' : ''}.\n-# Le même emoji sur le message d'un membre l'ajoute comme exemple de la façon de parler du serveur ; MAGI en montre 4 au plus au modèle, sans les recopier. Chacun voit et efface les siens avec /oublier.`),
    emojiSelect('examples_good', 'Emoji pour ajouter', GOOD_CHOICES, good),
    emojiSelect('examples_bad', 'Emoji pour retirer', BAD_CHOICES, bad),
  ];
  if (learned.length) {
    blocks.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(id('examples_forget'))
          .setPlaceholder('Retirer une réponse apprise')
          .addOptions(
            learned.slice(0, 25).map((e) => ({
              label: `${PERSONAS[e.persona]?.name ?? e.persona} · ${e.output.replace(/\s+/g, ' ')}`.slice(0, 100),
              description: `En réponse à « ${e.input.replace(/\s+/g, ' ')} »`.slice(0, 100),
              value: String(e.id),
            })),
          ),
      ),
    );
  }
  const tone = toneSamples(guild.id);
  if (tone.length) {
    blocks.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(id('tone_forget'))
          .setPlaceholder('Retirer un message du ton du serveur')
          .addOptions(tone.slice(0, 25).map((e) => ({ label: e.output.replace(/\s+/g, ' ').slice(0, 100), description: `De ${e.author}`.slice(0, 100), value: String(e.id) }))),
      ),
    );
  }
  return blocks;
}
