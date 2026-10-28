# MAGI

Bot Discord à trois personas inspirées des MAGI d'*Evangelion* : Melchior, Balthasar et Casper.

- Spécification : [docs/spec.md](docs/spec.md)
- Suivi des tâches : Plane (projet MAGI)

## Structure

```
src/
  index.js                démarrage du client Discord et branchement des événements
  tools.js                registre des outils du LLM, droits d'accès, confirmation, journal
  core/                   socle partagé, sans fonction métier
    db.js settings.js     base SQLite et réglages par serveur
    config.js             modules activables et options
    personas.js           noms et avatars des trois unités
    permissions.js        niveaux de permissions et liens d'autorisation
    installation.js       rôle Opérateur MAGI, catégorie et salons MAGI, hiérarchie
    llm/                  Gemini et Groq en relais, prompts, boucle d'appel d'outils
    discord/              voix des personas (webhooks), historique, médias, découpe, boutons
    log/                  logs syslog, salons de logs Discord, journal du VPS
  panel/                  panneau #magi-config
    index.js              rendu, navigation, vues privées, interactions
    ui.js                 briques communes (interrupteurs, menus, alertes)
    pages/                une page par fichier
  features/               une fonction par dossier : logique, stockage (store.js), outils (tools.js)
    conversation/         qui répond et comment, interventions, résumé du salon, rattrapage
    commands/             clic droit, /chuchoter, /magi
    memory/               mémoire fortunememory et contexte injecté
    reminders/            rappels
    vote/                 votes et débats entre unités
    community/            Hall of Fame, anniversaires, synchronisation, tickets, vocaux temporaires
    moderation/           détection et sanctions
    security/             anti-nuke, AutoMod, audit, sauvegardes, filtre, anti-raid, honeypot
    admin/                outils d'administration (salons, membres, rôles, publications, scaffold)
    presence/             statut du bot
    welcome/              arrivées et départs
```

`ops/magi-journal.service` : service systemd du VPS qui transmet le journal système au bot.

`bun run eval [persona…]` : rejoue un jeu de messages sur les vrais modèles et affiche réponses et latences, pour vérifier une retouche des prompts.

Les tests sont à côté du fichier qu'ils testent (`*.test.js`).

## Commandes

```bash
bun install
bun test
bun run eval
bun start
```

`bun start` lance le bot en local avec le `.env` (voir `.env.example`). Ne pas le lancer pendant que le bot tourne sur Dokploy : les deux répondraient en double.

## Déploiement

Un `git push` sur `main` redéploie automatiquement l'application `bot` dans Dokploy.
