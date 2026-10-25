# MAGI

Bot Discord à trois personas inspirées des MAGI d'*Evangelion* : Melchior, Balthasar et Casper.

- Spécification : [docs/spec.md](docs/spec.md)
- Découpage en tâches : [docs/taches.md](docs/taches.md), suivi dans Plane (projet MAGI)

## Structure

```
src/
  index.js                    démarrage du client Discord et branchement des événements
  personas.js                 noms et avatars des trois unités
  conversation/               qui répond, et comment
    handle-message.js         traitement d'un message, du déclencheur à la réponse
    triggers.js               détection des noms, du vote, des demandes détaillées
    router.js                 choix et mémoire de la persona par salon
    rules.js                  réactions rapides et anti-flood
  discord/                    échanges avec Discord
    webhooks.js               voix des personas
    buttons.js                boutons sous les messages
    history.js                derniers messages du salon pour le contexte
    split.js                  découpe sous la limite de 2000 caractères
  llm/                        modèles de langage
    client.js                 Gemini en priorité, Ollama en secours
    prompts.js                prompts système des personas, nettoyage des réponses
    respond.js                boucle d'appel d'outils
  tools/                      outils que le LLM peut appeler
    index.js                  registre, droits d'accès, confirmation, journal
    installation.js           état et installation de MAGI
  server/
    installation.js           rôle Opérateur MAGI, #magi-logs, hiérarchie
  storage/
    db.js                     base SQLite
```

Les tests sont à côté du fichier qu'ils testent (`*.test.js`).

## Commandes

```bash
bun install
bun test
bun start
```

`bun start` lance le bot en local avec le `.env` (voir `.env.example`). Ne pas le lancer pendant que le bot tourne sur Dokploy : les deux répondraient en double.

## Déploiement

Un `git push` sur `main` redéploie automatiquement l'application `bot` dans Dokploy.
