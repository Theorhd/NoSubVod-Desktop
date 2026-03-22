use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256};

use super::types::{
    ExperienceSettings, HistoryEntry, PersistedData, SubEntry, TrustedDevice, WatchlistEntry,
};

// ── Token encryption helpers ───────────────────────────────────────────────────
// Uses a machine-specific key derived from the data dir path + a salt.
// Uses authenticated encryption (AES-256-GCM) with a per-token random nonce.
// This aims to protect tokens at rest against offline inspection.

fn derive_key(data_dir: &std::path::Path) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(b"NoSubVOD-token-key-v1");
    hasher.update(data_dir.to_string_lossy().as_bytes());
    // Add hostname for extra machine-specificity
    if let Ok(name) = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")) {
        hasher.update(name.as_bytes());
    }
    hasher.finalize().to_vec()
}

fn encrypt_token(token: &str, key: &[u8]) -> String {
    // Key must be 32 bytes for AES-256-GCM; derive_key guarantees this.
    let cipher_key = Key::<Aes256Gcm>::from_slice(key);
    let cipher = Aes256Gcm::new(cipher_key);

    // Generate a random 96-bit (12-byte) nonce for this token.
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, token.as_bytes())
        .expect("encryption failure");

    // Store nonce || ciphertext, base64-encoded.
    let mut out = Vec::with_capacity(nonce_bytes.len() + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);

    B64.encode(&out)
}

fn decrypt_token(encoded: &str, key: &[u8]) -> Option<String> {
    let data = B64.decode(encoded).ok()?;

    // Must at least contain the 12-byte nonce.
    if data.len() < 12 {
        return None;
    }

    let (nonce_bytes, ciphertext) = data.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let cipher_key = Key::<Aes256Gcm>::from_slice(key);
    let cipher = Aes256Gcm::new(cipher_key);

    let plaintext = cipher.decrypt(nonce, ciphertext).ok()?;
    String::from_utf8(plaintext).ok()
}

// ── HistoryStore – wraps all persisted state ───────────────────────────────────

pub struct HistoryStore {
    data: Arc<RwLock<PersistedData>>,
    file_path: PathBuf,
    /// Encryption key derived from the data dir path
    token_key: Vec<u8>,
}

impl HistoryStore {
    /// Load from disk synchronously (file is small – safe to block on startup).
    pub fn load(data_dir: PathBuf) -> Self {
        let file_path = data_dir.join("history.json");
        let token_key = derive_key(&data_dir);
        let mut data = match std::fs::read_to_string(&file_path) {
            Ok(raw) => serde_json::from_str::<PersistedData>(&raw).unwrap_or_default(),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => PersistedData::default(),
            Err(e) => {
                eprintln!("[history] read error: {e}");
                PersistedData::default()
            }
        };

        // Decrypt token from disk format
        if let Some(ref encrypted) = data.twitch_token {
            data.twitch_token = decrypt_token(encrypted, &token_key);
        }

        Self {
            data: Arc::new(RwLock::new(data)),
            file_path,
            token_key,
        }
    }

    async fn save(&self) {
        let data = self.data.read().await;
        // Create a copy with the token encrypted for on-disk storage
        let mut disk_data = data.clone();
        if let Some(ref plaintext) = disk_data.twitch_token {
            disk_data.twitch_token = Some(encrypt_token(plaintext, &self.token_key));
        }
        match serde_json::to_string_pretty(&disk_data) {
            Ok(json) => {
                if let Some(parent) = self.file_path.parent() {
                    let _ = tokio::fs::create_dir_all(parent).await;
                }
                if let Err(e) = tokio::fs::write(&self.file_path, json).await {
                    eprintln!("[history] write error: {e}");
                }
            }
            Err(e) => eprintln!("[history] serialize error: {e}"),
        }
    }

    // ── History ──────────────────────────────────────────────────────────────

    pub async fn get_all_history(&self) -> HashMap<String, HistoryEntry> {
        self.data.read().await.history.clone()
    }

