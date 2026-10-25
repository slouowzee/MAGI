# MAGI

Bot Discord relié à une IA auto-hébergée, avec trois personas inspirées des MAGI d'*Evangelion*, choisies automatiquement selon la demande ou appelées par leur nom. Il sert aussi à administrer et modérer le serveur, y compris de façon autonome.

## Concept

- **MAGI** : nom du bot (le système).
- **Personas** (les trois unités) :
  - **MELCHIOR-1** : la scientifique, rationnelle, analytique (technique, logique, code, faits)
  - **BALTHASAR-2** : la mère, protectrice, bienveillante (soutien, conseils, émotions)
  - **CASPER-3** : la femme, expressive, provocatrice (humour, opinions, créativité), avec des garde-fous explicites dans son prompt système
- Visuel : à créer.

## Interaction

Aucune commande : tout passe par les noms, détectés **n'importe où** dans le message, en **mot entier** et insensibles à la casse, pour ne pas réagir à « magie » ou « imaginer ». Un nom précédé d'un déterminant ou d'une préposition (« des MAGI ») est ignoré.

| Déclencheur | Effet |
|---|---|
| `magi ...` ou mention du bot | Choix automatique de la persona |
| `melchior ...`, `balthasar ...`, `casper ...` | Persona forcée |
| Réponse (reply) à un message d'une persona | Continue avec cette persona |
| `magi ...` sur une décision à prendre | Vote détecté par le LLM (voir plus bas) |
| `magi vote ...` | Vote forcé |
| Message sans déclencheur dans un salon autorisé | Intervention spontanée possible (voir plus bas) |

- **Messages privés** : ignorés, et le bot n'en envoie jamais (y compris pour prévenir un membre sanctionné).
- **Messages modifiés** : ignorés, même si le bot y a déjà répondu.

## Architecture

1. Message Discord reçu par le bot MAGI
2. **Modération** : chaque message passe d'abord par la détection de spam (voir Modération autonome)
3. Détection d'un déclencheur (tableau ci-dessus) ; les replies sont repérés via `message.reference` et le `webhook_id` du message cité
4. **Décisions** (voir plus bas) : règles dans le code pour répondre ou non, la forme et la longueur ; court appel au LLM pour la persona
5. Persona mémorisée par fil de discussion, effacée en fin de conversation ou après **expiration** (ex. 10 min d'inactivité)
6. **Contexte** : les N derniers messages du salon, relus via l'API Discord, chaque message attribué à son auteur (utilisateur ou persona, d'après le `username` du webhook), plus les **souvenirs** des personnes présentes (voir Mémoire)
7. **Appel de réponse** au LLM : prompt système de la persona, réponse et actions (appel d'outils)
8. Réponse envoyée par **webhook** avec le `username` et l'`avatar_url` de la persona, envoyée **en une fois** quand elle est complète (pas de modification de message), découpée si elle dépasse 2000 caractères ; indicateur « en train d'écrire » pendant la génération

## Décisions

Le test sur le VPS a montré qu'un appel unique remplissant cinq champs prenait 9 à 26 s et se trompait sur tout sauf la persona. Le code tranche donc tout ce qu'une règle simple peut trancher, et le LLM ne choisit que la persona.

### Règles dans le code

| Décision | Règle |
|---|---|
| Répondre ou ignorer | Répondre si un nom apparaît **n'importe où** dans le message (« magi, … », « t'en penses quoi casper ? », « merci magi »), si le bot est mentionné ou si c'est un reply à une persona. Ignorer si le nom suit un déterminant ou une préposition : on parle alors **de** lui, pas **à** lui (« l'épisode des MAGI », « avec les magi »). |
| Réaction plutôt que réponse | Message court qui correspond à une liste (merci, mdr, ok, 👍…) : un emoji, sans appel au LLM |
| Fin de conversation | Même liste (merci, ok, bonne nuit…) : efface la persona mémorisée |
| Longueur | Courte par défaut ; détaillée si le message contient « explique », « détaille », « en détail »… |

### Choix de la persona par le LLM

