use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Server info ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    pub ip: String,
    pub port: u16,
    pub url: String,
    pub qrcode: String,
}

// ── Twitch types ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInfo {
    pub id: String,
    pub login: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "profileImageURL")]
    pub profile_image_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VodGame {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VodOwner {
    pub login: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "profileImageURL")]
    pub profile_image_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vod {
    pub id: String,
    pub title: String,
    #[serde(rename = "lengthSeconds")]
    pub length_seconds: u64,
    #[serde(rename = "previewThumbnailURL")]
    pub preview_thumbnail_url: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "viewCount")]
    pub view_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    pub game: Option<VodGame>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<VodOwner>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveGame {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    #[serde(rename = "boxArtURL", skip_serializing_if = "Option::is_none")]
    pub box_art_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveBroadcaster {
    pub id: String,
    pub login: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "profileImageURL")]
    pub profile_image_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveStream {
    pub id: String,
    pub title: String,
    #[serde(rename = "previewImageURL")]
    pub preview_image_url: String,
    #[serde(rename = "viewerCount")]
    pub viewer_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(rename = "startedAt")]
    pub started_at: String,
    pub broadcaster: LiveBroadcaster,
    pub game: Option<LiveGame>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveStreamsPage {
    pub items: Vec<LiveStream>,
    #[serde(rename = "nextCursor")]
    pub next_cursor: Option<String>,
    #[serde(rename = "hasMore")]
    pub has_more: bool,
}

pub type LiveStatusMap = HashMap<String, LiveStream>;

// ── Persistence ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    #[serde(rename = "vodId")]
    pub vod_id: String,
    pub timecode: f64,
    pub duration: f64,
    #[serde(rename = "updatedAt")]
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryVodEntry {
    #[serde(flatten)]
    pub entry: HistoryEntry,
    pub vod: Option<Vod>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchlistEntry {
    #[serde(rename = "vodId")]
    pub vod_id: String,
    pub title: String,
    #[serde(rename = "previewThumbnailURL")]
    pub preview_thumbnail_url: String,
    #[serde(rename = "lengthSeconds")]
    pub length_seconds: u64,
    #[serde(rename = "addedAt", default)]
    pub added_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubEntry {
    pub login: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "profileImageURL")]
    pub profile_image_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExperienceSettings {
    #[serde(rename = "oneSync")]
    pub one_sync: bool,
}

impl Default for ExperienceSettings {
    fn default() -> Self {
        Self { one_sync: false }
    }
}

/// Root of the persisted JSON file.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PersistedData {
    #[serde(default)]
    pub history: HashMap<String, HistoryEntry>,
    #[serde(default)]
    pub watchlist: Vec<WatchlistEntry>,
    #[serde(default)]
    pub subs: Vec<SubEntry>,
    #[serde(default)]
    pub settings: ExperienceSettings,
}
