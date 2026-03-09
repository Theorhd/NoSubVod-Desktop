use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get},
    Json, Router,
};
#[cfg(debug_assertions)]
use axum::{http::HeaderMap, response::Redirect};
use serde::Deserialize;
use serde_json::Value;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower::ServiceExt;

use super::{
    download::DownloadManager,
    history::HistoryStore,
    twitch::TwitchService,
    types::{SubEntry, WatchlistEntry},
};

// ── Application state shared across all routes ─────────────────────────────────

#[derive(Clone)]
pub struct ApiState {
    pub twitch: Arc<TwitchService>,
    pub history: Arc<HistoryStore>,
    pub download: Arc<DownloadManager>,
}

// ── Error helpers ─────────────────────────────────────────────────────────────

fn internal(msg: impl std::fmt::Display) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({ "error": msg.to_string() })),
    )
        .into_response()
}

fn bad_request(msg: impl std::fmt::Display) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({ "error": msg.to_string() })),
    )
        .into_response()
}

fn not_found(msg: impl std::fmt::Display) -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({ "error": msg.to_string() })),
    )
        .into_response()
}

fn m3u8_response(body: String) -> Response {
    Response::builder()
        .header(header::CONTENT_TYPE, "application/vnd.apple.mpegurl")
        .body(Body::from(body))
        .unwrap()
        .into_response()
}

// ── Query param structs ───────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ChatQuery {
    offset: Option<f64>,
}

#[derive(Deserialize)]
struct SearchQuery {
    q: Option<String>,
}

#[derive(Deserialize)]
struct VariantProxyQuery {
    id: Option<String>,
}

#[derive(Deserialize)]
struct LiveQuery {
    limit: Option<String>,
    cursor: Option<String>,
    after: Option<String>,
}

#[derive(Deserialize)]
struct LiveStatusQuery {
    logins: Option<String>,
}

#[derive(Deserialize)]
struct HistoryListQuery {
    limit: Option<String>,
}

#[derive(Deserialize)]
struct SearchCategoryQuery {
    id: Option<String>,
    name: Option<String>,
    cursor: Option<String>,
    limit: Option<String>,
}

#[derive(Deserialize)]
struct LiveCategoryQuery {
    name: Option<String>,
    cursor: Option<String>,
    limit: Option<String>,
}

#[derive(Deserialize)]
struct LiveSearchQuery {
    q: Option<String>,
    limit: Option<String>,
}

// ── Route handlers ────────────────────────────────────────────────────────────

async fn handle_vod_chat(
    Path(vod_id): Path<String>,
    Query(q): Query<ChatQuery>,
    State(state): State<ApiState>,
) -> Response {
    let offset = q.offset.unwrap_or(0.0);
    match state.twitch.fetch_video_chat(&vod_id, offset).await {
        Ok(data) => Json(data).into_response(),
        Err(e) => internal(e),
    }
}

async fn handle_vod_markers(
    Path(vod_id): Path<String>,
    State(state): State<ApiState>,
) -> Response {
    match state.twitch.fetch_video_markers(&vod_id).await {
        Ok(data) => Json(data).into_response(),
        Err(e) => internal(e),
    }
}

async fn handle_vod_info(
    Path(vod_id): Path<String>,
    State(state): State<ApiState>,
) -> Response {
    let vods = state.twitch.fetch_vods_by_ids(vec![vod_id]).await;
    if let Some(vod) = vods.into_iter().next() {
        Json(vod).into_response()
    } else {
        not_found("VOD not found")
    }
}

async fn handle_vod_master(
    Path(vod_id): Path<String>,
    State(state): State<ApiState>,
    headers: axum::http::HeaderMap,
) -> Response {
    let host = headers
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("localhost")
        .to_string();

    match state.twitch.generate_master_playlist(&vod_id, &host).await {
        Ok(playlist) => m3u8_response(playlist),
        Err(e) => internal(e),
    }
}