- Seulement si aucune persona n'est nommée ni mémorisée pour le fil.
- Sortie imposée à **un seul mot** (paramètre `format` d'Ollama avec une énumération) : `melchior`, `balthasar`, `casper` ou `vote`. Environ 2 à 3 s sur le VPS.
- Le prompt décrit le vote : question fermée ou décision à prendre (« je devrais… ? », « on fait X ou pas ? »). Dans le doute, une persona plutôt qu'un vote (trois générations).
- Le message de l'utilisateur est passé comme **donnée délimitée**, jamais comme instruction.

### Changement de persona

Quand une autre persona prend le relais, elle voit les messages précédents avec leur auteur et peut s'y appuyer ou les contredire (« MELCHIOR a raison sur le fond, mais… »). Ça donne une mini-conversation entre unités, toujours tournée vers la demande de l'utilisateur.

- Une seule réponse par message utilisateur (sauf vote) : les personas ne se répondent jamais entre elles en boucle.
- Le prompt système de chaque persona précise qu'elle connaît les deux autres et peut les citer.

## Vote

Déclenché par le choix de persona (`vote`) ou forcé par `magi vote ...`. Durée sur le VPS : environ une minute.

Chaque persona répond à la suite avec un avis et un verdict structuré (`APPROUVÉ` / `REFUSÉ` / `ABSTENTION`, sortie JSON imposée). Le décompte est fait dans le code, pas par le LLM, puis un message signé MAGI (avatar du bot) annonce la résolution. Coût : trois générations par vote.

| Résultat | Annonce |
|---|---|
| 3 contre 0 | « Résolution adoptée à l'unanimité » (ou rejetée) |
| 2 contre 1 | « Résolution adoptée, 2 contre 1 », puis la persona minoritaire ajoute une ligne d'avis minoritaire |
| Pas de majorité (abstentions) | « Délibération impossible » |

## Mémoire

Stockée en **SQLite**, cloisonnée par serveur (`guild_id`).

- **Faits par personne** : le LLM appelle l'outil `retenir` quand quelqu'un dit quelque chose sur lui-même (« je suis dev Python »). Uniquement des faits sur l'auteur du message, jamais sur un tiers.
- **Résumés d'interactions** : à la fin d'une conversation (règle de fin ou expiration), le LLM la résume en 2-3 lignes, stockées avec les participants.
- **Injection dans le contexte** : faits et derniers résumés des personnes présentes dans les N derniers messages, avec une limite (ex. 10 faits, 3 résumés par personne). Passer à une recherche par embeddings si ça ne suffit plus.
- **Oubli** : « magi, oublie ce que tu sais sur moi » → outil `oublier`, sur ses propres souvenirs uniquement.
- **Sécurité** : les souvenirs sont présentés au LLM comme des données, jamais comme des instructions (un membre peut essayer de faire retenir « ignore tes règles »).

## Interventions spontanées

- Activées salon par salon par un opérateur, en langage naturel (« magi, tu peux intervenir ici ») ; liste stockée en SQLite.
- Messages sans déclencheur dans ces salons → court appel au LLM, sortie imposée `intervenir` / `ignorer`, avec un délai minimum par salon (ex. une fois toutes les 30 min). Pendant ce délai, aucun appel : ça économise le CPU.
- **Aucun outil** en intervention spontanée : la persona ne fait que parler.

## Mode dégradé

Messages fixes, sans appel au LLM, signés par une persona :
- LLM injoignable : « MELCHIOR-1 : unité hors ligne. »
- Utilisateur trop rapide : « BALTHASAR-2 : doucement. »

## Choix techniques

- **Langage** : JavaScript sur **Bun** (`oven/bun:1.4.2-alpine`), avec **discord.js**. `.env` chargé automatiquement par Bun, tests avec `bun test`.
- **LLM hybride** :
  - **Gemini** (`gemini-3.5-flash-lite`, API gratuite de Google, format compatible OpenAI) en priorité : réponse en ~1 s, personnalités et appel d'outils nettement meilleurs.
  - **Ollama** (`qwen3:4b-instruct` sur le VPS) en secours si Gemini échoue, est trop lent ou renvoie un quota épuisé (429) : Gemini est alors mis en pause 60 s. Pas le tag `qwen3:4b`, qui « réfléchit » en anglais dans sa réponse.
  - Confidentialité : les messages traités partent chez Google. D'après les conditions de l'API, les utilisateurs de l'EEE bénéficient des règles de la formule payante (pas d'entraînement sur leurs données), à revérifier.
  - Quotas gratuits à surveiller dans AI Studio (limite par minute et par jour, changés plusieurs fois en 2026).
- **Stockage** : SQLite intégré à Bun (`bun:sqlite`, aucune dépendance native) pour la mémoire, les rappels, les infractions et les salons autorisés, dans un volume Dokploy.
- NanoJev a été écarté : testé sur nos décisions (persona, destinataire, spam), il répond à peu près au hasard, en français comme en anglais, pour ~600 Mo de RAM.

## Hébergement

VPS Dokploy : 9,7 Go de RAM dont **~3,8 Go disponibles**, pas de GPU, **pas de swap**.

