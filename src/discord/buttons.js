import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';

const TTL = 15 * 60_000;
const PREFIX = 'magi:';
const silent = { allowedMentions: { parse: [] } };
const pending = new Map();

export function registerAction(action, now = Date.now()) {
  const id = crypto.randomUUID();
  pending.set(id, { ...action, at: now });
  return id;
}

export function buttonsFor(actions) {
  if (!actions.length) return [];
  const row = new ActionRowBuilder().addComponents(
    actions.map((action) =>
      new ButtonBuilder()
        .setCustomId(PREFIX + registerAction(action))
        .setLabel(action.label)
        .setStyle(action.danger ? ButtonStyle.Danger : ButtonStyle.Primary),
    ),
  );
  return [row];
}

export function takeAction(id, member, now = Date.now()) {
  const action = pending.get(id);
  if (!action || now - action.at > TTL) {
    pending.delete(id);
    return { error: 'Cette demande a expiré. Redemande-moi.' };
  }
  if (!action.allowed(member)) return { error: action.refusal ?? "Ce bouton n'est pas pour toi." };
  pending.delete(id);
  return { action };
}

export async function handleInteraction(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith(PREFIX)) return;
  const { action, error } = takeAction(interaction.customId.slice(PREFIX.length), interaction.member);
  if (error) {
    await interaction.reply({ content: error, flags: MessageFlags.Ephemeral, ...silent }).catch(() => {});
    return;
  }
  await interaction.update({ components: [] }).catch(() => {});
  const output = await action.run(interaction.member).catch((err) => `Échec : ${err.message}`);
  if (!action.cleanup) {
    await interaction.followUp({ content: output, ...silent }).catch(() => {});
    return;
  }
  await interaction.followUp({ content: output, flags: MessageFlags.Ephemeral, ...silent }).catch(() => {});
  await Promise.all([interaction.message, action.cleanup].map((m) => m.delete().catch(() => {})));
}
