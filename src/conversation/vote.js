import { PERSONAS } from '../personas.js';
import { chat, forReply } from '../llm/client.js';
import { cleanReply, systemPrompt } from '../llm/prompts.js';
import { speak } from '../discord/webhooks.js';
import { log } from '../logging/log.js';
import { announce } from '../server/presence.js';

export const VERDICTS = ['APPROUVÉ', 'REFUSÉ', 'ABSTENTION'];

const VOTE_FORMAT = {
  type: 'object',
  properties: {
    avis: { type: 'string' },
    verdict: { type: 'string', enum: VERDICTS },
  },
  required: ['avis', 'verdict'],
};

const VOTE_INSTRUCTION = `Délibération MAGI : on soumet une question aux unités de MAGI, qui votent chacune de leur côté.
Donne ton avis en une ou deux phrases, avec ta propre voix, puis ton verdict : APPROUVÉ (oui, à faire), REFUSÉ (non) ou ABSTENTION (impossible de trancher).`;

export function tally(votes) {
  const pour = votes.filter((v) => v.verdict === 'APPROUVÉ');
  const contre = votes.filter((v) => v.verdict === 'REFUSÉ');
  const abstentions = votes.length - pour.length - contre.length;
  const outcome = pour.length > votes.length / 2 ? 'adoptée' : contre.length > votes.length / 2 ? 'rejetée' : 'impossible';
  const minority = outcome === 'adoptée' ? contre : outcome === 'rejetée' ? pour : [];
  return { outcome, pour: pour.length, contre: contre.length, abstentions, total: votes.length, minority: minority.map((v) => v.persona) };
}

export function announcement({ outcome, pour, contre, abstentions, total }) {
  if (outcome === 'impossible') return '**MAGI · Délibération impossible.** Aucune majorité.';
  const unanimous = (outcome === 'adoptée' ? pour : contre) === total;
  if (unanimous) return `**MAGI · Résolution ${outcome} à l'unanimité.**`;
  const score = outcome === 'adoptée' ? `${pour} contre ${contre}` : `${contre} contre ${pour}`;
  return `**MAGI · Résolution ${outcome}, ${score}${abstentions ? `, ${abstentions} abstention${abstentions > 1 ? 's' : ''}` : ''}.**`;
}

export async function castVote(persona, question) {
  try {
    const { content } = await chat({
      messages: [
        { role: 'system', content: `${systemPrompt(persona, 'courte')}\n${VOTE_INSTRUCTION}` },
        { role: 'user', content: question },
      ],
      format: VOTE_FORMAT,
      options: { num_predict: 200 },
      ...forReply(),
    });
    const { avis, verdict } = JSON.parse(content);
    return { persona, avis: cleanReply(avis), verdict: VERDICTS.includes(verdict) ? verdict : 'ABSTENTION' };
  } catch (err) {
    return { persona, avis: 'Unité hors ligne.', verdict: 'ABSTENTION' };
  }
}

export async function minorityOpinion(persona, question, result) {
  try {
    const { content } = await chat({
      messages: [
        { role: 'system', content: systemPrompt(persona, 'courte') },
        { role: 'user', content: `La résolution « ${question} » a été ${result.outcome} contre ton avis. Ajoute une seule phrase d'avis minoritaire, avec ta voix.` },
      ],
      options: { num_predict: 80 },
      ...forReply(),
    });
    return cleanReply(content);
  } catch {
    return null;
  }
}

export function formatVote({ avis, verdict }) {
  return `${avis}\n**${verdict}**`;
}

export async function runVote(message, question, personas = Object.keys(PERSONAS)) {
  const typing = setInterval(() => message.channel.sendTyping().catch(() => {}), 8_000);
  message.channel.sendTyping().catch(() => {});
  const live = announce(message.channel, `Vote en cours : ${question.replace(/\s+/g, ' ')}`);
  try {
    const votes = await Promise.all(personas.map((persona) => castVote(persona, question)));
    for (const [i, vote] of votes.entries()) await speak(message.channel, vote.persona, formatVote(vote), { replyTo: i === 0 ? message : undefined });
    const result = tally(votes);
    live.set(`Vote : ${result.pour} pour, ${result.contre} contre`);
    log.info('vote', `${votes.map((v) => `${v.persona}=${v.verdict}`).join(' ')} → ${result.outcome}`, { channel: message.channel });
    await message.channel.send({ content: announcement(result), allowedMentions: { parse: [] } });
    for (const persona of result.minority) {
      const line = await minorityOpinion(persona, question, result);
      if (line) await speak(message.channel, persona, `Avis minoritaire : ${line}`);
    }
  } finally {
    clearInterval(typing);
    live.done();
  }
}
