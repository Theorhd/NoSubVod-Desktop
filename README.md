# 🚀 NoSubVOD Desktop

NoSubVOD Desktop est une application locale pour regarder des VODs et des lives Twitch depuis n’importe quel appareil du réseau local (mobile, tablette, TV, PC), avec historique, watchlist et portail web intégré.

## 🆕 v0.2.1 — Adblocking live + fiabilité Search/Channel

La version 0.2.1 apporte des ajouts majeurs sur le live (adblocking expérimental) et corrige les retours VOD sur certaines catégories.

### Points clés v0.2.1

- **Adblocking Live (expérimental)**: nouvelle section Adblock dans Settings, mode Auto/Manual, proxy actif et liste des proxies disponibles.
- **Settings serveur enrichis**: persistance de `adblockEnabled`, `adblockProxy`, `adblockProxyMode` en plus de OneSync.
- **Live discovery renforcé**: routes `top-categories`, `search` et `status` consolidées pour ouvrir un live plus rapidement.
- **Correctifs Search/Channel**: transmission de l’ID de catégorie + fallback nom pour récupérer les VODs de façon plus fiable.
- **Qualité backend Rust**: correction Clippy `new_without_default` sur `ProxyManager`.

## 🆕 v0.2.0 — Nouvelle architecture Tauri (Rust)

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
