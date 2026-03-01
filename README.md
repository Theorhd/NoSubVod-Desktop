# 🚀 NoSubVOD Desktop

NoSubVOD Desktop est une application locale qui permet de regarder des VODs Twitch et des lives depuis un portail web accessible sur votre réseau local, avec reprise de lecture, historique, watchlist et synchronisation optionnelle des données.

## ✨ Fonctionnalités

### 🔓 Lecture VOD + Live

- Lecture des **VODs Twitch** via playlist HLS générée côté serveur local.
- Lecture des **lives Twitch** via endpoint local (`/api/live/:login/master.m3u8`) pour éviter les problèmes d’intégration iframe.
- Qualité vidéo sélectionnable (Auto + niveaux) et indicateur de qualité active dans le player.

### 🏠 Portail local multi-appareils

- Serveur embarqué accessible sur le LAN (port `23455`).
- QR Code affiché dans l’app desktop pour ouvrir rapidement le portail sur mobile/tablette.
- Navigation simple: Home, Live, Search, Trends, Channel, Player, History, Settings.

### 🎬 Expérience player

- **Desktop**: player maison complet (play/pause, seek, volume, mute, vitesse, qualité, fullscreen).
- **iOS / iPadOS**: fallback automatique vers le player natif Apple.
- Contrôles desktop auto-masqués après inactivité souris (3s), réaffichés au mouvement.
- En fullscreen: affichage vidéo plein écran sans barre top parasite.

### 📡 Live & abonnements

- Détection live des subs sur Home avec badge **LIVE** sur l’avatar.
- Sur la page Channel: section **Live** en tête (si actif), puis section **VODs**.
- Clic direct vers le stream live depuis Home/Channel/Search/Live.

### 💾 Données utilisateur

- Historique de lecture (reprise automatique proche du dernier timecode).
- Watchlist (ajout/retrait rapide).
- Mode **OneSync** (optionnel) pour partager données et subs entre appareils connectés au même serveur.

---

## 🧱 Stack technique

- **Desktop**: Electron
- **Frontend portail**: React + Vite + TypeScript
- **Backend local**: Express + TypeScript
- **Build backend**: tsup
- **UI**: CSS custom

---

## 📁 Structure (résumé)

- `src/main/` : bootstrap Electron + fenêtre + systray
- `src/server/` : API locale + services Twitch + persistance
- `src/portal/` : portail web utilisateur (LAN)
- `src/renderer/` : UI desktop d’état serveur (IP, URL, QR)
- `releasenotes/` : notes de version

---

## 🛠 Installation & usage

### Prérequis

- Node.js 18+
- npm

### Développement

```bash
npm install
npm run dev
```

### Vérification types

```bash
npm run type-check
```

### Build

```bash
npm run build
```

### Démarrage (build)

```bash
npm start
```

---

## ⚠️ Notes importantes

- Le serveur local écoute sur `0.0.0.0:23455`.
- L’accès depuis mobile/tablette doit se faire sur le **même réseau local**.
- La disponibilité de certains contenus dépend de Twitch et des variations de leurs endpoints.

---

## 📄 Releases

- Pre-release: `releasenotes/pre0.1.0.md`
- Stable initiale: `releasenotes/0.1.0.md`

---

## 👤 Auteur

Développé avec ❤️ par Theorhd
