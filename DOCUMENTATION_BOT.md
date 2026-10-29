# Documentation Complète du Bot Bobcat

## 📋 Vue d'ensemble

Le bot Bobcat est un bot Discord avancé pour la gestion d'opérations de sécurité, incluant :
- **Système de patrouilles** avec suivi du temps hebdomadaire
- **Missions ATM** (Assistance Technique Mobile) avec gestion des dispatch
- **Prises de Service (PDS)** avec gestion des rôles et des agents
- **Missions de sécurisation** avec gestion des créneaux horaires
- **Convois de fonds** avec gestion des disponibilités
- **Système de forum** pour les publications

---

## 🛡️ Système de Patrouilles

### Commandes principales

#### `/patrouille` (version classique)
Crée une patrouille avec une interface basée sur les embeds Discord.

**Paramètres :**
- `unité` : Nom de l'unité de patrouille
- `agents` : Liste des agents (matricules ou mentions)

**Fonctionnalités :**
- Création d'une patrouille avec date et heure de début
- Ajout de lieux visités avec heure d'arrivée
- Quitter un lieu avec heure de sortie et raison
- Correction des horaires
- Terminaison de la patrouille
- Formatage flexible des heures (21h, 21:30, 2130)

**Boutons disponibles :**
- ➕ Ajouter un lieu
- ✅ Quitter un lieu
- ✏️ Corriger un lieu
- 🛑 Terminer la patrouille

#### `/patrouille-v2` (version moderne)
Même fonctionnalité que `/patrouille` mais avec l'interface Discord Components v2 (ContainerBuilder).

**Avantages :**
- Interface plus moderne et visuelle
- Meilleure organisation des informations
- Utilisation des nouveaux composants Discord

### Gestion des lieux de patrouille

#### `/patrol add`
Ajoute un nouveau lieu de patrouille (super-user uniquement).

**Paramètres :**
- `nom` : Nom du lieu
- `emoji` : Emoji unicode ou custom Discord
- `max_heures` : Limite d'heures par semaine (0 = illimité)

**Exemple :**
```
/patrol add nom: "Superette" emoji: "🏪" max_heures: 5
```

#### `/patrol edit`
Modifie un lieu existant (super-user uniquement).

**Paramètres :**
- `cible` : Nom ou ID du lieu (avec autocomplete)
- `nom` : Nouveau nom (optionnel)
- `emoji` : Nouvel emoji (optionnel)
- `max_heures` : Nouvelle limite hebdomadaire (optionnel)

#### `/patrol delete`
Supprime un lieu (super-user uniquement).

#### `/patrol list`
Liste tous les lieux configurés pour le serveur.

### Suivi du temps de patrouille

#### `/patrol-time`
Affiche un tableau en temps réel du temps de patrouille par lieu pour la semaine courante.

**Fonctionnalités :**
- Affichage des lieux avec leur temps utilisé
- Barre de progression visuelle
- Séparation entre lieux disponibles et limites atteintes
- Pourcentage d'utilisation par lieu
- Mise à jour automatique toutes les 15 minutes
- Mise à jour immédiate lors de la terminaison d'une patrouille

**Affichage :**
- 🟢 Lieux Disponibles : Temps restant > 0
- 🚫 Limite Atteinte : Temps épuisé
- Barre de progression : `[████████░░░░░░░░░░░] 40%`

#### `/patrol-time-reset`
Réinitialise les temps de patrouille (super-user uniquement).

**Sous-commandes :**
- `lieu [lieu]` : Réinitialise le temps d'un lieu spécifique
- `tous` : Réinitialise tous les temps de patrouille

**Note :** Le reset se fait par semaine ISO. Les patrouilles qui chevauchent deux semaines comptent leur temps dans la semaine de début.

### Watcher d'inactivité des patrouilles

**Fonctionnement :**
- Vérifie toutes les 5 minutes les patrouilles inactives depuis 45 minutes
- Envoie un DM au créateur de la patrouille
- Si le DM échoue, envoie un message dans le canal avec mention
- Supprime automatiquement le message d'avertissement quand la patrouille est terminée

---

## 📦 Système ATM (Assistance Technique Mobile)

### `/atm` - Créer une mission ATM