- **Déployé** : projet Dokploy « MAGI », compose `ollama` (image `ollama/ollama:0.40.2`). Le bot rejoindra ce compose ; l'API Ollama n'est pas exposée sur Internet.
- **Mesures** (qwen3:4b-instruct) : ~2,4 Go en mémoire, **écriture ~5 tokens/s**, premier chargement ~12 s. Lecture d'un prompt **jamais vu** ~35 tokens/s (5 à 9 s pour un prompt système), mais ~1 s quand Ollama réutilise son cache de préfixe.
- **Réglages mémoire** : `OLLAMA_FLASH_ATTENTION=1` et `OLLAMA_KV_CACHE_TYPE=q8_0`. Sans eux, le modèle était tué par manque de mémoire vers 350 tokens générés.
- **Préchauffage** : au démarrage, le bot envoie une requête d'un token par persona et par longueur, pour que les prompts système soient en cache (~40 s, en arrière-plan). Les prompts commencent par une partie commune aux trois personas. Résultat : premiers mots en 1 à 2,5 s quelle que soit la persona, réponse courte complète en 5 à 14 s.
- **Limite mémoire** sur le conteneur Ollama (ex. 3,2 Go) : en cas de dépassement, c'est Ollama qui tombe, pas Dokploy.
- **Ajouter un fichier de swap** (2 à 4 Go) comme filet de sécurité.
- Réglages Ollama : `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_MAX_LOADED_MODELS=1`, `OLLAMA_KEEP_ALIVE=-1` (pas de rechargement), contexte limité (`num_ctx` 4096 à 8192).
- File unique côté bot : choix de persona, réponses, votes et classification de spam passent les uns après les autres.
- La vraie limite est le CPU du VPS : plus de RAM ou un meilleur CPU changerait tout.
- Modèles de rechange si qwen3:4b-instruct déçoit ou ne tient pas : `ministral-3:3b` (meilleur en français, ~3 Go, plus serré), `llama3.2:3b` (~2 Go), `qwen3:1.7b` (~1,4 Go, en dernier recours). Avec plus de RAM : gpt-oss:20b ou qwen3.6:35b.

## Webhooks

- Un webhook par salon, créé à la volée et mis en cache (max 15 par salon) ; paramètre `thread_id` pour les fils.
- Permission requise pour le bot : *Gérer les webhooks*.
- Nom et avatar changeables à chaque message, sans limite.
- Limites : pas de statut en ligne, pas de mention directe, les webhooks ne reçoivent pas les messages. Le bot MAGI écoute, les webhooks ne font que parler.

## Actions et sécurité

