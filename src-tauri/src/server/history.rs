use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;

use super::types::{ExperienceSettings, HistoryEntry, PersistedData, SubEntry, WatchlistEntry};

// ── HistoryStore – wraps all persisted state ───────────────────────────────────

pub struct HistoryStore {
    data: Arc<RwLock<PersistedData>>,
    file_path: PathBuf,
}

impl HistoryStore {
    /// Load from disk synchronously (file is small – safe to block on startup).
    pub fn load(data_dir: PathBuf) -> Self {
        let file_path = data_dir.join("history.json");
        let data = match std::fs::read_to_string(&file_path) {
            Ok(raw) => serde_json::from_str::<PersistedData>(&raw).unwrap_or_default(),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => PersistedData::default(),
            Err(e) => {
                eprintln!("[history] read error: {e}");
                PersistedData::default()
            }
        };

        Self {
            data: Arc::new(RwLock::new(data)),
            file_path,
        }
    }

    async fn save(&self) {
        let data = self.data.read().await;
        match serde_json::to_string_pretty(&*data) {
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

    pub async fn update_history(
        &self,
        vod_id: &str,
        timecode: f64,
        duration: f64,
    ) -> HistoryEntry {
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
}