**Paramètres :**
- `date` : Date de la mission (ex: 16/05)
- `heure` : Heure de la mission (ex: 21h, 21:30, 2130)
- `frequence` : Fréquence radio (S6, S7, S8)
- `mention` : Rôle à mentionner (optionnel)

**Fonctionnalités :**
- Création d'un embed de mission
- Gestion des rôles avec emojis spécifiques
- Système de réactions pour les disponibilités
- Boutons de gestion du dispatch

**Rôles disponibles :**
- 🧠 Chef d'opération
- 📄 CO ATM
- 🔫 Fusil à pompe
- 🚙 Conducteur
- 🆕 Besoin d'explication
- 🏍️ U2R

### Interactions ATM

**Boutons :**
- `atm_role_*` : Assigner un rôle à un agent
- `atm_cancel` : Annuler la mission
- `atm_finish` : Terminer la mission
- `confirm_cancel_*` : Confirmer l'annulation
- `confirm_finish_*` : Confirmer la terminaison

**Menus déroulants :**
- `atm_select_agent` : Sélectionner un agent
- `atm_select_roles_*` : Assigner des rôles

---

## 📋 Système PDS (Prise de Service)

### `/pds` - Démarrer une PDS ATM

**Paramètres :**
- `immatriculation` : Immatriculation du véhicule (ex: ZJR 325)

**Fonctionnalités :**
- Vérifie qu'une session ATM est en cours
- Récupère les participants du dispatch ATM
- Affiche la liste des agents avec leurs rôles
- Permet d'ajouter des ATM via modal
- Gestion de la fin de PDS

**Étapes :**
1. Vérification des permissions (rôles autorisés ou super-user)
2. Récupération de la session ATM active
3. Affichage des participants avec rôles
4. Possibilité d'ajouter des ATM avec photos
5. Terminaison de la PDS

---

## 🔒 Système de Sécurisation

### `/secu` - Créer une mission de sécurisation

**Paramètres :**
- `lieu` : Nom du lieu sécurisé
- `date_et_jours` : Format "17/08:3" ou "14/08,17/08"
- `capacite` : Nombre d'agents par créneau
- `tenue` : Tenue des agents (TENUE_SECURISATION, TENUE_SECURISATION_MC)
- `vehicule` : Véhicule utilisé (free, offroad, custom)
- `radio` : Radio à utiliser (CENTRALE, SIERRA_1-8, SECU_SHARED)
- `template` : Plage horaire par défaut (ex: 19h-00h)
- `planning` : Overrides multi-lignes
- `vehicule_custom` : Véhicule si custom
- `salon_info` : Salon d'informations
- `salon_pds` : Salon PDS
- `brief_offset` : Brief TEAM 1 (0, 15, 30 minutes avant)

**Fonctionnalités :**
- Création de créneaux horaires multiples
- Gestion des inscriptions par créneau
- Système de boutons pour s'inscrire/se désinscrire
- Gestion des rôles et des permissions

---

## 🚛 Système de Convoi

### `/convoi` - Créer un ordre de mission pour convoi de fonds

**Paramètres :**
- `date` : Date (ex: 17/05)
- `heure` : Heure (ex: 21h, 21:30, 2130)

**Fonctionnalités :**
- Création d'un embed de mission
- Système de réactions (✅ disponible, ❌ indisponible)
- Bouton de gestion du dispatch
- Bouton de reprogrammation
- Stockage en base de données

**Boutons :**
- 🧩 Gérer le dispatch
- 🗓️ Reprogrammer

---

## 🗄️ Base de Données MongoDB

### Modèles de données

#### PatrolSession
- `guildId` : ID du serveur
- `channelId` : ID du canal
- `messageId` : ID du message Discord
- `authorId` : ID du créateur
- `unit` : Nom de l'unité
- `agents` : Liste des agents
- `agentIds` : IDs des agents
- `dateLabel` : Date formatée
- `startAt` : Date de début
- `endAt` : Date de fin
- `status` : OPEN ou FINISHED
- `places` : Liste des lieux visités

#### PatrolPlace
- `guildId` : ID du serveur
- `name` : Nom du lieu
- `emoji` : Emoji du lieu
- `maxHoursPerWeek` : Limite hebdomadaire
- `active` : Statut actif/inactif

#### PatrolTimeTracking
- `guildId` : ID du serveur
- `placeId` : ID du lieu
- `placeName` : Nom du lieu
- `weekNumber` : Numéro de semaine ISO
- `year` : Année
- `totalMinutes` : Temps total en minutes

