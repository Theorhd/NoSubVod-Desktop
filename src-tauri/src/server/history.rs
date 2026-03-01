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

    pub async fn update_settings(&self, one_sync: Option<bool>) -> ExperienceSettings {
        {
            let mut data = self.data.write().await;
            if let Some(v) = one_sync {
                data.settings.one_sync = v;
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
}