async fn handle_live_master(
    Path(login): Path<String>,
    State(state): State<ApiState>,
    headers: axum::http::HeaderMap,
) -> Response {
    let login = login.trim().to_lowercase();
    if login.is_empty() {
        return bad_request("Missing channel login");
    }
    let host = headers
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("localhost")
        .to_string();

    let settings = state.history.get_settings().await;
    match state
        .twitch
        .generate_live_master_playlist(&login, &host, &settings)
        .await
    {
        Ok(m3u8) => m3u8_response(m3u8),
        Err(e) => internal(e),
    }
}

async fn handle_proxy_variant(
    Query(q): Query<VariantProxyQuery>,
    State(state): State<ApiState>,
) -> Response {
    let Some(id) = q.id else {
        return bad_request("Missing id parameter");
    };

    let settings = state.history.get_settings().await;
    match state.twitch.proxy_variant_playlist(&id, &settings).await {
        Ok(body) => m3u8_response(body),
        Err(e) => internal(e),
    }
}

async fn handle_proxy_segment(
    Query(q): Query<VariantProxyQuery>,
    State(state): State<ApiState>,
) -> Response {
    let Some(id) = q.id else {
        return bad_request("Missing id parameter");
    };

    let settings = state.history.get_settings().await;
    match state.twitch.proxy_segment(&id, &settings).await {
        Ok(resp) => {
            let mut builder = Response::builder();
            if let Some(ct) = resp.headers().get(reqwest::header::CONTENT_TYPE) {
                builder = builder.header(reqwest::header::CONTENT_TYPE, ct);
            }
            if let Some(cc) = resp.headers().get(reqwest::header::CACHE_CONTROL) {
                builder = builder.header(reqwest::header::CACHE_CONTROL, cc);
            }

            let body = Body::from_stream(resp.bytes_stream());
            builder.body(body).unwrap_or_else(|_| internal("Failed to build response"))
        }
        Err(e) => internal(e),
    }
}

async fn handle_chat_iframe(Path(login): Path<String>) -> Response {
    let html = format!(
        "<!DOCTYPE html>
<html lang=\"en\">
<head>
    <meta charset=\"UTF-8\">
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">
    <title>Twitch Chat Proxy</title>
    <style>
        body, html {{
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            background-color: #18181b;
            overflow: hidden;
            display: flex;
            justify-content: center;
            align-items: center;
            color: #efeff1;
            font-family: Inter, Roobert, \"Helvetica Neue\", Helvetica, Arial, sans-serif;
            text-align: center;
        }}
        .container {{
            padding: 20px;
        }}
        a {{
            display: inline-block;
            margin-top: 15px;
            padding: 10px 15px;
            background-color: #9146ff;
            color: white;
            text-decoration: none;
            border-radius: 6px;
            font-weight: bold;
        }}
        a:hover {{
            background-color: #772ce8;
        }}
    </style>
</head>
<body>
    <div class=\"container\">
        <svg width=\"48\" height=\"48\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" style=\"margin-bottom: 10px;\">
            <path d=\"M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM13 17H11V15H13V17ZM13 13H11V7H13V13Z\" fill=\"#adadb8\"/>
        </svg>
        <div style=\"font-weight: bold; font-size: 1.1rem; margin-bottom: 5px;\">Chat protégé par Twitch</div>
        <div style=\"color: #adadb8; font-size: 0.9rem;\">
            Sur navigateur mobile/local, le chat de <b>{login}</b> doit s'ouvrir séparément.
        </div>
        <a href=\"https://www.twitch.tv/popout/{login}/chat?popout=\" target=\"_blank\" rel=\"noreferrer\">
            Ouvrir le chat
        </a>
    </div>
</body>
</html>"
    );

    Response::builder()
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(Body::from(html))
        .unwrap()
        .into_response()
}

async fn handle_get_watchlist(State(state): State<ApiState>) -> impl IntoResponse {
    Json(state.history.get_watchlist().await)
}

async fn handle_add_watchlist(
    State(state): State<ApiState>,
    Json(entry): Json<WatchlistEntry>,
) -> Response {
    Json(state.history.add_to_watchlist(entry).await).into_response()
}