#### ATM Mission
- `guildId` : ID du serveur
- `channelId` : ID du canal
- `messageId` : ID du message
- `createdBy` : ID du créateur
- `dateStr` : Date formatée
- `timeStr` : Heure formatée
- `frequency` : Fréquence radio
- `status` : OPEN, FINISHED, CANCELLED
- `participants` : Liste des participants

---

## 🔧 Utilitaires

### `/clear`
Supprime les messages d'un canal.

### `/say`
Fait parler le bot avec un message spécifié.

### `/separateur`
Ajoute un séparateur visuel dans le canal.

---

## 🎯 Système de Permissions

### Super-User
Les super-users ont accès à toutes les commandes administratives :
- `/patrol add/edit/delete`
- `/patrol-time-reset`
- `/convoi`
- `/secu`

### Rôles autorisés
Certains rôles spécifiques peuvent utiliser :
- `/atm` : Créer des missions ATM
- `/pds` : Créer des PDS
- `/patrouille` : Créer des patrouilles

---

## 🔄 Système de Récupération

### Rehydration des sessions
Au démarrage du bot :
- Récupération des patrouilles en cours depuis MongoDB
- Récupération des sessions PDS en cours
- Restauration de l'état des messages Discord

### Watcher d'inactivité
- Vérification toutes les 5 minutes
- Alertes après 45 minutes d'inactivité
- Nettoyage automatique des messages d'avertissement

---

## 📡 Intégrations

### Cloudinary
- Upload des images ATM
- Stockage des photos de PDS
- Configuration via variables d'environnement

### MongoDB Atlas
- Persistance des sessions
- Stockage des lieux de patrouille
- Tracking du temps hebdomadaire
- Stockage des missions ATM et convois

---

## 🚀 Démarrage du Bot

### Variables d'environnement requises
- `DISCORD_TOKEN` : Token du bot Discord
- `CLOUDINARY_CLOUD_NAME` : Nom du cloud Cloudinary
- `CLOUDINARY_API_KEY` : Clé API Cloudinary
- `CLOUDINARY_API_SECRET` : Secret API Cloudinary
- `MONGODB_URI` : URI de connexion MongoDB

### Processus de démarrage
1. Chargement des commandes depuis le dossier `commands/`
2. Chargement des events depuis le dossier `events/`
3. Connexion à MongoDB
4. Connexion à Discord
5. Démarrage du watcher d'inactivité des patrouilles
6. Initialisation du système de refresh `/patrol-time`
7. Nettoyage du dossier temporaire (toutes les 12 heures)

---

## 📁 Structure du Projet

```
Bobcat test/
├── commands/           # Commandes slash
│   ├── patrouille.js   # Commande patrouille classique
│   ├── patrouille-v2.js # Commande patrouille v2
│   ├── patrol.js       # Gestion des lieux
│   ├── patrol-time.js  # Suivi du temps
│   ├── patrol-time-reset.js # Reset du temps
│   ├── atm.js          # Missions ATM
│   ├── pds.js          # Prises de service
│   ├── secu.js         # Sécurisation
│   └── convoi.js       # Convois
├── handlers/           # Gestionnaires d'interactions
│   ├── patrouille-interactions.js
│   ├── atm-interactions.js
│   ├── pds-interactions.js
│   ├── secu-interactions.js
│   └── convoi-interactions.js
├── db/                 # Base de données
│   ├── models/         # Modèles Mongoose
│   └── services/       # Services DB
├── utils/              # Utilitaires
│   ├── auth.js         # Permissions
│   ├── logger.js       # Logging
│   ├── constants.js    # Constantes
│   ├── times.js        # Gestion du temps
│   └── patrolInactivityWatcher.js
├── events/             # Events Discord
│   ├── ready.js
│   ├── interactionCreate.js
│   └── ...
└── index.js            # Point d'entrée
```

---

## 🎨 Interface Utilisateur

### Composants Discord
- **Embeds** : Pour les patrouilles classiques et missions
- **Containers v2** : Pour les patrouilles modernes et tableau de temps
- **Modals** : Pour la saisie d'informations (heures, raisons)
- **ActionRows** : Pour les boutons et menus déroulants
- **StringSelectMenus** : Pour la sélection de lieux et agents

