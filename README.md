# Bot Bobcat + Panel

Bot Discord de gestion des opérations de **Bobcat Security** (patrouilles, missions ATM, prises de service, convois de fonds, sécurisations) et **panel web** pour piloter le tout depuis un navigateur.

Les deux partagent la même base MongoDB. Le fonctionnement attendu est décrit dans [`DOCUMENTATION_BOT.md`](DOCUMENTATION_BOT.md) ; ce README explique l'installation et les choix faits là où la documentation laissait de la place à l'interprétation.

---

## Sommaire

1. [Ce qui est inclus](#ce-qui-est-inclus)
2. [Installation](#installation)
3. [Configuration Discord](#configuration-discord)
4. [Variables d'environnement](#variables-denvironnement)
5. [Permissions](#permissions)
6. [Commandes du bot](#commandes-du-bot)
7. [Panel web](#panel-web)
8. [Découvrir sans Discord (mode démo)](#découvrir-sans-discord-mode-démo)
9. [Tests](#tests)
10. [Choix à valider ensemble](#choix-à-valider-ensemble)
11. [Structure du projet](#structure-du-projet)

---

## Ce qui est inclus

| Domaine | Bot Discord | Panel web |
|---|---|---|
| Patrouilles | `/patrouille`, `/patrouille-v2` (Components v2), lieux avec arrivée/sortie/correction, fin de patrouille | Historique filtrable, export CSV, correction des horaires, fin ou suppression |
| Lieux | `/patrol add/edit/delete/list` avec limite d'heures par semaine | CRUD complet, activation/désactivation |
| Temps hebdo | `/patrol-time` (tableau mis à jour toutes les 15 min et à chaque fin de patrouille), `/patrol-time-reset` | Tableau en direct (rafraîchi toutes les 30 s), navigation par semaine, réinitialisation |
| Inactivité | Alerte au créateur après 45 min sans action (DM, sinon mention dans le salon), supprimée à la reprise | Délai réglable |
| ATM | `/atm`, disponibilités par réactions ✅/❌, dispatch des rôles par menus, terminer/annuler (avec notification) | Dispatch en tableau (agents × rôles), statut, disponibilités |
| PDS | `/pds`, équipage repris du dispatch, ajout d'ATM avec **photos directement dans le formulaire** (5 max) | Détail avec galerie photo, suppression d'ATM, clôture |
| Convois | `/convoi`, réactions, dispatch, reprogrammation (agents prévenus), terminer/annuler | Création, dispatch, reprogrammation, statut |
| Sécurisations | `/secu` : jours, créneaux (TEAM 1, 2…), inscription en un clic, rappels de prise de service, clôture automatique | Création avec aperçu, édition des jours/créneaux/capacités, inscription/désinscription d'agents |
| Utilitaires | `/clear`, `/say`, `/separateur` | — |
| Pilotage | Journal d'audit de chaque action | Tableau de bord, statistiques (heures, classements, carte des disponibilités), permissions par rôle, journal |

Au démarrage, le bot **restaure** les sessions en cours (patrouilles, PDS, missions, sécurisations, tableaux de temps), resynchronise les réactions ajoutées pendant qu'il était éteint et recrée les messages supprimés.

---

## Installation

Prérequis : **Node.js 20.11+**, une base **MongoDB** (Atlas ou locale) et une application Discord.

```bash
npm install
```

```bash
cp .env.example .env
```

Remplis le fichier `.env` (voir ci-dessous), puis lance le bot et le panel ensemble :

```bash
npm start
```

Ou séparément (par exemple sur deux services d'hébergement) :

```bash
npm run bot
```

```bash
npm run panel
```

Au premier démarrage, le bot affiche dans les logs son **lien d'invitation** et enregistre les commandes slash sur le serveur `GUILD_ID` (disponibles immédiatement).

---

## Configuration Discord

Dans le [portail développeur](https://discord.com/developers/applications) :

1. **Bot** → *Reset Token* → copie le token dans `DISCORD_TOKEN`.
2. **Bot** → *Privileged Gateway Intents* → active **SERVER MEMBERS INTENT** (nécessaire pour synchroniser les membres et leurs rôles vers le panel).
3. **OAuth2** → copie *Client ID* et *Client Secret* dans `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`.
4. **OAuth2** → *Redirects* → ajoute `PANEL_BASE_URL/auth/callback` (par exemple `http://localhost:3000/auth/callback`).
5. Invite le bot avec le lien affiché dans les logs (scopes `bot` + `applications.commands`, permissions : voir les salons, envoyer des messages, liens intégrés, fichiers, historique, réactions, gérer les messages, emojis externes, mentionner les rôles).

Le contenu des messages (intent *Message Content*) n'est **pas** nécessaire.

---

## Variables d'environnement

| Variable | Obligatoire | Rôle |
|---|---|---|
| `DISCORD_TOKEN` | bot | Token du bot |
| `GUILD_ID` | oui | Serveur géré (commandes + panel) |
| `MONGODB_URI` | oui | Connexion MongoDB |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | panel | Connexion au panel avec Discord |
| `PANEL_BASE_URL`, `PANEL_PORT` | panel | URL publique et port du panel |
| `PANEL_SESSION_SECRET` | panel (prod) | Secret des sessions (obligatoire si `NODE_ENV=production`) |
| `SUPER_USER_IDS`, `SUPER_USER_ROLE_IDS` | non | Super-users « de secours », toujours autorisés |
| `CLOUDINARY_*` | non | Hébergement des photos de PDS |
| `TZ` | conseillé | Fuseau des heures saisies (`Europe/Paris` par défaut dans l'exemple) |
| `EMOJI_*`, `BRAND_NAME` | non | Emojis personnalisés et nom affiché |
| `PANEL_DEV_LOGIN`, `PANEL_DEV_USER_ID` | non | Connexion sans Discord pour tester en local (désactivée en production) |

---

## Permissions

- **Super-users** : le propriétaire du serveur, les IDs/rôles de `SUPER_USER_*`, et ceux définis dans le panel (*Paramètres*). Ils ont accès à tout.
- **Permissions par rôle** (réglées dans le panel) : `patrouille`, `atm`, `pds`, `secu`, `convoi`, `panel`, `agent`.
  - Aucun rôle coché = **réservé aux super-users**.
  - Exception : `agent` (réagir aux missions, s'inscrire aux créneaux) — aucun rôle coché = **tout le monde**.
- Les agents d'une patrouille (mentionnés à la création) peuvent la modifier ; le responsable d'une mission ATM/convoi peut gérer son dispatch ; l'équipage d'une PDS peut y ajouter des ATM.
- `/clear`, `/say`, `/separateur` demandent la permission Discord *Gérer les messages*.

Premier lancement : connecte-toi au panel avec le compte propriétaire du serveur, puis attribue les rôles dans *Paramètres*.

---

## Commandes du bot

| Commande | Description |
|---|---|
| `/patrouille unité agents [heure_debut]` | Patrouille (embed). Agents : mentions et/ou matricules |
| `/patrouille-v2 …` | Même chose avec l'interface Components v2 |
| `/patrol add\|edit\|delete\|list` | Lieux de patrouille (emoji unicode ou custom, limite hebdo, 0 = illimité) |
| `/patrol-time` | Publie le tableau du temps de la semaine dans le salon |
| `/patrol-time-reset lieu\|tous` | Remet à zéro la semaine en cours (confirmation pour « tous ») |
| `/atm date heure frequence [mention]` | Mission ATM (S6/S7/S8) |
| `/pds immatriculation [mission]` | Prise de service ATM |
| `/convoi date heure [notes]` | Ordre de mission de convoi |
| `/secu …` | Sécurisation (voir ci-dessous) |
| `/clear nombre [membre]`, `/say message [salon]`, `/separateur [titre]` | Utilitaires |

Heures acceptées partout : `21h`, `21h30`, `21:30`, `2130`. Dates : `16/05`, `16/05/2026`.

### Syntaxe de `/secu`

- `date_et_jours` : `17/08:3` (3 jours à partir du 17/08) ou `14/08,17/08` (jours précis).
- `template` : `19h-00h` (un créneau), `19h-21h,21h-23h` (deux créneaux) ou `19h-01h/2h` (découpage automatique en créneaux de 2 h). Une fin avant le début = le lendemain.
- `planning` (exceptions, séparées par `;`) : `18/08=20h-23h; 19/08 off`.
- Chaque jour devient un message avec un bouton par créneau (TEAM 1, TEAM 2…) : cliquer inscrit, recliquer désinscrit. L'inscription est atomique (pas de surréservation en cas de clics simultanés).
- Rappels : dans `salon_pds` (ou le salon de la mission), au début de chaque créneau avec mention des inscrits ; pour la TEAM 1 de chaque jour, `brief_offset` minutes avant. Alerte si un créneau n'a aucun inscrit.

---

## Panel web

Pages : tableau de bord, patrouilles (historique, détail), temps hebdo, lieux, missions ATM, PDS, convois, sécurisations, statistiques, journal, paramètres.

**Synchronisation avec Discord** : quand tu modifies quelque chose dans le panel, les données sont enregistrées en base puis une action est mise en file ; le bot la traite dans les 5 secondes et met à jour (ou crée, ou supprime) les messages Discord concernés. Si le bot est éteint, les actions attendent son retour. Le tableau de bord indique si le bot est en ligne et combien d'actions sont en attente.

Thème clair/sombre (suit le système, bouton 🌙/☀️), utilisable sur mobile.

---

## Découvrir sans Discord (mode démo)

Pour voir le panel avec des données fictives, sur une base de test :

```bash
GUILD_ID=999999999999999999 MONGODB_URI=mongodb://127.0.0.1:27017/bobcat_demo npm run seed:demo
```

```bash
GUILD_ID=999999999999999999 MONGODB_URI=mongodb://127.0.0.1:27017/bobcat_demo PANEL_DEV_LOGIN=true PANEL_DEV_USER_ID=100000000000000001 npm run panel
```

Puis ouvre `http://localhost:3000` → *Connexion de développement*. Le script refuse d'écrire sur un serveur qui contient déjà des patrouilles (sauf `--force`) : ne l'utilise pas sur ta vraie base.

---

## Tests

```bash
npm test
```

- Tests unitaires : lecture des heures/dates, semaines ISO, planning des sécurisations, rendu de tous les messages Discord (validés par discord.js).
- Scénarios complets du bot avec un faux client Discord et une vraie base MongoDB (`TEST_MONGODB_URI`, par défaut `mongodb://127.0.0.1:27017/bobcat_test_flows`, base effacée à chaque passage) : patrouille de bout en bout, alertes d'inactivité, ATM + réactions + dispatch + PDS + annulation, convoi + reprogrammation, sécurisation avec clics simultanés, rappels et clôture, file d'actions du panel. Ils sont ignorés si MongoDB n'est pas joignable.

---

## Choix à valider ensemble

La documentation laissait certains points ouverts. Voici ce qui a été décidé — tout est modifiable :

**Patrouilles**
- Une patrouille par salon à la fois ; le créateur, les agents mentionnés et le rôle `patrouille` peuvent la modifier.
- La limite hebdomadaire d'un lieu **bloque** sa sélection quand elle est atteinte (sauf super-user). Le tableau ne compte que les patrouilles terminées, dans la semaine de leur début.
- Les heures dans le futur (plus de 15 min) sont refusées ; une heure seule est rattachée au jour le plus proche (gère le passage de minuit).
- « Terminer » demande l'heure de fin (préremplie). « Corriger » permet aussi de supprimer un passage.
- Option `heure_debut` ajoutée pour déclarer une patrouille commencée plus tôt.

**ATM / PDS**
- Une mission ATM ouverte par responsable. Disponibilités par réactions ✅/❌ (une seule à la fois par agent).
- `/pds` prend la mission ATM ouverte où tu es responsable ou dispatché, sinon la plus récente (ou celle choisie avec l'option `mission`). Une PDS par véhicule et par mission.
- Photos : envoyées dans le formulaire « Ajouter un ATM ». Sans Cloudinary, elles sont republiées dans le salon (les liens Discord peuvent expirer dans le panel).
- Annulation : formulaire avec raison, les agents disponibles et dispatchés sont mentionnés.

**Convois**
- Rôles de dispatch proposés : Chef de convoi, Conducteur fourgon, Escorte, Fusil à pompe, U2R, Besoin d'explication.
- Boutons « Terminer » et « Annuler » ajoutés (absents de la doc) pour pouvoir clôturer.
- La reprogrammation garde les disponibilités et demande aux agents de les mettre à jour.

**Sécurisations**
- `salon_info` reçoit une annonce avec lien vers les inscriptions ; `salon_pds` reçoit les rappels.
- Les créneaux d'un jour sont nommés TEAM 1, 2… dans l'ordre chronologique (20 maximum par jour, 14 jours maximum).
- La mission se clôture automatiquement après son dernier créneau.

**Général**
- Le « système de forum » cité dans la vue d'ensemble n'est pas implémenté (aucun détail dans la doc).
- Fuseau horaire : la variable `TZ` (Europe/Paris dans l'exemple) évite les décalages sur un hébergeur en UTC.

---

## Structure du projet

```
src/
├── index.js              # Lance le bot et le panel
├── utils/                # Configuration, logs, dates, constantes
├── db/
│   ├── models/           # Modèles Mongoose (patrouilles, missions, cache Discord, audit, file d'actions)
│   └── services/         # Temps hebdo, planning sécu, permissions, audit, file d'actions
├── bot/
│   ├── commands/         # Commandes slash
│   ├── handlers/         # Boutons, menus et formulaires (préfixe du customId)
│   ├── renderers/        # Construction des messages Discord
│   ├── services/         # Mise à jour des messages, réactions, restauration, synchro serveur
│   ├── events/           # Événements Discord
│   ├── jobs/             # Tâches planifiées (file du panel, nettoyage…)
│   └── utils/            # Permissions, modals, watcher d'inactivité…
└── panel/
    ├── routes/           # Pages et actions du panel
    ├── views/            # Gabarits EJS
    └── public/           # CSS et JS du navigateur
scripts/demo-seed.js      # Données de démonstration
test/                     # Tests (node --test)
```
