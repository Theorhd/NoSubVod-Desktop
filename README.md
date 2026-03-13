# 🚀 NoSubVOD Desktop

NoSubVOD Desktop est une application locale pour regarder des VODs et des lives Twitch depuis n’importe quel appareil du réseau local (mobile, tablette, TV, PC), avec historique, watchlist et portail web intégré.

## 🆕 v0.3.0 — Téléchargements de VOD & Clips, Connexion Twitch & Améliorations UX

La version 0.3.0 vient finaliser une étape critique du projet avec le support des téléchargements (VOD entières ou extraits "clips") en arrière-plan et la possibilité très attendue de se connecter avec son propre compte Twitch pour chatter sur les lives.

### Points clés v0.3.0

- **Système de Téléchargement** : Module de traitement asynchrone pour télécharger n'importe quelle VOD à la qualité souhaitée depuis le player.
- **Support des Clips (Download Mode)** : Sélectionnez manuellement un point de départ et de fin sur une VOD pour créer et enregistrer un extrait exclusif sur votre machine (sans perte ni encodage lourd).
- **Authentification Twitch** : Associez le logiciel à votre compte Twitch pour envoyer vos propres messages dans les chats en Live, directement depuis l'interface Vidstack de l'application !
- **Navigation dans les Chapitres (Markers)** : Intégration d'un panneau déroulant affichant la liste des chapitres de la VOD, cliquable pour un "seek" instantané.
- **Réparations Chat VOD** : Fix du relai du chat, affichant correctement les messages dans l'historique d'une VOD.
- **Qualité du code** : Passage complet des audits de linter Rust (Clippy) et d'audit de vulnérabilité (Cargo Audit).

## 🆕 v0.2.2 — Contrôle Qualité, Raccourcis & Chat Amélioré

La version 0.2.2 transforme l'expérience de visionnage avec un contrôle total sur la qualité vidéo, des raccourcis clavier et une intégration du chat plus robuste.

### Points clés v0.2.2

- **Contrôle Qualité**: Sélection manuelle, qualité préférée et qualité minimale garanties (même sur iOS/iPadOS).
- **Raccourcis Clavier**: Contrôle complet au clavier (F pour plein écran, Espace pour pause, flèches pour volume/seek).
- **Chat Relais**: Intégration du chat Twitch sur Desktop et système de secours intelligent pour les connexions via IP locale (réseau local).
- **Infos Streamer**: Nouvel encart dynamique avec titre, catégorie, viewers, uptime et profil.
- **Adblock Renforcé**: Proxy GQL, spoofing iOS et gestion des discontinuités pour éviter les freezes d'écran.
- **Fiabilité**: Correction des erreurs 500 sur les flux longs et fallback automatique si les proxys échouent.

## 🆕 v0.2.1 — Adblocking live + fiabilité Search/Channel

La version 0.2.0 migre le desktop vers **Tauri**.

- **Poids de l’ancienne installation**: `701 Mo`
- **Poids de la nouvelle installation**: `16,3 Mo`
- **Économie mémoire**: consommation RAM **divisée par 8**

Résultat: démarrage plus rapide, binaire bien plus léger et meilleure stabilité générale.

---

## ✨ Fonctionnalités

### 🔓 VOD + Live Twitch

- Lecture des VOD via HLS généré côté serveur local.
- Lecture des lives via endpoint local `/api/live/:login/master.m3u8`.
- Sélecteur de qualité (Auto + niveaux manuels) dans le player.
- Adblocking live expérimental (configurable dans Settings).

### 🏠 Portail local multi-appareils

- Serveur local accessible sur le LAN.
- QR code affiché côté desktop pour ouverture rapide du portail.
- Navigation: Home, Live, Search, Trends, Channel, Player, History, Settings.

### 🎬 Expérience player

- Player desktop complet (lecture, seek, volume, vitesse, qualité, fullscreen).
- Fallback natif iOS/iPadOS.
- Contrôles auto-masqués après inactivité, réaffichage au mouvement.

### 💾 Données utilisateur

- Historique de lecture avec reprise.
- Watchlist.
- Synchronisation locale optionnelle (OneSync).
- Paramètres serveur persistants (dont adblock proxy/mode).

---

## 🧱 Stack technique

- **Desktop shell**: Tauri v2 (Rust)
- **Backend local**: Rust (`src-tauri/src/server`)
- **Portail LAN**: React + Vite + TypeScript (`src/portal`)
- **UI desktop**: React + Vite + TypeScript (`src/renderer`)

---

## 📁 Architecture du repo

- `src/portal/` : application web servie aux appareils du réseau local
- `src/renderer/` : interface desktop (fenêtre principale)
- `src/shared/` : types partagés TypeScript
- `src-tauri/src/` : cœur Rust (commands Tauri, serveur local, routes Twitch, historique)
- `src-tauri/tauri.conf.json` : configuration packaging/resources

---

## 🛠 Développement

### Prérequis

- Node.js 20+
- Rust stable
- npm

### Installation

```bash
npm ci
```

### Lancer en dev

```bash
npm run dev
```

### Qualité code

```bash
npm run lint
npm run type-check
```

### Build desktop

```bash
npm run build
```

---

## ⚠️ Notes

- Le portail local doit être accessible sur le même réseau local que l’appareil client.
- Certaines disponibilités de contenus dépendent des endpoints Twitch.

---

## 👤 Auteur

Développé avec ❤️ par Theorhd