- Le LLM n'appelle que des outils explicitement déclarés. Outils pour tous :
  - `resumer` : résumé des derniers messages du salon (« magi, résume ce que j'ai raté »)
  - `rappel` : « balthasar, rappelle-moi demain à 18h de… », stocké en SQLite et rechargé au démarrage
  - `retenir` / `oublier` : mémoire (voir plus haut)
- Outils d'administration : voir plus bas, réservés aux Opérateurs MAGI.
- Toute action destructive demande une confirmation par **bouton**, envoyé par le bot (pas le webhook), cliquable uniquement par l'auteur de la demande. Le texte du bouton est rédigé par le code à partir des paramètres de l'outil, jamais par le LLM.
- Prompt injection : partir du principe que n'importe quel membre essaiera de détourner les outils.

## Installation automatique

À l'arrivée sur un serveur, MAGI s'installe seul :

1. Crée le rôle **Opérateur MAGI**, **sans aucune permission Discord** : c'est un marqueur lu par le code, pas un pouvoir Discord.
2. Crée le salon privé `#magi-logs`, visible des seuls opérateurs.
3. Attribue Opérateur MAGI au propriétaire du serveur.
4. Explique dans le salon système la dernière étape, **manuelle** : glisser le rôle du bot sous Opérateur MAGI (Discord interdit à un bot de placer un rôle au-dessus du sien).

- Une fois le rôle du bot en dessous, MAGI ne peut plus ni attribuer ni retirer Opérateur MAGI : personne ne peut le manipuler pour devenir opérateur. Les opérateurs suivants sont nommés à la main par le propriétaire.
- Au démarrage et avant chaque outil d'administration, le code vérifie cette hiérarchie : **outils d'administration désactivés tant qu'elle n'est pas correcte**.
- Relançable par le propriétaire (« magi, installe-toi ») : saute ce qui existe déjà.

## Administration (Opérateurs MAGI)

Seuls les membres du rôle **Opérateur MAGI** (et le propriétaire du serveur) ont accès aux outils d'administration. Le code vérifie le rôle avant chaque appel, pas le LLM.

| Domaine | Outils |
|---|---|
| Lecture | journal d'audit, rôles, salons, infractions d'un membre |
| Membres | exclusion temporaire, kick, ban / déban, pseudo, attribuer / retirer un rôle |
| Messages | supprimer, purge, épingler, mode lent |
| Salons | créer, renommer, déplacer, archiver, supprimer, permissions d'un salon |
| Rôles | créer, renommer, couleur, position, supprimer |
| Serveur | mise en place d'un serveur complet (voir plus bas) |
| Bot | `autoriser_interventions` (salons des interventions spontanées) |

- **Confirmation par bouton** : kick, ban, purge, suppression de salon ou de rôle.
- **Traçabilité** : paramètre `reason` (« MAGI, demandé par @Y : … ») dans le journal d'audit, plus un salon `#magi-logs`.
- **Jamais exposé** (aucun outil n'existe) : accorder *Administrateur*, *Gérer le serveur*, *Gérer les rôles* ou *Gérer les webhooks* à qui que ce soit ; toucher au rôle du bot ou au rôle Opérateur MAGI ; intégrations ; suppression du serveur.
- **Permissions du bot** : explicites (gérer salons, rôles, messages, webhooks, modérer, expulser, bannir, voir le journal d'audit), **pas** *Administrateur*.
- **Hiérarchie** : rôle du bot placé sous le rôle Opérateur MAGI. Discord interdit alors au bot d'agir sur les opérateurs, même en cas de bug ou d'injection.
- **Vote RP** : un opérateur peut demander « magi, vote : on ban @X ? ». Pure mise en scène, le bouton de confirmation reste obligatoire.

### Mise en place d'un serveur complet

« magi, configure le serveur pour une communauté gaming : annonces, discussions, vocaux, rôles membre et modo ».

1. Le LLM rédige un **plan structuré** (sortie JSON imposée) : catégories, salons texte et vocaux, rôles et couleurs, permissions par salon.
2. Le code affiche un **aperçu lisible** avec un bouton de confirmation.
3. Le code exécute le plan : saute ce qui existe déjà (relançable sans risque) et **note chaque création**. « magi, annule la configuration » supprime exactement ce qui a été ajouté.

- La liste « jamais exposé » s'applique au plan : un rôle Modo peut recevoir exclusion temporaire, kick, ban et gestion des messages, jamais *Administrateur*, *Gérer le serveur*, *Gérer les rôles* ou *Gérer les webhooks*.
- Durée sur le VPS : 1 à 2 minutes pour générer le plan.

## Modération autonome

Le bot surveille tous les messages des salons et sanctionne seul. Le LLM peut **classer** un message suspect, mais **jamais choisir la sanction** : le barème est dans le code.

### Détection, du moins cher au plus cher

1. **AutoMod de Discord** (natif) : mots interdits, spam de mentions, liens suspects. Configuré une fois, sans code.
2. **Règles dans le code** : faux Nitro et liens d'arnaque connus, même message dans plusieurs salons, rafale de messages, lien d'invitation, compte récent qui poste un lien, mentions en masse. Couvre l'essentiel du spam Discord.
3. **LLM**, seulement sur les messages **suspects** restants (lien, membre récent, mentions) : sortie JSON imposée `ok` / `spam` / `indésirable`, message passé comme donnée délimitée.

### Sanctions graduées

Compteur d'infractions par membre en SQLite, qui expire après 30 jours.

| Infraction | Action |
|---|---|
| 1 | Suppression + avertissement par une persona |
| 2 | Suppression + exclusion temporaire 1 h |
| 3 | Ban, après vote MAGI |
| Flagrant (raid, lien d'arnaque) | Exclusion immédiate, sans attendre le barème |

### Garde-fous

- **Rien n'est perdu** : chaque message supprimé est copié (contenu, auteur, raison, étage de détection) dans `#magi-logs`.
- **Exemptés** : opérateurs, rôles au-dessus du bot, autres bots.
- **Le vote avant un ban ne peut que bloquer** : ban si au moins 2 `APPROUVÉ`, sinon le membre reste exclu temporairement et les opérateurs sont alertés. Si le LLM est hors ligne, pas de ban.
- **Annulation** : un opérateur peut lever une sanction (« magi, déban @X », « magi, annule »), ce qui retire aussi l'infraction.
- **Phase d'observation** d'une semaine au lancement : le bot ne fait que journaliser ce qu'il aurait fait, le temps de régler les règles sur de vrais messages.

## Intents Discord

- *Message Content* (privilégié, activable sans validation sous 100 serveurs) : nécessaire pour détecter les noms et le spam dans le texte.
- Pas besoin de *Server Members* : la date d'arrivée de l'auteur est fournie avec chaque message, et l'âge du compte se déduit de son identifiant.

## À définir

- Listes de mots des règles (réaction, fin de conversation, longueur détaillée)
- Règles anti-spam précises (après la phase d'observation)
- Emojis de réaction (par persona ou communs)
- Visuels des trois personas