async fn handle_remove_watchlist(
    Path(vod_id): Path<String>,
    State(state): State<ApiState>,
) -> impl IntoResponse {
    Json(state.history.remove_from_watchlist(&vod_id).await)
}

async fn handle_get_settings(State(state): State<ApiState>) -> impl IntoResponse {
    Json(state.history.get_settings().await)
}

async fn handle_get_adblock_proxies(State(state): State<ApiState>) -> impl IntoResponse {
    state.twitch.refresh_adblock_proxy_state();
    Json(state.twitch.get_all_proxies())
}

async fn handle_get_adblock_status(State(state): State<ApiState>) -> impl IntoResponse {
    state.twitch.refresh_adblock_proxy_state();
    Json(state.twitch.get_current_proxy())
}

#[derive(Deserialize)]
struct SettingsPatch {
    #[serde(rename = "oneSync")]
    one_sync: Option<bool>,
    #[serde(rename = "adblockEnabled")]
    adblock_enabled: Option<bool>,
    #[serde(rename = "adblockProxy")]
    adblock_proxy: Option<Option<String>>,
    #[serde(rename = "adblockProxyMode")]
    adblock_proxy_mode: Option<Option<String>>,
    #[serde(rename = "minVideoQuality")]
    min_video_quality: Option<Option<String>>,
    #[serde(rename = "preferredVideoQuality")]
    preferred_video_quality: Option<Option<String>>,
    #[serde(rename = "downloadLocalPath")]
    download_local_path: Option<Option<String>>,
    #[serde(rename = "downloadNetworkSharedPath")]
    download_network_shared_path: Option<Option<String>>,
}

async fn handle_update_settings(
    State(state): State<ApiState>,
    Json(patch): Json<SettingsPatch>,
) -> Response {
    Json(
        state
            .history
            .update_settings(
                patch.one_sync,
                patch.adblock_enabled,
                patch.adblock_proxy,
                patch.adblock_proxy_mode,
                patch.min_video_quality,
                patch.preferred_video_quality,
                patch.download_local_path,
                patch.download_network_shared_path,
            )
            .await,
    )
    .into_response()
}

async fn handle_get_subs(State(state): State<ApiState>) -> impl IntoResponse {
    Json(state.history.get_subs().await)
}

async fn handle_add_sub(
    State(state): State<ApiState>,
    Json(entry): Json<SubEntry>,
) -> Response {
    if entry.login.is_empty() || entry.display_name.is_empty() || entry.profile_image_url.is_empty() {
        return bad_request("Invalid sub payload");
    }
    Json(state.history.add_sub(entry).await).into_response()
}

async fn handle_remove_sub(
    Path(login): Path<String>,
    State(state): State<ApiState>,
) -> impl IntoResponse {
    Json(state.history.remove_sub(&login).await)
}

async fn handle_search_channels(
    Query(q): Query<SearchQuery>,
    State(state): State<ApiState>,
) -> Response {
    let Some(query) = q.q.filter(|s| !s.is_empty()) else {
        return Json(Value::Array(vec![])).into_response();
    };
    match state.twitch.search_channels(&query).await {
        Ok(results) => Json(results).into_response(),
        Err(e) => internal(e),
    }
}

async fn handle_search_global(
    Query(q): Query<SearchQuery>,
    State(state): State<ApiState>,
) -> Response {
    let Some(query) = q.q.filter(|s| !s.is_empty()) else {
        return Json(Value::Array(vec![])).into_response();
    };
    match state.twitch.search_global_content(&query).await {
        Ok(results) => Json(results).into_response(),
        Err(e) => internal(e),
    }
}