### Emojis personnalisés
- Logo Bobcat
- Fusil à pompe
- CO ATM
- U2R
- Et autres emojis personnalisés du serveur

---

## ⚙️ Configuration

### Fuseau horaire
- Le bot utilise le fuseau horaire local du système
- Pas de timezone explicite (Europe/Paris retiré)
- Les dates sont stockées en UTC et affichées en heure locale

### Intervals
- **Patrol inactivity watcher** : 5 minutes
- **Patrol idle timeout** : 45 minutes
- **Patrol-time refresh** : 15 minutes
- **Temp folder cleanup** : 12 heures

---

## 🔒 Sécurité

### Permissions
- Vérification des rôles avant chaque action
- Super-override pour les super-users
- Messages éphémères pour les erreurs

### Validation
- Validation des formats de date et d'heure
- Vérification des permissions avant création
- Gestion des erreurs avec try/catch

---

## 📊 Statistiques et Monitoring

### Logging
- Système de logging personnalisé (`utils/logger.js`)
- Logs colorés et structurés
- Tracking des erreurs et warnings

### Performance
- Timeout des requêtes MongoDB (10 secondes)
- Gestion des erreurs de connexion
- Retry automatique pour certaines opérations

---

## 🐛 Gestion des Erreurs

### Messages d'erreur
- Messages éphémères pour les erreurs utilisateur
- Logs détaillés pour les erreurs système
- Fallbacks pour les opérations critiques

### Recovery
- Récupération automatique des sessions au démarrage
- Nettoyage des données corrompues
- Gestion des messages supprimés

---

## 🔄 Workflow Type

### Patrouille complète
1. `/patrouille` → Création de la patrouille
2. Bouton "Ajouter un lieu" → Sélection du lieu
3. Modal "Heure d'arrivée" → Saisie de l'heure
4. Bouton "Quitter un lieu" → Modal "Heure de sortie"
5. Bouton "Terminer la patrouille" → Clôture
6. Mise à jour automatique du tableau `/patrol-time`

### Mission ATM complète
1. `/atm` → Création de la mission
2. Réactions ✅/❌ pour disponibilités
3. Bouton "Gérer le dispatch" → Assignation des rôles
4. `/pds` → Création de la PDS
5. Ajout des ATM avec photos
6. Terminaison de la PDS
7. Clôture de la mission ATM

---

## 📝 Notes importantes

### Compatibilité
- Support des clés FR et EN dans les embeds
- Formatage flexible des heures
- Gestion des emojis custom Discord

### Limitations
- Une patrouille par canal à la fois
- Une session ATM par utilisateur
- Les temps sont comptés par semaine ISO
- Pas de gestion multi-serveur pour les mêmes données

### Améliorations possibles

**Système de patrouilles :**
- Export des données de patrouille en CSV/PDF
- Historique des patrouilles par agent avec statistiques
- Gestion des absences et congés des agents
- Rapports mensuels/annuels par lieu
- Système de notifications avancé (rappels avant limite)

**Système ATM :**
- Historique des missions ATM avec statistiques de participation
- Gestion des annulations avec meilleure notification aux participants
- Système de rappel automatique avant la mission
- Export des rapports de mission

**Système PDS :**
- **Simplification du workflow** :
  - Réduction du nombre d'étapes pour créer une PDS
  - Automatisation de la récupération des participants depuis le dispatch ATM
  - Pré-remplissage automatique des champs communs
  - Interface plus intuitive avec moins de modals
- Gestion des photos multiples par ATM avec drag & drop
- Export des rapports PDS formatés
- Historique des PDS par agent
- Validation automatique des données saisies
- Système de template pour les PDS récurrentes

**Interface et UX :**
- **Dashboard web complet** pour la gestion centralisée :
  - Gestion des dispatchs de sécurisation (créneaux, inscriptions, modifications)
  - Gestion des dispatchs de convoi (disponibilités, assignations)
  - Gestion des lieux de patrouille (CRUD complet)
  - Visualisation du tableau de temps de patrouille en temps réel
  - Historique des patrouilles avec filtres et recherche
  - Gestion des missions ATM et PDS
  - Statistiques et rapports visuels
  - Gestion des utilisateurs et permissions
