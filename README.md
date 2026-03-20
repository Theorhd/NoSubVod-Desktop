# 🚀 NoSubVOD Desktop

NoSubVOD Desktop est une application locale pour regarder des VODs et des lives Twitch depuis n’importe quel appareil du réseau local (mobile, tablette, TV, PC), avec historique, watchlist et portail web intégré.

## 🆕 v0.3.1 — Refonte UI Portal, durcissement auth locale & correctifs build/reseau

La version 0.3.1 consolide le portail React, améliore la robustesse de l'authentification locale (token + device id), et corrige plusieurs points de friction en environnement LAN/CI.

### Points clés v0.3.1

- **UI unifiée et composantisée** : ajout d'une base de composants partagés (TopBar, VODCard, StreamCard, blocs Home) pour homogénéiser l'UX sur Home, Channel, Live, Search, History, Trends et Settings.
- **Player enrichi** : ajout des panneaux dédiés (infos vidéo, marqueurs, mode clip, chat live) et simplification de la logique du player pour réduire la complexité des vues.
- **Refactor des données** : extraction de hooks dédiés (`useChannelData`, `useDownloadsData`, `useInfiniteScroll`) afin de séparer plus proprement logique API et rendu UI.
- **Sécurisation du stockage local** : introduction d'accès sûrs au storage pour le token et le device id, avec injection plus fiable des en-têtes/query d'auth pour les routes API.
- **Téléchargements plus fiables** : amélioration de la résolution des URL de fichiers partagés avec transmission du token d'accès.
- **Serveur local renforcé** : fallback statique sur `index.html` pour le portail web et correction des chemins d'icônes.
- **Autostart desktop** : ajout des permissions et paramètres pour lancer automatiquement l'application à l'ouverture de session.
- **Sécurité NPM** : mise à jour de `flatted` vers une version corrigée afin de supprimer une vulnérabilité DoS signalée par `npm audit`.

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

Le portail LAN tourne en **HTTPS** sur le port `5173` pour autoriser l'acces camera sur mobile (iOS/Android).
Au premier acces, le navigateur peut afficher un avertissement de certificat local: acceptez-le pour continuer.

URL type a ouvrir sur mobile:

```text
https://<ip-locale-du-pc>:5173
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
- En build desktop (.exe), le portail public mobile est servi en HTTPS sur `23456` et l'API interne reste en HTTP sur `23455`.

---

## 👤 Auteur

Développé avec ❤️ par Theorhd