    pub async fn get_history_by_vod_id(&self, vod_id: &str) -> Option<HistoryEntry> {
        self.data.read().await.history.get(vod_id).cloned()
    }

    pub async fn update_history(&self, vod_id: &str, timecode: f64, duration: f64) -> HistoryEntry {
        let timecode = timecode.max(0.0);
        let updated_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let entry = HistoryEntry {
            vod_id: vod_id.to_string(),
            timecode,
            duration,
            updated_at,
        };

        {
            let mut data = self.data.write().await;
            data.history.insert(vod_id.to_string(), entry.clone());
        }

        self.save().await;
        entry
    }

    // ── Watchlist ────────────────────────────────────────────────────────────

    pub async fn get_watchlist(&self) -> Vec<WatchlistEntry> {
        self.data.read().await.watchlist.clone()
    }

    pub async fn add_to_watchlist(&self, mut entry: WatchlistEntry) -> Vec<WatchlistEntry> {
        let mut data = self.data.write().await;
        if !data.watchlist.iter().any(|w| w.vod_id == entry.vod_id) {
            entry.added_at = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            data.watchlist.push(entry);
            drop(data);
            self.save().await;
        }
        self.data.read().await.watchlist.clone()
    }

    pub async fn remove_from_watchlist(&self, vod_id: &str) -> Vec<WatchlistEntry> {
        {
            let mut data = self.data.write().await;
            data.watchlist.retain(|w| w.vod_id != vod_id);
        }
        self.save().await;
        self.data.read().await.watchlist.clone()
    }

    // ── Settings ─────────────────────────────────────────────────────────────

