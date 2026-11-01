import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';

const TTL = 15 * 60_000;
const PREFIX = 'magi:';
const silent = { allowedMentions: { parse: [] } };
const MAX_BUTTONS = 25;
const pending = new Map();

export function registerAction(action, now = Date.now()) {
  for (const [key, old] of pending) if (now - old.at > TTL) pending.delete(key);
  const id = crypto.randomUUID();
  pending.set(id, { ...action, at: now });
  return id;
}

export function buttonsFor(actions) {
  const buttons = actions.slice(0, MAX_BUTTONS).map((action) =>
    action.url
      ? new ButtonBuilder().setURL(action.url).setLabel(action.label).setStyle(ButtonStyle.Link)
      : new ButtonBuilder()
          .setCustomId(PREFIX + registerAction(action))
          .setLabel(action.label)
          .setStyle(action.danger ? ButtonStyle.Danger : ButtonStyle.Primary),
  );
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  return rows;
}

export function previewsFor(actions) {
  return actions.map((action) => action.preview).filter(Boolean).slice(0, 10);
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