- Messages d'aide contextuels plus clairs
- Validation en temps réel des saisies utilisateur
- Prévisualisation avant action (confirmation)
- Système d'annulation (undo) pour les actions critiques

**Performance et scalabilité :**
- Cache des requêtes MongoDB pour réduire la charge
- Pagination pour les grandes listes (lieux, historiques)
- Optimisation des requêtes avec index appropriés
- Gestion de la concurrence pour les opérations simultanées

**Sécurité et audit :**
- Rate limiting pour prévenir les abus
- Audit log complet des actions administratives
- 2FA pour les actions sensibles (reset, suppression)
- Validation renforcée des permissions

**Qualité du code :**
- Tests unitaires pour les fonctions critiques
- Tests d'intégration pour les workflows complets
- Documentation API pour les développeurs externes
- CI/CD pour le déploiement automatique

**Infrastructure :**
- Système de backup automatique de MongoDB
- Monitoring des performances et alertes
- Gestion des erreurs plus robuste avec retry automatique
- Logging structuré avec envoi vers un service centralisé

**Système de notifications avancé :**
- Notifications push personnalisées par utilisateur
- Notifications par email pour les rappels de mission
- Préférences de notification configurables (Discord, email, push)
- Notifications groupées pour éviter le spam
- Système de "snooze" pour reporter les rappels

**Intégrations externes :**
- Synchronisation avec Google Calendar pour les missions
- Intégration Slack/Teams pour les notifications d'équipe
- Webhooks pour les événements critiques (création, annulation)
- Export vers des outils de gestion de projet (Notion, Airtable)
- Intégration avec des systèmes de paie pour le suivi des heures

**Gamification et engagement :**
- Système de points pour les participations
- Badges et achievements (ex: "100 patrouilles", "Expert ATM")
- Classement des agents les plus actifs
- Système de reconnaissance entre agents
- Objectifs et challenges mensuels

**Analytiques avancées :**
- Heatmap des disponibilités par jour/heure
- Analyse des tendances de participation
- Prédiction des besoins en personnel via IA
- Rapports de performance par équipe
- Dashboard KPI pour les managers

**Gestion des ressources :**
- Gestion des véhicules (disponibilité, maintenance)
- Inventaire du matériel (armes, équipements)
- Planning des maintenances et inspections
- Gestion des clés et accès
- Suivi des consommables (carburant, munitions)

**Communication collaborative :**
- Chat intégré pour les missions en cours
- Système de commentaires sur les patrouilles
- Feedback post-mission avec évaluation
- Partage de photos et documents
- Système de mentions et notifications

**Formation et compétences :**
- Module de formation intégré avec quiz
- Certifications et suivi des compétences
- Bibliothèque de procédures et guides
- Système de mentorat
- Évaluation des performances

**Conformité et légalité :**
- Gestion des documents légaux et contrats
- Signatures électroniques pour les rapports
- Rapports de conformité automatiques
- Audit trail complet pour les inspections
- Gestion des certifications et agréments

**Accessibilité et internationalisation :**
- Support multilingue (FR, EN, et autres)
- Interface accessible (WCAG 2.1)
- Support des lecteurs d'écran
- Mode sombre/clair automatique
- Adaptation mobile responsive

**Personnalisation et branding :**
- Thèmes personnalisables par serveur
- Logo et couleurs configurables
- Templates de messages personnalisables
- Rôles et permissions granulaires
- Configuration par défaut personnalisable

**Automatisation et workflows :**
- Workflows automatisés pour les tâches récurrentes
- Règles de business configurables
- Déclencheurs automatiques (ex: alerte si lieu proche de limite)
- Intégration avec IFTTT/Zapier
- Scripts personnalisables pour les admins

**Support et assistance :**
- Système de tickets d'assistance intégré
- FAQ interactive et recherche
- Tutoriels vidéo intégrés
- Chatbot d'aide IA pour répondre aux questions
- Base de connaissances collaborative

**Qualité de service :**
- SLA monitoring et alertes
- Rapports de disponibilité
- Gestion des incidents et pannes
- Plan de reprise d'activité (DRP)
- Tests de charge réguliers

### Améliorations nécessaires (priorité haute)
- **Système de sécurisation** : Refonte complète pour une meilleure gestion des créneaux et des inscriptions
- **Système de convoi** : Amélioration de la gestion des dispatch et des disponibilités