    pub async fn get_settings(&self) -> ExperienceSettings {
        self.data.read().await.settings.clone()
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn update_settings(
        &self,
        one_sync: Option<bool>,
        adblock_enabled: Option<bool>,
        adblock_proxy: Option<Option<String>>,
        adblock_proxy_mode: Option<Option<String>>,
        min_video_quality: Option<Option<String>>,
        preferred_video_quality: Option<Option<String>>,
        download_local_path: Option<Option<String>>,
        download_network_shared_path: Option<Option<String>>,
        launch_at_login: Option<bool>,
    ) -> ExperienceSettings {
        {
            let mut data = self.data.write().await;
            if let Some(v) = one_sync {
                data.settings.one_sync = v;
            }
            if let Some(v) = adblock_enabled {
                data.settings.adblock_enabled = v;
            }
            if let Some(v) = adblock_proxy {
                data.settings.adblock_proxy = v;
            }
            if let Some(v) = adblock_proxy_mode {
                data.settings.adblock_proxy_mode = v;
            }
            if let Some(v) = min_video_quality {
                data.settings.min_video_quality = v;
            }
            if let Some(v) = preferred_video_quality {
                data.settings.preferred_video_quality = v;
            }
            if let Some(v) = download_local_path {
                data.settings.download_local_path = v;
            }
            if let Some(v) = download_network_shared_path {
                data.settings.download_network_shared_path = v;
            }
            if let Some(v) = launch_at_login {
                data.settings.launch_at_login = v;
            }
        }
        self.save().await;
        self.data.read().await.settings.clone()
    }

    // ── Subs ─────────────────────────────────────────────────────────────────

    pub async fn get_subs(&self) -> Vec<SubEntry> {
        self.data.read().await.subs.clone()
    }

    pub async fn add_sub(&self, entry: SubEntry) -> Vec<SubEntry> {
        let login = entry.login.trim().to_lowercase();
        if login.is_empty() {
            return self.data.read().await.subs.clone();
        }

        {
            let mut data = self.data.write().await;
            if !data.subs.iter().any(|s| s.login == login) {
                data.subs.push(SubEntry {
                    login,
                    display_name: entry.display_name,
                    profile_image_url: entry.profile_image_url,
                });
            }
        }
        self.save().await;
        self.data.read().await.subs.clone()
    }

    pub async fn remove_sub(&self, login: &str) -> Vec<SubEntry> {
        let login = login.trim().to_lowercase();
        {
            let mut data = self.data.write().await;
            data.subs.retain(|s| s.login != login);
        }
        self.save().await;
        self.data.read().await.subs.clone()
    }

    // ── Twitch token (kept server-side only, never serialised to API) ─────────

    pub async fn get_twitch_token(&self) -> Option<String> {
        self.data.read().await.twitch_token.clone()
    }

    pub async fn set_twitch_token(&self, token: Option<String>) {
        {
            let mut data = self.data.write().await;
            data.twitch_token = token;
        }
        self.save().await;
    }

    // ── Twitch linked account ─────────────────────────────────────────────────

    pub async fn update_twitch_account(
        &self,
        user_id: String,
        user_login: String,
        user_display_name: String,
        user_avatar: String,
    ) {
        {
            let mut data = self.data.write().await;
            data.settings.twitch_user_id = Some(user_id);
            data.settings.twitch_user_login = Some(user_login);
            data.settings.twitch_user_display_name = Some(user_display_name);
            data.settings.twitch_user_avatar = Some(user_avatar);
        }
        self.save().await;
    }

    pub async fn clear_twitch_account(&self) {
        {
            let mut data = self.data.write().await;
            data.settings.twitch_user_id = None;
            data.settings.twitch_user_login = None;
            data.settings.twitch_user_display_name = None;
            data.settings.twitch_user_avatar = None;
        }
        self.save().await;
    }

    pub async fn update_import_follows_setting(&self, value: bool) {
        {
            let mut data = self.data.write().await;
            data.settings.twitch_import_follows = value;
        }
        self.save().await;
    }

    // ── Trusted devices ─────────────────────────────────────────────────────

    pub async fn mark_device_seen(&self, device_id: &str, ip: Option<String>, ua: Option<String>) {
        if device_id.trim().is_empty() {
            return;
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let mut should_save = false;
        {
            let mut data = self.data.write().await;
            if let Some(existing) = data
                .trusted_devices
                .iter_mut()
                .find(|d| d.device_id == device_id)
            {
                let seen_gap_ms = now.saturating_sub(existing.last_seen_at);
                let ip_changed = existing.last_ip != ip;
                let ua_changed = existing.user_agent != ua;
                if seen_gap_ms >= 60_000 || ip_changed || ua_changed {
                    existing.last_seen_at = now;
                    existing.last_ip = ip;
                    existing.user_agent = ua;
                    should_save = true;
                }
            } else {
                data.trusted_devices.push(TrustedDevice {
                    device_id: device_id.to_string(),
                    first_seen_at: now,
                    last_seen_at: now,
                    last_ip: ip,
                    user_agent: ua,
                    trusted: false,
                });
                should_save = true;
            }
        }

        if should_save {
            self.save().await;
        }
    }

    pub async fn get_trusted_devices(&self) -> Vec<TrustedDevice> {
        let mut devices = self.data.read().await.trusted_devices.clone();
        devices.sort_by(|a, b| b.last_seen_at.cmp(&a.last_seen_at));
        devices
    }

    pub async fn is_device_trusted(&self, device_id: &str) -> bool {
        if device_id.trim().is_empty() {
            return false;
        }

        self.data
            .read()
            .await
            .trusted_devices
            .iter()
            .any(|d| d.device_id == device_id && d.trusted)
    }

    pub async fn set_device_trusted(
        &self,
        device_id: &str,
        trusted: bool,
    ) -> Option<TrustedDevice> {
        if device_id.trim().is_empty() {
            return None;
        }

        let mut updated = None;
        {
            let mut data = self.data.write().await;
            if let Some(device) = data
                .trusted_devices
                .iter_mut()
                .find(|d| d.device_id == device_id)
            {
                device.trusted = trusted;
                updated = Some(device.clone());
            }
        }

        if updated.is_some() {
            self.save().await;
        }

        updated
    }
}