async fn handle_search_category_vods(
    Query(q): Query<SearchCategoryQuery>,
    State(state): State<ApiState>,
) -> Response {
    let id = q.id.unwrap_or_default();
    let id = id.trim().to_string();
    let name = q.name.unwrap_or_default();
    let name = name.trim().to_string();
    if id.is_empty() && name.is_empty() {
        return Json(serde_json::json!({ "items": [], "hasMore": false, "nextCursor": null })).into_response();
    }
    let limit = q
        .limit
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(36)
        .clamp(4, 50);
    let cursor = q.cursor.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let (items, next_cursor, has_more) = state
        .twitch
        .fetch_category_vods_page(&name, if id.is_empty() { None } else { Some(id.as_str()) }, limit, cursor.as_deref())
        .await;
    Json(serde_json::json!({
        "items": items,
        "hasMore": has_more,
        "nextCursor": next_cursor,
    }))
    .into_response()
}

async fn handle_trends(State(state): State<ApiState>) -> Response {
    let history = state.history.get_all_history().await;
    let subs = state.history.get_subs().await;
    match state.twitch.fetch_trending_vods(&history, &subs).await {
        Ok(results) => Json(results).into_response(),
        Err(e) => internal(e),
    }
}

async fn handle_live(
    Query(q): Query<LiveQuery>,
    State(state): State<ApiState>,
) -> Response {
    let limit = q
        .limit
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(24)
        .clamp(8, 48);
    // Support both 'cursor' and 'after' params, preferring 'cursor'
    let cursor = q.cursor.or(q.after).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    match state
        .twitch
        .fetch_live_streams(limit, cursor.as_deref())
        .await
    {
        Ok(page) => Json(page).into_response(),
        Err(e) => internal(e),
    }
}

async fn handle_live_top_categories(State(state): State<ApiState>) -> Response {
    match state.twitch.fetch_top_live_categories().await {
        Ok(cats) => Json(cats).into_response(),
        Err(e) => internal(e),
    }
}

async fn handle_live_category(
    Query(q): Query<LiveCategoryQuery>,
    State(state): State<ApiState>,
) -> Response {
    let name = q.name.unwrap_or_default().trim().to_string();
    if name.is_empty() {
        return bad_request("Missing category name");
    }
    let limit = q
        .limit
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(24)
        .clamp(8, 48);
    // Support both 'cursor' and 'after' (if we decide to add it to LiveCategoryQuery too)
    let cursor = q.cursor.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    match state
        .twitch
        .fetch_live_streams_by_category(&name, limit, cursor.as_deref())
        .await
    {
        Ok(page) => Json(page).into_response(),
        Err(e) => internal(e),
    }
}

async fn handle_live_search(
    Query(q): Query<LiveSearchQuery>,
    State(state): State<ApiState>,
) -> Response {
    let query = q.q.unwrap_or_default().trim().to_string();
    if query.is_empty() {
        return bad_request("Missing query");
    }
    let limit = q
        .limit
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(24)
        .clamp(8, 48);
    match state.twitch.search_live_streams_by_query(&query, limit).await {
        Ok(page) => Json(page).into_response(),
        Err(e) => internal(e),
    }
}

async fn handle_live_status(
    Query(q): Query<LiveStatusQuery>,
    State(state): State<ApiState>,
) -> Response {
    let raw = q.logins.unwrap_or_default();
    let raw = raw.trim().to_string();
    if raw.is_empty() {
        return Json(serde_json::json!({})).into_response();
    }

    let logins: Vec<String> = raw
        .split(',')
        .map(|l| l.trim().to_lowercase())
        .filter(|l| !l.is_empty())
        .collect();

    let result = state.twitch.fetch_live_status_by_logins(logins).await;
    Json(result).into_response()
}

async fn handle_get_history(State(state): State<ApiState>) -> impl IntoResponse {
    Json(state.history.get_all_history().await)
}

