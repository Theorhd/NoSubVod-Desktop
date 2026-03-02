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
use tower_http::services::ServeDir;

use super::{
    history::HistoryStore,
    twitch::TwitchService,
    types::{SubEntry, WatchlistEntry},
};

// ── Application state shared across all routes ─────────────────────────────────

#[derive(Clone)]
pub struct ApiState {
    pub twitch: Arc<TwitchService>,
    pub history: Arc<HistoryStore>,
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

    match state.twitch.generate_live_master_playlist(&login, &host).await {
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

    match state.twitch.proxy_variant_playlist(&id).await {
        Ok(body) => m3u8_response(body),
        Err(e) => internal(e),
    }
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

#[derive(Deserialize)]
struct SettingsPatch {
    #[serde(rename = "oneSync")]
    one_sync: Option<bool>,
}

async fn handle_update_settings(
    State(state): State<ApiState>,
    Json(patch): Json<SettingsPatch>,
) -> Response {
    Json(state.history.update_settings(patch.one_sync).await).into_response()
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
    let name = q.name.unwrap_or_default();
    let name = name.trim().to_string();
    if name.is_empty() {
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
        .fetch_category_vods_page(&name, limit, cursor.as_deref())
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
    let cursor = q.cursor.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

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
        .route("/vod/:vod_id/master.m3u8", get(handle_vod_master))
        .route("/live/:login/master.m3u8", get(handle_live_master))
        .route("/stream/variant.m3u8", get(handle_proxy_variant))
        // Watchlist
        .route("/watchlist", get(handle_get_watchlist).post(handle_add_watchlist))
        .route("/watchlist/:vod_id", delete(handle_remove_watchlist))
        // Settings
        .route("/settings", get(handle_get_settings).post(handle_update_settings))
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
