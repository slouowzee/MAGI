<p align="center">
  <img src=".github/assets/banner.png" alt="Melchior, Balthasar et Casper" width="100%">
</p>

<h1 align="center">MAGI</h1>

<p align="center">
  Bot Discord à trois voix : il discute, il délibère, il veille sur le serveur.
</p>

---

## D'où vient MAGI

Dans *Neon Genesis Evangelion*, les MAGI sont les trois superordinateurs de la NERV. Le Dr Naoko Akagi y a gravé trois facettes de sa personnalité : la scientifique, la mère et la femme. Les grandes décisions passent par un vote à la majorité.

Le bot reprend cette idée. Un seul bot, MAGI, et trois unités qui parlent chacune avec sa voix et son avatar :

| Unité | Rôle | Sujets |
|---|---|---|
| **Melchior** | la scientifique, rationnelle et analytique | technique, code, faits, vérification |
| **Balthasar** | la mère, protectrice et bienveillante | soutien, conseils, émotions, accueil |
| **Casper** | la femme, expressive et provocatrice | humour, opinions, créativité |

Elles se connaissent, peuvent se citer ou se contredire, et votent ensemble quand une décision se pose.

## Comment ça fonctionne

### Parler à MAGI

Pas de commande à retenir : on appelle MAGI ou une unité par son nom, n'importe où dans le message.

- `magi, …` laisse MAGI choisir l'unité la plus adaptée ; `casper, …` l'appelle directement.
- Répondre à une unité, ou lui écrire juste après sa réponse, continue l'échange sans répéter son nom.
- Un nom cité au passage (« l'épisode des MAGI ») est ignoré : MAGI répond quand on lui parle, pas quand on parle de lui.

### Le chemin d'un message

1. **Modération** : chaque message passe d'abord par la détection de spam et d'arnaques.
2. **Décision** : le code tranche tout ce qu'une règle simple peut trancher (répondre ou non, réagir, longueur, anti-flood). Le modèle ne choisit que l'unité, en un seul mot.
3. **Conversation** : le message est rattaché à une conversation du salon. Un salon peut en porter plusieurs à la fois, chacune avec ses participants et ses unités.
4. **Contexte** : les messages de la conversation, les images, gifs et vocaux joints, et les souvenirs des personnes présentes.
5. **Réponse** : le modèle répond avec la personnalité de l'unité et peut appeler des outils (rappel, mémoire, administration…).
6. **Envoi** : la réponse part par webhook, avec le nom et l'avatar de l'unité.

### Les votes

Sur une question fermée (« on fait X ou pas ? »), les trois unités votent en parallèle sans voir les votes des autres. Le décompte est fait par le code, MAGI annonce la résolution, puis l'unité minoritaire donne son avis.

### Ce que MAGI sait faire

- **Mémoire** : des faits sur chaque personne et des résumés de conversations, retrouvés par recherche hybride (plein texte et vecteurs locaux). `/oublier` efface tout.
- **Communauté** : rappels, débats, sondages, événements, anniversaires, Hall of Fame, taux de synchronisation, tickets, salons vocaux temporaires.
- **Modération autonome** : AutoMod de Discord, règles dans le code, puis le modèle sur les seuls messages suspects. Le modèle classe, le code sanctionne selon un barème gradué, et un bannissement passe par un vote des trois unités.
- **Sécurité** : anti-nuke, anti-raid, honeypot, filtre à l'arrivée, sauvegardes quotidiennes de la structure.
- **Administration** : salons, rôles, membres et messages gérés en langage naturel par les Opérateurs MAGI, avec confirmation pour tout ce qui est destructif.
- **Mise en place d'un serveur** : structure complète générée selon un style (gaming, études, NERV…), aperçu, application avec barre de progression, annulation possible.
- **Panneau `#magi-config`** : un seul message interactif pour activer, couper et régler chaque module.

### Garde-fous

- Le modèle n'agit qu'à travers des outils déclarés, et le code revérifie les droits avant chaque exécution.
- Les messages et souvenirs sont passés au modèle comme données, jamais comme instructions.
- Le rôle Opérateur MAGI n'a aucune permission Discord : c'est un marqueur lu par le code. Le rôle du bot est placé en dessous, donc MAGI ne peut ni le donner ni toucher aux opérateurs.
- Aucun outil ne donne de permission d'administration ni ne supprime le serveur.

## Comment il a été développé

MAGI a été écrit en JavaScript sur **Bun**, avec **discord.js** et SQLite intégré à Bun.

Le projet a avancé à partir d'une spécification tenue à jour au fil du développement, et chaque choix a été testé sur le vrai serveur avant d'être gardé :

- **Le code décide, le modèle parle.** Tout ce qu’une règle simple peut trancher l’est par le code ; le modèle choisit l’unité, répond et appelle les outils dont il a besoin.
- **Pas de modèle local.** MAGI utilise une chaîne de fournisseurs (Gemini, Mistral, Groq) qui se relaient : si un modèle tarde, le suivant est lancé en parallèle, et un modèle en erreur est mis en pause. Pourquoi ? Parce que j'ai tout simplement pas les ressources pour faire tourner un gros modèle en local T-T.
- **Des personnages travaillés.** Chaque unité a ses goûts, ses relations avec les deux autres et une banque d'exemples que les opérateurs enrichissent en réagissant aux bonnes réponses.
- **Mémoire avec [fortunememory](https://www.npmjs.com/package/fortunememory).** La mémoire repose sur la bibliothèque de [itsrealfortune](https://github.com/itsrealfortune/fortunememory) : stockage SQLite local, recherche hybride (plein texte et vecteurs) et aucun appel réseau. Chaque membre a son propre espace, avec ses faits d'un côté et ses résumés de conversations de l'autre.
- **Tests et banc d'essai.** Les tests unitaires sont à côté du code qu'ils testent, et un banc d'essai rejoue des messages types sur les vrais modèles pour mesurer réponses et latences après chaque retouche des prompts.