async fn handle_get_history_list(
    Query(q): Query<HistoryListQuery>,
    State(state): State<ApiState>,
) -> Response {
    let limit = q
        .limit
        .and_then(|s| s.parse::<usize>().ok())
        .map(|l| l.clamp(1, 100));

    let all_history = state.history.get_all_history().await;
    let mut entries: Vec<_> = all_history.into_values().collect();
    entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    if let Some(l) = limit {
        entries.truncate(l);
    }

    let vod_ids: Vec<String> = entries.iter().map(|e| e.vod_id.clone()).collect();
    let metadata = state.twitch.fetch_vods_by_ids(vod_ids).await;
    let by_id: std::collections::HashMap<&str, _> =
        metadata.iter().map(|v| (v.id.as_str(), v)).collect();

    let enriched: Vec<_> = entries
        .iter()
        .map(|entry| {
            serde_json::json!({
                "vodId": entry.vod_id,
                "timecode": entry.timecode,
                "duration": entry.duration,
                "updatedAt": entry.updated_at,
                "vod": by_id.get(entry.vod_id.as_str()).map(|v| serde_json::to_value(v).unwrap_or_default())
            })
        })
        .collect();

    Json(enriched).into_response()
}

async fn handle_get_history_vod(
    Path(vod_id): Path<String>,
    State(state): State<ApiState>,
) -> Response {
    match state.history.get_history_by_vod_id(&vod_id).await {
        Some(entry) => Json(entry).into_response(),
        None => Json(serde_json::Value::Null).into_response(),
    }
}

#[derive(Deserialize)]
struct HistoryBody {
    #[serde(rename = "vodId")]
    vod_id: Option<String>,
    timecode: Option<f64>,
    duration: Option<f64>,
}

async fn handle_post_history(
    State(state): State<ApiState>,
    Json(body): Json<HistoryBody>,
) -> Response {
    let Some(vod_id) = body.vod_id else {
        return bad_request("Invalid parameters");
    };
    let Some(timecode) = body.timecode else {
        return bad_request("Invalid parameters");
    };
    let duration = body.duration.unwrap_or(0.0);

    let entry = state
        .history
        .update_history(&vod_id, timecode, duration)
        .await;
    Json(entry).into_response()
}

async fn handle_get_user(
    Path(username): Path<String>,
    State(state): State<ApiState>,
) -> Response {
    match state.twitch.fetch_user_info(&username).await {
        Ok(user) => Json(user).into_response(),
        Err(e) => not_found(e),
    }
}

async fn handle_get_user_vods(
    Path(username): Path<String>,
    State(state): State<ApiState>,
) -> Response {
    match state.twitch.fetch_user_vods(&username).await {
        Ok(vods) => Json(vods).into_response(),
        Err(e) => internal(e),
    }
}

async fn handle_get_user_live(
    Path(username): Path<String>,
    State(state): State<ApiState>,
) -> Response {
    match state.twitch.fetch_user_live_stream(&username).await {
        Ok(stream) => Json(stream).into_response(),
        Err(e) => internal(e),
    }
}

#[cfg(debug_assertions)]
async fn handle_dev_portal_redirect(headers: HeaderMap, uri: axum::http::Uri) -> Redirect {
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("localhost");

    let host_without_port = host.split(':').next().unwrap_or("localhost");
    let path_and_query = uri
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/");

    Redirect::temporary(&format!("http://{host_without_port}:5173{path_and_query}"))
}

async fn handle_shared_downloads(
    Path(file_path): Path<String>,
    State(state): State<ApiState>,
    req: axum::extract::Request,
) -> Response {
    let settings = state.history.get_settings().await;
    let Some(base_path) = settings.download_local_path.or(settings.download_network_shared_path) else {
        return not_found("Download path is not configured");
    };
    
    let full_path = std::path::PathBuf::from(base_path).join(&file_path);
    
    // Prevent directory traversal
    if full_path.components().any(|c| c.as_os_str() == "..") {
        return bad_request("Invalid path");
    }

    match ServeFile::new(&full_path).oneshot(req).await {
        Ok(res) => res.into_response(),
        Err(_) => not_found("File not found"),
    }
}

use serde::Serialize;

#[derive(Serialize)]
struct DownloadedFile {
    name: String,
    size: u64,
    url: String,
    metadata: Option<Value>,
}

