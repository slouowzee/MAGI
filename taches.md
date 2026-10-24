# MAGI — découpage en tâches

Spec : [magi-bot.md](magi-bot.md). Chaque lot dépend des précédents ; dans un lot, l'ordre est indicatif.

## 1. Socle

1. **Initialiser le projet Node** : discord.js, better-sqlite3, `.env`, structure des dossiers, Dockerfile. *Fini quand* : le bot se connecte et logue « prêt ».
2. **Application Discord** : créer le bot, activer l'intent *Message Content*, permissions explicites (pas Administrateur), inviter sur le serveur. Le rôle Opérateur MAGI vient de l'installation automatique (33).
3. **Détection des déclencheurs** : nom en début de message (`magi`, `melchior`, `balthasar`, `casper`, mot entier), mention, reply à un message de persona ; ignorer MP et messages modifiés. *Fini quand* : « j'ai revu l'épisode des MAGI » est ignoré, « magi, salut » ne l'est pas.
4. **Webhooks par salon** : création à la volée, cache, `thread_id`, nom et avatar par persona.
5. **Client Ollama** : appel chat, streaming, sortie imposée (`format`), file unique, timeout ; mode dégradé « MELCHIOR-1 : unité hors ligne ».
6. **Déploiement du bot sur Dokploy** : dans le projet MAGI, même réseau qu'Ollama, volume pour SQLite.
7. **Swap sur le VPS** (à faire en SSH) : 2 à 4 Go.
33. **Installation automatique** : rôle Opérateur MAGI sans permission, `#magi-logs`, rôle attribué au propriétaire, consigne pour glisser le rôle du bot dessous ; outils d'admin désactivés tant que la hiérarchie est incorrecte.

## 2. Personas et conversation

8. **Prompts système** des trois personas : caractère, garde-fous de CASPER, connaissance des deux autres unités.
9. **Règles de décision** : listes réaction / fin de conversation / longueur détaillée ; emojis de réaction.
10. **Choix de persona** : appel LLM à un mot (`melchior` / `balthasar` / `casper` / `vote`) ; persona mémorisée par fil avec expiration de 10 min.
11. **Contexte** : N derniers messages du salon, attribués à leur auteur (utilisateur ou persona).
12. **Réponse en streaming** : édition du message du webhook environ chaque seconde, découpe à 2000 caractères.
13. **Anti-flood** : délai minimum par utilisateur, message « BALTHASAR-2 : doucement ».

## 3. Vote

14. **Vote MAGI** : trois verdicts en JSON imposé, décompte dans le code, annonces (unanimité, 2 contre 1 + avis minoritaire, délibération impossible), déclencheur `magi vote`.

## 4. Outils et mémoire

15. **Schéma SQLite** : souvenirs, résumés, rappels, infractions, salons autorisés.
16. **Infrastructure d'outils** : déclaration des outils, contrôle du rôle Opérateur dans le code, bouton de confirmation rédigé par le code et cliquable par le seul demandeur, `reason` dans le journal d'audit, salon `#magi-logs`.
17. **Mémoire** : outils `retenir` / `oublier`, injection des souvenirs des personnes présentes dans le contexte.
18. **Résumés d'interactions** en fin de conversation.
19. **Outil `resumer`** : résumé des derniers messages du salon.
20. **Outil `rappel`** : stockage, planification, rechargement au démarrage.

## 5. Administration

21. **Outils de lecture** : journal d'audit, rôles, salons, infractions d'un membre.
22. **Outils membres** : exclusion temporaire, kick, ban / déban, pseudo, attribuer / retirer un rôle.
23. **Outils messages et salons** : supprimer, purge, épingler, mode lent ; créer, renommer, déplacer, archiver, supprimer un salon ; permissions d'un salon.
24. **Outils rôles** : créer, renommer, couleur, position, supprimer ; vérifier que la liste « jamais exposé » est respectée.
34. **Mise en place d'un serveur complet** : plan JSON par le LLM, aperçu + confirmation, exécution qui saute l'existant et journalise, annulation.
25. **Interventions spontanées** : outil `autoriser_interventions`, appel `intervenir` / `ignorer`, délai par salon, aucun outil disponible.

## 6. Modération autonome

26. **AutoMod Discord** : configurer les règles natives (mots, mentions, liens).
27. **Règles anti-spam dans le code** : faux Nitro, liens d'arnaque, même message multi-salons, rafales, invitations, comptes récents avec lien.
28. **Classification LLM** des messages suspects restants (`ok` / `spam` / `indésirable`).
29. **Sanctions** : compteur d'infractions (30 jours), barème en 3 étapes, exclusion immédiate si flagrant, exemptions, annulation par un opérateur, copie des messages supprimés dans `#magi-logs`.
30. **Vote avant ban** : ban seulement si 2 `APPROUVÉ`, sinon exclusion maintenue et alerte.
31. **Phase d'observation** : mode journal seul pendant une semaine, puis réglage des règles.

## 7. Finitions

32. **Visuels** des trois personas (avatars des webhooks).
