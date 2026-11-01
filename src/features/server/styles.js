export const PRESETS = {
  __proto__: null,
  libre: { label: 'Libre (selon la consigne)', brief: '' },
  gaming: { label: 'Gaming', brief: "Serveur de jeux : annonces, discussion générale, un salon par jeu principal, recherche de coéquipiers, clips et captures, vocaux de jeu avec places limitées, rôles par jeu en libre-service, notifications d'événements." },
  communaute: { label: 'Communauté chill', brief: 'Communauté détendue : accueil, présentations, discussion, médias, mèmes, musique, jeux, vocaux pour traîner, rôles de couleurs et de centres d’intérêt.' },
  etudes: { label: 'Études / école', brief: "Groupe d'études : annonces, emploi du temps, un salon par matière, entraide et questions, partage de ressources, salles d'étude vocales, rôles par classe ou filière." },
  tech: { label: 'Dev / tech', brief: 'Communauté de développeurs : annonces, aide par langage ou techno, revue de code, projets et vitrine, offres et veille, salons vocaux de pair programming, rôles par langage.' },
  createur: { label: 'Créateur (stream, YouTube)', brief: 'Communauté d’un créateur : annonces de vidéos et de lives, planning, discussion, fan-art, clips, suggestions, salons réservés aux abonnés ou soutiens, rôles de notification.' },
  pro: { label: 'Pro / entreprise', brief: 'Espace professionnel sobre : annonces, général, un salon par équipe ou projet, ressources, support, salles de réunion vocales, rôles par équipe. Peu d’emojis, ton neutre.' },
  rp: { label: 'Jeu de rôle', brief: 'Serveur de jeu de rôle : règles et univers, fiches personnages, lieux de jeu en salons, hors-jeu, annonces du maître du jeu, vocaux de session, rôles de factions.' },
  nerv: { label: 'NERV / Evangelion', brief: "Thème NERV d'Evangelion, assorti à MAGI : terminologie du QG (Dogma central, Geofront, cages des EVA, quartier général), annonces comme des communiqués du commandement, rôles comme des grades et pilotes." },
};

export const SEPARATORS = { point: '・', barre: '┃', fine: '︱', chevron: '»', tiret: '-' };
export const CASES = { minuscules: 'minuscules', capitales: 'ᴘᴇᴛɪᴛᴇꜱ ᴄᴀᴘɪᴛᴀʟᴇꜱ', gras: '𝐠𝐫𝐚𝐬', libre: 'Tel quel' };
export const DECORS = { lignes: '─── 📢 INFOS ───', simple: '📢 INFOS', sobre: 'INFOS', libre: 'Tel quel' };
export const MODES = { __proto__: null, restyler: 'Restyler l’existant', completer: 'Compléter ce qui manque', creer: 'Créer de zéro (l’ancien part aux archives)' };
export const SEASONS = { __proto__: null, halloween: 'Halloween', noel: 'Noël', printemps: 'Printemps', ete: 'Été' };

const SMALL = Object.fromEntries([...'abcdefghijklmnopqrstuvwxyz'].map((c, i) => [c, [...'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ'][i]]));
const bold = (c) => {
  const code = c.codePointAt(0);
  if (code >= 97 && code <= 122) return String.fromCodePoint(0x1d41a + code - 97);
  if (code >= 65 && code <= 90) return String.fromCodePoint(0x1d400 + code - 65);
  if (code >= 48 && code <= 57) return String.fromCodePoint(0x1d7ce + code - 48);
  return c;
};

export function naming(settingsOf) {
  return {
    preset: PRESETS[settingsOf('server_style')] ? settingsOf('server_style') : 'libre',
    mode: MODES[settingsOf('server_mode')] ? settingsOf('server_mode') : 'restyler',
    separator: SEPARATORS[settingsOf('server_sep')] ? settingsOf('server_sep') : 'point',
    casing: CASES[settingsOf('server_case')] ? settingsOf('server_case') : 'libre',
    decor: DECORS[settingsOf('server_decor')] ? settingsOf('server_decor') : 'libre',
    emoji: settingsOf('server_emoji') !== 'non',
    english: settingsOf('server_lang') === 'en',
  };
}

function cased(text, casing, category) {
  if (casing === 'capitales') return [...text.toLowerCase().normalize('NFD')].map((c) => SMALL[c] ?? c).join('').normalize('NFC');
  if (casing === 'gras') return [...(category ? text.toUpperCase() : text.toLowerCase())].map(bold).join('');
  if (casing === 'minuscules') return category ? text.toUpperCase() : text.toLowerCase();
  return text;
}

export function styleName(item, style, kind) {
  const base = String(item.nom ?? '').trim();
  if (style.casing === 'libre' && style.decor === 'libre') return base;
  const emoji = style.emoji && item.emoji ? String(item.emoji).trim() : '';
  if (kind === 'categorie') {
    const title = cased(base, style.casing, true);
    if (style.decor === 'lignes') return `─── ${emoji ? `${emoji} ` : ''}${title} ───`;
    if (style.decor === 'sobre') return title;
    return `${emoji ? `${emoji} ` : ''}${title}`;
  }
  const words = kind === 'vocal' ? base : base.replace(/\s+/g, '-');
  const name = cased(words, style.casing === 'libre' ? 'minuscules' : style.casing, false);
  return emoji ? `${emoji}${SEPARATORS[style.separator]}${name}` : name;
}

export function styleBrief(style, season = null) {
  const lines = [];
  if (PRESETS[style.preset].brief) lines.push(`Style de serveur : ${PRESETS[style.preset].label}. ${PRESETS[style.preset].brief}`);
  lines.push(`Mode : ${MODES[style.mode]}.`);
  lines.push(style.emoji ? 'Donne un emoji pertinent à chaque catégorie et salon (champ emoji).' : "Pas d'emoji (champ emoji vide).");
  lines.push(style.english ? 'Noms en anglais.' : 'Noms en français.');
  if (style.casing !== 'libre' || style.decor !== 'libre') lines.push('Donne des noms simples sans emoji ni séparateur dans « nom » : la mise en forme est appliquée ensuite par le code.');
  if (season) lines.push(`Thème saisonnier ${SEASONS[season]} : renomme seulement, avec des emojis et des tournures de ${SEASONS[season]}, en gardant le sens de chaque salon.`);
  return lines.join('\n');
}