async fn handle_get_downloads(State(state): State<ApiState>) -> Response {
    let settings = state.history.get_settings().await;
    let Some(base_path) = settings.download_local_path.or(settings.download_network_shared_path) else {
        return Json(Vec::<DownloadedFile>::new()).into_response();
    };

    let mut files = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(&base_path).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Ok(fs_meta) = entry.metadata().await {
                if fs_meta.is_file() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.ends_with(".mp4") || name.ends_with(".ts") || name.ends_with(".mkv") {
                        let path = entry.path();
                        let json_path = path.with_extension("json");
                        let mut metadata = None;
                        
                        if let Ok(json_content) = tokio::fs::read_to_string(&json_path).await {
                            if let Ok(parsed) = serde_json::from_str(&json_content) {
                                metadata = Some(parsed);
                            }
                        }

                        files.push(DownloadedFile {
                            name: name.clone(),
                            size: fs_meta.len(),
                            url: format!("/shared-downloads/{}", name),
                            metadata,
                        });
                    }
                }
            }
        }
    }
    
    Json(files).into_response()
}

async fn handle_system_dialog_folder() -> Response {
    if let Some(folder) = rfd::AsyncFileDialog::new().pick_folder().await {
        return Json(serde_json::json!({ "path": folder.path().to_string_lossy().to_string() })).into_response();
    }
    Json(serde_json::json!({ "path": null })).into_response()
}

async fn handle_get_active_downloads(State(state): State<ApiState>) -> impl IntoResponse {
    Json(state.download.get_all_downloads().await)
}

async fn handle_download_hls(
    Path(file_name): Path<String>,
    State(state): State<ApiState>,
) -> Response {
    if file_name.contains('/') || file_name.contains('\\') || file_name.contains("..") {
        return bad_request("Invalid file name");
    }

    let settings = state.history.get_settings().await;
    let Some(base_path) = settings.download_local_path.or(settings.download_network_shared_path) else {
        return not_found("Download path is not configured");
    };

    let full_path = std::path::PathBuf::from(&base_path).join(&file_name);
    let file_size = match tokio::fs::metadata(&full_path).await {
        Ok(m) if m.is_file() => m.len(),
        _ => return not_found("File not found"),
    };

    // Build a byte-range HLS playlist so hls.js can load the file progressively.
    const CHUNK_BYTES: u64 = 10 * 1024 * 1024; // 10 MB per segment
    const EST_SECS: f64 = 10.0;
    let num_chunks = (file_size + CHUNK_BYTES - 1) / CHUNK_BYTES;

    let mut playlist = format!(
        "#EXTM3U\n#EXT-X-VERSION:4\n#EXT-X-TARGETDURATION:{}\n#EXT-X-MEDIA-SEQUENCE:0\n",
        EST_SECS.ceil() as u64
    );

    let segment_url = format!("/api/shared-downloads/{file_name}");
    for i in 0..num_chunks {
        let offset = i * CHUNK_BYTES;
        let length = std::cmp::min(CHUNK_BYTES, file_size - offset);
        playlist.push_str(&format!(
            "#EXTINF:{EST_SECS:.3},\n#EXT-X-BYTERANGE:{length}@{offset}\n{segment_url}\n"
        ));
    }
    playlist.push_str("#EXT-X-ENDLIST\n");

    m3u8_response(playlist)
}

#[derive(Deserialize)]
struct DownloadRequest {
    #[serde(rename = "vodId")]
    vod_id: String,
    title: Option<String>,
    quality: String,
    #[serde(rename = "startTime")]
    start_time: Option<f64>,
    #[serde(rename = "endTime")]
    end_time: Option<f64>,
    duration: Option<f64>,
}

async fn handle_start_download(
    State(state): State<ApiState>,
    Json(req): Json<DownloadRequest>,
) -> Response {
    let settings = state.history.get_settings().await;
    let out_dir = settings.download_local_path.unwrap_or_else(|| {
        dirs::download_dir()
            .map(|p: std::path::PathBuf| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string())
    });

    let port = super::SERVER_PORT;
    let master_m3u8_url = format!("http://127.0.0.1:{}/api/vod/{}/master.m3u8", port, req.vod_id);
    let output_file_base = format!("{}/{}_{}", out_dir, req.vod_id, req.quality);
    let output_file = format!("{}.ts", output_file_base);
    let output_json = format!("{}.json", output_file_base);

    let title = req.title.unwrap_or_else(|| format!("VOD {}", req.vod_id));
    let duration = req.duration.unwrap_or(0.0);

    // Fetch and save metadata
    let vods = state.twitch.fetch_vods_by_ids(vec![req.vod_id.clone()]).await;
    if let Some(vod) = vods.into_iter().next() {
        if let Ok(json_str) = serde_json::to_string_pretty(&vod) {
            let _ = tokio::fs::write(&output_json, json_str).await;
        }
    }

    match state.download.start_download(
        req.vod_id,
        title,
        master_m3u8_url,
        output_file,
        req.start_time,
        req.end_time,
        duration,
    ).await {
        Ok(_) => Json(serde_json::json!({ "message": "Download started" })).into_response(),
        Err(e) => internal(e),
    }
}

// ── Router factory ────────────────────────────────────────────────────────────

pub fn build_router(state: ApiState, portal_dist: Option<std::path::PathBuf>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let api = Router::new()
        // Video data
        .route("/vod/:vod_id/chat", get(handle_vod_chat))
        .route("/vod/:vod_id/markers", get(handle_vod_markers))
        .route("/vod/:vod_id/info", get(handle_vod_info))
        .route("/vod/:vod_id/master.m3u8", get(handle_vod_master))
        .route("/live/:login/master.m3u8", get(handle_live_master))
        .route("/live/:login/chat.html", get(handle_chat_iframe))
        .route("/stream/variant.m3u8", get(handle_proxy_variant))
        .route("/stream/variant.ts", get(handle_proxy_segment))
        // Shared Downloads
        .route("/downloads", get(handle_get_downloads))
        .route("/downloads/active", get(handle_get_active_downloads))
        .route("/downloads/hls/:file_name", get(handle_download_hls))
        .route("/shared-downloads/*path", get(handle_shared_downloads))
        .route("/download/start", axum::routing::post(handle_start_download))
        .route("/system/dialog/folder", get(handle_system_dialog_folder))
        // Watchlist
        .route("/watchlist", get(handle_get_watchlist).post(handle_add_watchlist))
        .route("/watchlist/:vod_id", delete(handle_remove_watchlist))
        // Settings
        .route("/settings", get(handle_get_settings).post(handle_update_settings))
        .route("/adblock/proxies", get(handle_get_adblock_proxies))
        .route("/adblock/status", get(handle_get_adblock_status))
        // Subs
        .route("/subs", get(handle_get_subs).post(handle_add_sub))
        .route("/subs/:login", delete(handle_remove_sub))
        // Search
        .route("/search/channels", get(handle_search_channels))
        .route("/search/global", get(handle_search_global))
        .route("/search/category-vods", get(handle_search_category_vods))
        // Trends & Live
        .route("/trends", get(handle_trends))
        .route("/live", get(handle_live))
        .route("/live/top-categories", get(handle_live_top_categories))
        .route("/live/search", get(handle_live_search))
        .route("/live/category", get(handle_live_category))
        .route("/live/status", get(handle_live_status))
        // History
        .route("/history", get(handle_get_history).post(handle_post_history))
        .route("/history/list", get(handle_get_history_list))
        .route("/history/:vod_id", get(handle_get_history_vod))
        // User
        .route("/user/:username", get(handle_get_user))
        .route("/user/:username/vods", get(handle_get_user_vods))
        .route("/user/:username/live", get(handle_get_user_live))
        .with_state(state);

    let mut router = Router::new().nest("/api", api).layer(cors);

    // Serve portal static files if available
    if let Some(portal_path) = portal_dist {
        if portal_path.exists() {
            router = router
                .nest_service("/", ServeDir::new(&portal_path).append_index_html_on_directories(true));
        }
    } else {
        #[cfg(debug_assertions)]
        {
            router = router.fallback(get(handle_dev_portal_redirect));
        }
    }

    router
}
