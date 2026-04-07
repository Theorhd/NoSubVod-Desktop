#[cfg(debug_assertions)]
use axum::response::Redirect;
use axum::{
    body::Body,
    extract::{ws::WebSocketUpgrade, Path, Query, State},
    http::{header, StatusCode},
    middleware,
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};
use tauri::Emitter;
use tauri_plugin_autostart::ManagerExt;
#[cfg(target_os = "windows")]
use tokio::process::Command;
use tower::ServiceExt;
use tower_http::compression::CompressionLayer;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use super::{
    download_paths::{
        build_master_m3u8_url, build_output_file_base_path, build_output_file_path,
        resolve_download_output_dir,
    },
    dto::{
        ChatQuery, ChatSendBody, DownloadRequest, DownloadedFile, HistoryBody, HistoryListQuery,
        LiveCategoryQuery, LiveQuery, LiveSearchQuery, LiveStatusQuery, PairingRegisterBody,
        PairingRemotePushBody, PairingUnregisterBody, PagedQuery, SearchCategoryQuery,
        SearchQuery, SettingsPatch, TrustedDevicePatch, VariantProxyQuery,
    },
    error::{AppError, AppResult},
    middleware::{auth_middleware, security_headers_middleware},
    screenshare::StartScreenShareRequest,
    state::ApiState,
    types::{SubEntry, TrustedDevice, WatchlistEntry},
    validation::{
        filter_hevc_variants_for_ios, is_legacy_ios_request, is_valid_id, is_valid_login,
    },
};
use moka::future::Cache;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

async fn handle_get_extensions(State(state): State<ApiState>) -> impl IntoResponse {
    Json(state.extensions.list().await)
}

async fn handle_extension_files(
    Path((id, file_path)): Path<(String, String)>,
    State(state): State<ApiState>,
    req: axum::extract::Request,
) -> AppResult<Response> {
    let Some(base_path) = state.extensions.get_extension_path(&id).await else {
        return Err(AppError::NotFound("Extension not found".to_string()));
    };

    // Treat the extension directory as the base path.
    let base_dir = std::path::Path::new(&base_path);

    // Reject absolute paths in the user-supplied segment to avoid replacing the base.
    let requested_path = std::path::Path::new(&file_path);
    if requested_path.is_absolute() || file_path.contains("..") {
        return Err(AppError::BadRequest("Invalid path".to_string()));
    }

    // Join the base directory with the requested relative path
    let full_path = base_dir.join(requested_path);

    match ServeFile::new(&full_path).oneshot(req).await {
        Ok(res) => Ok(res.into_response()),
        Err(_) => Err(AppError::NotFound("File not found".to_string())),
    }
}

async fn handle_get_screenshare_state(State(state): State<ApiState>) -> impl IntoResponse {
    Json(state.screenshare.get_state().await)
}

async fn handle_start_screenshare(
    State(state): State<ApiState>,
    Json(request): Json<StartScreenShareRequest>,
) -> AppResult<Response> {
    let session = state
        .screenshare
        .start(state.app_handle.as_ref(), request)
        .await?;
    Ok(Json(session).into_response())
}

async fn handle_stop_screenshare(State(state): State<ApiState>) -> AppResult<Response> {
    let session = state.screenshare.stop(state.app_handle.as_ref()).await?;
    Ok(Json(session).into_response())
}

async fn handle_screenshare_ws(
    ws: WebSocketUpgrade,
    State(state): State<ApiState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| async move {
        state.screenshare.handle_socket(socket).await;
    })
}

async fn handle_screenshare_snapshot(State(state): State<ApiState>) -> AppResult<Response> {
    let session = state.screenshare.get_state().await;
    if !session.active {
        return Err(AppError::BadRequest(
            "Screen share session is not active".to_string(),
        ));
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err(AppError::BadRequest(
            "Snapshot capture is currently supported on Windows only".to_string(),
        ))
    }

    #[cfg(target_os = "windows")]
    {
        let Some(source_type) = session.source_type else {
            return Err(AppError::BadRequest(
                "No active screen share source".to_string(),
            ));
        };

        let capture_window_title = match source_type {
            super::screenshare::ScreenShareSourceType::Browser => {
                "NoSubVOD - Screen Share Browser".to_string()
            }
            super::screenshare::ScreenShareSourceType::Application => {
                let Some(label) = session.source_label else {
                    return Err(AppError::BadRequest(
                        "No selected application window for screen share".to_string(),
                    ));
                };
                label
            }
        };

        let output = Command::new("ffmpeg")
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-f")
            .arg("gdigrab")
            .arg("-i")
            .arg(format!("title={capture_window_title}"))
            .arg("-frames:v")
            .arg("1")
            .arg("-q:v")
            .arg("5")
            .arg("-f")
            .arg("image2pipe")
            .arg("-vcodec")
            .arg("mjpeg")
            .arg("-")
            .output()
            .await;

        let Ok(result) = output else {
            return Ok(snapshot_unavailable_image(
                "Snapshot unavailable: ffmpeg not found",
            ));
        };

        if !result.status.success() {
            return Ok(snapshot_unavailable_image(
                "Snapshot unavailable: host capture not ready",
            ));
        }

        Response::builder()
            .header(header::CONTENT_TYPE, "image/jpeg")
            .header(header::CACHE_CONTROL, "no-store")
            .body(Body::from(result.stdout))
            .map_err(|e| AppError::Internal(e.to_string()))
    }
}

#[cfg(target_os = "windows")]
fn snapshot_unavailable_image(reason: &str) -> Response {
    // Return a valid inline SVG so the viewer UI does not hit repeated 4xx/5xx errors.
    let body = format!(
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1280 720'><rect width='1280' height='720' fill='#050815'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='Segoe UI,Arial,sans-serif' font-size='28' fill='#9CA3AF'>{reason}</text></svg>"
    );

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "image/svg+xml; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(body))
        .unwrap_or_else(|_| {
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed to build SVG").into_response()
        })
}

// ── Error helpers ─────────────────────────────────────────────────────────────

fn m3u8_response(body: String) -> Response {
    Response::builder()
        .header(header::CONTENT_TYPE, "application/vnd.apple.mpegurl")
        .body(Body::from(body))
        .unwrap_or_else(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to build m3u8 response",
            )
                .into_response()
        })
}

// ── Route handlers ────────────────────────────────────────────────────────────

async fn handle_vod_chat(
    Path(vod_id): Path<String>,
    Query(q): Query<ChatQuery>,
    State(state): State<ApiState>,
) -> AppResult<Response> {
    if !is_valid_id(&vod_id) {
        return Err(AppError::BadRequest("Invalid VOD ID".to_string()));
    }

    if let Some(keyword) = q.keyword {
        if !keyword.trim().is_empty() {
            let data = state
                .twitch
                .search_video_chat(&vod_id, &keyword, 50)
                .await?;
            return Ok(Json(data).into_response());
        }
    }

    let offset = q.offset.unwrap_or(0.0);
    let limit = q.limit.unwrap_or(120).clamp(20, 200);
    let data = state
        .twitch
        .fetch_video_chat(&vod_id, offset, limit)
        .await?;
    Ok(Json(data).into_response())
}

async fn handle_vod_markers(
    Path(vod_id): Path<String>,
    State(state): State<ApiState>,
) -> AppResult<Response> {
    if !is_valid_id(&vod_id) {
        return Err(AppError::BadRequest("Invalid VOD ID".to_string()));
    }
    let data = state.twitch.fetch_video_markers(&vod_id).await?;
    Ok(Json(data).into_response())
}

async fn handle_vod_info(
    Path(vod_id): Path<String>,
    State(state): State<ApiState>,
) -> AppResult<Response> {
    if !is_valid_id(&vod_id) {
        return Err(AppError::BadRequest("Invalid VOD ID".to_string()));
    }
    let vods = state.twitch.fetch_vods_by_ids(vec![vod_id]).await;
    if let Some(vod) = vods.into_iter().next() {
        Ok(Json(vod).into_response())
    } else {
        Err(AppError::NotFound("VOD not found".to_string()))
    }
}

async fn handle_vod_master(
    Path(vod_id): Path<String>,
    State(state): State<ApiState>,
    headers: axum::http::HeaderMap,
) -> AppResult<Response> {
    if !is_valid_id(&vod_id) {
        return Err(AppError::BadRequest("Invalid VOD ID".to_string()));
    }
    let host = headers
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("localhost")
        .to_string();

    let playlist = state
        .twitch
        .generate_master_playlist(&vod_id, &host, &state.server_token)
        .await?;

    let body = if is_legacy_ios_request(&headers) {
        filter_hevc_variants_for_ios(&playlist)
    } else {
        playlist
    };
    Ok(m3u8_response(body))
}

async fn handle_live_master(
    Path(login): Path<String>,
    State(state): State<ApiState>,
    headers: axum::http::HeaderMap,
) -> AppResult<Response> {
    let login = login.trim().to_lowercase();
    if !is_valid_login(&login) {
        return Err(AppError::BadRequest("Invalid channel login".to_string()));
    }
    let host = headers
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("localhost")
        .to_string();

    let settings = state.history.get_settings().await;
    let m3u8 = state
        .twitch
        .generate_live_master_playlist(&login, &host, &settings, &state.server_token)
        .await?;

    let body = if is_legacy_ios_request(&headers) {
        filter_hevc_variants_for_ios(&m3u8)
    } else {
        m3u8
    };
    Ok(m3u8_response(body))
}

async fn handle_proxy_variant(
    Query(q): Query<VariantProxyQuery>,
    State(state): State<ApiState>,
) -> AppResult<Response> {
    let Some(id) = q.id else {
        return Err(AppError::BadRequest("Missing id parameter".to_string()));
    };

    let settings = state.history.get_settings().await;
    let body = match state
        .twitch
        .proxy_variant_playlist(&id, &settings, &state.server_token)
        .await
    {
        Ok(body) => body,
        Err(first_error) => {
            tracing::warn!(
                error = %first_error,
                "Transient variant playlist failure, retrying once"
            );
            tokio::time::sleep(Duration::from_millis(150)).await;
            state
                .twitch
                .proxy_variant_playlist(&id, &settings, &state.server_token)
                .await?
        }
    };
    Ok(m3u8_response(body))
}

async fn handle_proxy_segment(
    Query(q): Query<VariantProxyQuery>,
    State(state): State<ApiState>,
) -> AppResult<Response> {
    const SEGMENT_CACHEABLE_MAX_BYTES: u64 = 1_500_000;

    let cache_key = if let Some(id) = q.id.as_deref() {
        Some(format!("id:{id}"))
    } else {
        q.url.as_ref().map(|url| format!("url:{url}"))
    };

    if let Some(ref key) = cache_key {
        if let Some(cached) = state.segment_cache.get(key).await {
            let mut builder = Response::builder();
            if let Some(ct) = cached.content_type {
                builder = builder.header(reqwest::header::CONTENT_TYPE, ct);
            }
            builder = builder
                .header("x-cache-status", "HIT")
                .header(header::CACHE_CONTROL, "no-store");
            return builder
                .body(Body::from(cached.body))
                .map_err(|e| AppError::Internal(e.to_string()));
        }
    }

    let settings = state.history.get_settings().await;
    let resp = if let Some(id) = q.id {
        state.twitch.proxy_segment(&id, &settings).await?
    } else if let Some(url) = q.url {
        state.twitch.proxy_segment_url(&url, &settings).await?
    } else {
        return Err(AppError::BadRequest(
            "Missing id or url parameter".to_string(),
        ));
    };

    let mut builder = Response::builder();
    builder = builder
        .header("x-cache-status", "MISS")
        .header(header::CACHE_CONTROL, "no-store");
    if let Some(ct) = resp.headers().get(reqwest::header::CONTENT_TYPE) {
        builder = builder.header(reqwest::header::CONTENT_TYPE, ct);
    }

    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let should_cache = resp
        .content_length()
        .map(|len| len > 0 && len <= SEGMENT_CACHEABLE_MAX_BYTES)
        .unwrap_or(false);

    if should_cache {
        let bytes = resp.bytes().await.map_err(AppError::from)?;
        if let Some(ref key) = cache_key {
            if (bytes.len() as u64) <= SEGMENT_CACHEABLE_MAX_BYTES {
                state
                    .segment_cache
                    .insert(
                        key.clone(),
                        crate::server::state::CachedSegment {
                            content_type: content_type.clone(),
                            body: bytes.clone(),
                        },
                    )
                    .await;
            }
        }

        return builder
            .body(Body::from(bytes))
            .map_err(|e| AppError::Internal(e.to_string()));
    }

    let body = Body::from_stream(resp.bytes_stream());
    builder
        .body(body)
        .map_err(|e| AppError::Internal(e.to_string()))
}

async fn handle_get_watchlist(
    Query(q): Query<PagedQuery>,
    State(state): State<ApiState>,
) -> impl IntoResponse {
    let offset = q.offset.unwrap_or(0);
    let limit = q.limit.unwrap_or(100).clamp(1, 250);

    let (items, _total) = state.history.get_watchlist_paged(offset, limit).await;
    Json(items)
}

async fn handle_add_watchlist(
    State(state): State<ApiState>,
    Json(entry): Json<WatchlistEntry>,
) -> AppResult<Response> {
    state.history.add_to_watchlist(entry).await?;
    Ok(Json(serde_json::json!({ "ok": true })).into_response())
}

async fn handle_remove_watchlist(
    Path(vod_id): Path<String>,
    State(state): State<ApiState>,
) -> AppResult<impl IntoResponse> {
    state.history.remove_from_watchlist(&vod_id).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn handle_get_settings(State(state): State<ApiState>) -> impl IntoResponse {
    Json(state.history.get_settings().await)
}

async fn handle_get_adblock_proxies(State(state): State<ApiState>) -> impl IntoResponse {
    state.twitch.refresh_adblock_proxy_state();
    Json(state.twitch.get_all_proxies().await)
}

async fn handle_get_adblock_status(State(state): State<ApiState>) -> impl IntoResponse {
    state.twitch.refresh_adblock_proxy_state();
    Json(state.twitch.get_current_proxy().await)
}

async fn handle_get_trusted_devices(State(state): State<ApiState>) -> impl IntoResponse {
    Json(state.history.get_trusted_devices().await)
}

async fn handle_set_trusted_device(
    Path(device_id): Path<String>,
    State(state): State<ApiState>,
    Json(patch): Json<TrustedDevicePatch>,
) -> AppResult<Response> {
    match state
        .history
        .set_device_trusted(device_id.trim(), patch.trusted)
        .await?
    {
        Some(device) => Ok(Json(device).into_response()),
        None => Err(AppError::NotFound("Device not found".to_string())),
    }
}

async fn handle_update_settings(
    State(state): State<ApiState>,
    Json(patch): Json<SettingsPatch>,
) -> AppResult<Response> {
    if let (Some(handle), Some(launch)) = (state.app_handle.as_ref(), patch.launch_at_login) {
        let manager = handle.autolaunch();
        if launch {
            let _ = manager.enable();
        } else {
            let _ = manager.disable();
        }
    }

    Ok(Json(
        state
            .history
            .update_settings(
                patch.one_sync,
                patch.adblock_enabled,
                patch.adblock_proxy,
                patch.adblock_proxy_mode,
                patch.default_video_quality,
                patch.min_video_quality,
                patch.preferred_video_quality,
                patch.download_local_path,
                patch.download_network_shared_path,
                patch.launch_at_login,
                patch.auto_update,
                patch.enabled_extensions,
            )
            .await?,
    )
    .into_response())
}

fn normalize_pairing_device_id(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > 128 {
        return None;
    }

    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return None;
    }

    Some(trimmed.to_string())
}

#[derive(Clone)]
struct ApnsConfig {
    team_id: String,
    key_id: String,
    bundle_id: String,
    private_key_pem: String,
    use_sandbox: bool,
}

#[derive(Serialize)]
struct ApnsClaims<'a> {
    iss: &'a str,
    iat: usize,
}

fn read_env_required(name: &str) -> Result<String, String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Missing environment variable: {name}"))
}

fn read_apns_config() -> Result<ApnsConfig, String> {
    let raw_private_key = read_env_required("NSV_APNS_PRIVATE_KEY")?;
    let private_key_pem = raw_private_key.replace("\\n", "\n");
    if !private_key_pem.contains("BEGIN PRIVATE KEY") {
        return Err("NSV_APNS_PRIVATE_KEY must contain a PEM private key".to_string());
    }

    let use_sandbox = std::env::var("NSV_APNS_SANDBOX")
        .ok()
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            normalized == "1" || normalized == "true" || normalized == "yes"
        })
        .unwrap_or(false);

    Ok(ApnsConfig {
        team_id: read_env_required("NSV_APNS_TEAM_ID")?,
        key_id: read_env_required("NSV_APNS_KEY_ID")?,
        bundle_id: read_env_required("NSV_APNS_BUNDLE_ID")?,
        private_key_pem,
        use_sandbox,
    })
}

fn build_apns_jwt(config: &ApnsConfig) -> Result<String, String> {
    let iat = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("System clock error: {e}"))?
        .as_secs() as usize;

    let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::ES256);
    header.kid = Some(config.key_id.clone());

    let claims = ApnsClaims {
        iss: &config.team_id,
        iat,
    };

    let key = jsonwebtoken::EncodingKey::from_ec_pem(config.private_key_pem.as_bytes())
        .map_err(|e| format!("Invalid APNs private key: {e}"))?;

    jsonwebtoken::encode(&header, &claims, &key)
        .map_err(|e| format!("Failed to sign APNs JWT: {e}"))
}

fn apns_base_url(config: &ApnsConfig) -> &'static str {
    if config.use_sandbox {
        "https://api.sandbox.push.apple.com"
    } else {
        "https://api.push.apple.com"
    }
}

async fn send_apns_push(
    client: reqwest::Client,
    config: ApnsConfig,
    bearer_token: String,
    device_token: String,
    title: String,
    message: String,
) -> bool {
    let endpoint = format!("{}/3/device/{}", apns_base_url(&config), device_token);
    let payload = serde_json::json!({
        "aps": {
            "alert": {
                "title": title,
                "body": message,
            },
            "sound": "default"
        },
        "source": "nosubvod-desktop"
    });

    let response = match client
        .post(endpoint)
        .header("authorization", format!("bearer {bearer_token}"))
        .header("apns-topic", config.bundle_id)
        .header("apns-push-type", "alert")
        .header("apns-priority", "10")
        .json(&payload)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!(error = %error, "Failed to reach APNs endpoint");
            return false;
        }
    };

    if response.status().is_success() {
        return true;
    }

    let status = response.status();
    let response_body = response.text().await.unwrap_or_default();
    tracing::warn!(
        status = %status,
        body = %response_body,
        "APNs push rejected"
    );
    false
}

async fn handle_pairing_register(
    State(state): State<ApiState>,
    Json(body): Json<PairingRegisterBody>,
) -> AppResult<Response> {
    let device_id = normalize_pairing_device_id(&body.device_id)
        .ok_or_else(|| AppError::BadRequest("Invalid device id".to_string()))?;

    let updated = state
        .history
        .register_pairing_device(
            &device_id,
            body.platform,
            body.apns_token,
            body.push_enabled.unwrap_or(true),
        )
        .await?;

    Ok(Json(serde_json::json!({
        "paired": true,
        "device": updated,
        "hasApnsToken": updated.apns_token.is_some(),
        "pushEnabled": updated.push_enabled,
    }))
    .into_response())
}

async fn handle_pairing_unregister(
    State(state): State<ApiState>,
    Json(body): Json<PairingUnregisterBody>,
) -> AppResult<Response> {
    let device_id = normalize_pairing_device_id(&body.device_id)
        .ok_or_else(|| AppError::BadRequest("Invalid device id".to_string()))?;

    match state.history.unregister_pairing_device(&device_id).await? {
        Some(updated) => Ok(Json(serde_json::json!({
            "paired": false,
            "device": updated,
        }))
        .into_response()),
        None => Err(AppError::NotFound("Device not found".to_string())),
    }
}

async fn handle_pairing_remote_push(
    State(state): State<ApiState>,
    Json(body): Json<PairingRemotePushBody>,
) -> AppResult<Response> {
    let title = body.title.trim();
    let message = body.message.trim();
    if title.is_empty() || message.is_empty() {
        return Err(AppError::BadRequest(
            "Title and message are required".to_string(),
        ));
    }

    let target_device_id = match body.device_id.as_deref() {
        Some(raw) => Some(
            normalize_pairing_device_id(raw)
                .ok_or_else(|| AppError::BadRequest("Invalid device id".to_string()))?,
        ),
        None => None,
    };

    let targets: Vec<TrustedDevice> = state
        .history
        .get_apns_push_targets(target_device_id.as_deref())
        .await;

    if targets.is_empty() {
        return Ok(Json(serde_json::json!({
            "delivered": false,
            "attempted": 0,
            "sent": 0,
            "failed": 0,
            "reason": "no-apns-target",
        }))
        .into_response());
    }

    let config = match read_apns_config() {
        Ok(config) => config,
        Err(reason) => {
            tracing::warn!(reason = %reason, "APNs config missing or invalid");
            return Ok(Json(serde_json::json!({
                "delivered": false,
                "attempted": targets.len(),
                "sent": 0,
                "failed": targets.len(),
                "reason": "apns-config-missing",
            }))
            .into_response());
        }
    };

    let bearer_token = build_apns_jwt(&config).map_err(AppError::Internal)?;
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| AppError::Internal(format!("Failed to build APNs client: {e}")))?;

    let mut device_tokens: Vec<String> = Vec::new();
    for device in &targets {
        if let Some(token) = device.apns_token.as_deref() {
            let trimmed = token.trim();
            if !trimmed.is_empty() {
                device_tokens.push(trimmed.to_string());
            }
        }
    }

    let attempted = device_tokens.len();
    let mut sent = 0usize;

    for device_token in device_tokens {
        if send_apns_push(
            client.clone(),
            config.clone(),
            bearer_token.clone(),
            device_token,
            title.to_string(),
            message.to_string(),
        )
        .await
        {
            sent += 1;
        }
    }

    let failed = attempted.saturating_sub(sent);

    Ok(Json(serde_json::json!({
        "delivered": sent > 0,
        "attempted": attempted,
        "sent": sent,
        "failed": failed,
    }))
    .into_response())
}

async fn handle_get_subs(
    Query(q): Query<PagedQuery>,
    State(state): State<ApiState>,
) -> impl IntoResponse {
    let offset = q.offset.unwrap_or(0);
    let limit = q.limit.unwrap_or(100).clamp(1, 250);

    let (items, _total) = state.history.get_subs_paged(offset, limit).await;
    Json(items)
}

async fn handle_add_sub(
    State(state): State<ApiState>,
    Json(entry): Json<SubEntry>,
) -> AppResult<Response> {
    if entry.login.is_empty() || entry.display_name.is_empty() || entry.profile_image_url.is_empty()
    {
        return Err(AppError::BadRequest("Invalid sub payload".to_string()));
    }
    state.history.add_sub(entry).await?;
    Ok(Json(serde_json::json!({ "ok": true })).into_response())
}

async fn handle_remove_sub(
    Path(login): Path<String>,
    State(state): State<ApiState>,
) -> AppResult<impl IntoResponse> {
    state.history.remove_sub(&login).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn handle_search_channels(
    Query(q): Query<SearchQuery>,
    State(state): State<ApiState>,
) -> AppResult<Response> {
    let Some(query) = q.q.filter(|s| !s.is_empty()) else {
        return Ok(Json(Value::Array(vec![])).into_response());
    };
    let results = state.twitch.search_channels(&query).await?;
    Ok(Json(results).into_response())
}

async fn handle_search_global(
    Query(q): Query<SearchQuery>,
    State(state): State<ApiState>,
) -> AppResult<Response> {
    let Some(query) = q.q.filter(|s| !s.is_empty()) else {
        return Ok(Json(Value::Array(vec![])).into_response());
    };
    let results = state.twitch.search_global_content(&query).await?;
    Ok(Json(results).into_response())
}

async fn handle_search_category_vods(
    Query(q): Query<SearchCategoryQuery>,
    State(state): State<ApiState>,
) -> AppResult<Response> {
    let id = q.id.unwrap_or_default();
    let id = id.trim().to_string();
    let name = q.name.unwrap_or_default();
    let name = name.trim().to_string();
    if id.is_empty() && name.is_empty() {
        return Ok(
            Json(serde_json::json!({ "items": [], "hasMore": false, "nextCursor": null }))
                .into_response(),
        );
    }
    let limit = q
        .limit
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(36)
        .clamp(4, 50);
    let cursor = q
        .cursor
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let (items, next_cursor, has_more) = state
        .twitch
        .fetch_category_vods_page(
            &name,
            if id.is_empty() {
                None
            } else {
                Some(id.as_str())
            },
            limit,
            cursor.as_deref(),
        )
        .await;
    Ok(Json(serde_json::json!({
        "items": items,
        "hasMore": has_more,
        "nextCursor": next_cursor,
    }))
    .into_response())
}

async fn handle_trends(State(state): State<ApiState>) -> AppResult<Response> {
    let (history, subs) = state.history.get_trending_input().await;
    let results = state.twitch.fetch_trending_vods(history, subs).await?;
    Ok(Json(results).into_response())
}

async fn handle_live(
    Query(q): Query<LiveQuery>,
    State(state): State<ApiState>,
) -> AppResult<Response> {
    let limit = q
        .limit
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(24)
        .clamp(8, 48);
    // Support both 'cursor' and 'after' params, preferring 'cursor'
    let cursor = q
        .cursor
        .or(q.after)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let page = state
        .twitch
        .fetch_live_streams(limit, cursor.as_deref())
        .await?;
    Ok(Json(page).into_response())
}

async fn handle_live_top_categories(State(state): State<ApiState>) -> AppResult<Response> {
    let cats = state.twitch.fetch_top_live_categories().await?;
    Ok(Json(cats).into_response())
}

async fn handle_live_category(
    Query(q): Query<LiveCategoryQuery>,
    State(state): State<ApiState>,
) -> AppResult<Response> {
    let name = q.name.unwrap_or_default().trim().to_string();
    if name.is_empty() {
        return Err(AppError::BadRequest("Missing category name".to_string()));
    }
    let limit = q
        .limit
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(24)
        .clamp(8, 48);
    // Support both 'cursor' and 'after' (if we decide to add it to LiveCategoryQuery too)
    let cursor = q
        .cursor
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let page = state
        .twitch
        .fetch_live_streams_by_category(&name, limit, cursor.as_deref())
        .await?;
    Ok(Json(page).into_response())
}

async fn handle_live_search(
    Query(q): Query<LiveSearchQuery>,
    State(state): State<ApiState>,
) -> AppResult<Response> {
    let query = q.q.unwrap_or_default().trim().to_string();
    if query.is_empty() {
        return Err(AppError::BadRequest("Missing query".to_string()));
    }
    let limit = q
        .limit
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(24)
        .clamp(8, 48);
    let page = state
        .twitch
        .search_live_streams_by_query(&query, limit)
        .await?;
    Ok(Json(page).into_response())
}

async fn handle_live_status(
    Query(q): Query<LiveStatusQuery>,
    State(state): State<ApiState>,
) -> impl IntoResponse {
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
    Json::<std::collections::HashMap<String, crate::server::types::HistoryEntry>>(
        state.history.get_all_history().await,
    )
}

async fn handle_get_history_list(
    Query(q): Query<HistoryListQuery>,
    State(state): State<ApiState>,
) -> impl IntoResponse {
    let limit = q
        .limit
        .and_then(|s| s.parse::<usize>().ok())
        .map(|l| l.clamp(1, 100))
        .unwrap_or(50);

    let offset = q.offset.and_then(|s| s.parse::<usize>().ok()).unwrap_or(0);

    let (entries, _total) = state.history.get_history_paged(offset, limit).await;

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

    Json(enriched)
}

async fn handle_get_history_vod(
    Path(vod_id): Path<String>,
    State(state): State<ApiState>,
) -> impl IntoResponse {
    match state.history.get_history_by_vod_id(&vod_id).await {
        Some(entry) => Json(entry).into_response(),
        None => Json(serde_json::Value::Null).into_response(),
    }
}

async fn handle_post_history(
    State(state): State<ApiState>,
    Json(body): Json<HistoryBody>,
) -> AppResult<Response> {
    let Some(vod_id) = body.vod_id else {
        return Err(AppError::BadRequest("Invalid parameters".to_string()));
    };
    let Some(timecode) = body.timecode else {
        return Err(AppError::BadRequest("Invalid parameters".to_string()));
    };
    let duration = body.duration.unwrap_or(0.0);

    let entry = state
        .history
        .update_history(&vod_id, timecode, duration)
        .await?;
    Ok(Json(entry).into_response())
}

async fn handle_get_user(
    Path(username): Path<String>,
    State(state): State<ApiState>,
) -> AppResult<Response> {
    if !is_valid_login(&username) {
        return Err(AppError::BadRequest("Invalid username".to_string()));
    }
    let user = state.twitch.fetch_user_info(&username).await?;
    Ok(Json(user).into_response())
}

async fn handle_get_user_vods(
    Path(username): Path<String>,
    State(state): State<ApiState>,
) -> AppResult<Response> {
    if !is_valid_login(&username) {
        return Err(AppError::BadRequest("Invalid username".to_string()));
    }
    let vods = state.twitch.fetch_user_vods(&username).await?;
    Ok(Json(vods).into_response())
}

async fn handle_get_user_live(
    Path(username): Path<String>,
    State(state): State<ApiState>,
) -> AppResult<Response> {
    if !is_valid_login(&username) {
        return Err(AppError::BadRequest("Invalid username".to_string()));
    }
    let stream = state.twitch.fetch_user_live_stream(&username).await?;
    Ok(Json(stream).into_response())
}

#[cfg(debug_assertions)]
async fn handle_dev_portal_redirect(
    headers: axum::http::HeaderMap,
    uri: axum::http::Uri,
) -> Redirect {
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("localhost");

    let host_without_port = host.split(':').next().unwrap_or("localhost");
    let path_and_query = uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("/");

    Redirect::temporary(&format!("https://{host_without_port}:5173{path_and_query}"))
}

async fn handle_shared_downloads(
    Path(file_path): Path<String>,
    State(state): State<ApiState>,
    req: axum::extract::Request,
) -> AppResult<Response> {
    let settings = state.history.get_settings().await;
    let Some(base_path) = settings
        .download_local_path
        .or(settings.download_network_shared_path)
    else {
        return Err(AppError::NotFound(
            "Download path is not configured".to_string(),
        ));
    };

    // Treat the configured download directory as the base path.
    let base_dir = std::path::Path::new(&base_path);

    // Reject absolute paths in the user-supplied segment to avoid replacing the base.
    let requested_path = std::path::Path::new(&file_path);
    if requested_path.is_absolute() {
        return Err(AppError::BadRequest("Invalid path".to_string()));
    }

    // Resolve the base directory to an absolute, canonical path.
    let base_dir_canon = tokio::fs::canonicalize(base_dir)
        .await
        .map_err(|_| AppError::NotFound("Download path is not configured".to_string()))?;

    // Join the base directory with the requested relative path, then canonicalize.
    let full_path = base_dir.join(requested_path);
    let full_path_canon = tokio::fs::canonicalize(&full_path)
        .await
        .map_err(|_| AppError::NotFound("File not found".to_string()))?;

    // Ensure the resolved path is still within the configured download directory.
    if !full_path_canon.starts_with(&base_dir_canon) {
        return Err(AppError::BadRequest("Invalid path".to_string()));
    }

    match ServeFile::new(&full_path_canon).oneshot(req).await {
        Ok(res) => {
            let mut response = res.into_response();
            if file_path.ends_with(".ts") {
                response
                    .headers_mut()
                    .insert(header::CONTENT_TYPE, "video/mp2t".parse().unwrap());
            }
            Ok(response)
        }
        Err(_) => Err(AppError::NotFound("File not found".to_string())),
    }
}

async fn handle_get_downloads(State(state): State<ApiState>) -> impl IntoResponse {
    let settings = state.history.get_settings().await;
    let Some(base_path) = settings
        .download_local_path
        .or(settings.download_network_shared_path)
    else {
        return Json(Vec::<DownloadedFile>::new()).into_response();
    };

    // Try cache first (5s TTL)
    if let Some(cached) = state.download_cache.get("list").await {
        return Json::<Vec<DownloadedFile>>(cached).into_response();
    }

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

    state
        .download_cache
        .insert("list".to_string(), files.clone())
        .await;
    Json(files).into_response()
}

async fn handle_system_dialog_folder() -> impl IntoResponse {
    if let Some(folder) = rfd::AsyncFileDialog::new().pick_folder().await {
        return Json(serde_json::json!({ "path": folder.path().to_string_lossy().to_string() }))
            .into_response();
    }
    Json(serde_json::json!({ "path": null })).into_response()
}

async fn handle_get_active_downloads(State(state): State<ApiState>) -> impl IntoResponse {
    Json(state.download.get_all_downloads().await)
}

// ── Live chat send ─────────────────────────────────────────────────────────────

async fn handle_live_chat_send(
    Path(login): Path<String>,
    State(state): State<ApiState>,
    Json(body): Json<ChatSendBody>,
) -> AppResult<Response> {
    let message = body.message.trim().to_string();
    if message.is_empty() {
        return Err(AppError::BadRequest("Empty message".to_string()));
    }
    if message.len() > 500 {
        return Err(AppError::BadRequest(
            "Message too long (max 500 chars)".to_string(),
        ));
    }

    let settings = state.history.get_settings().await;
    let token = state.history.get_twitch_token().await;

    let (Some(access_token), Some(sender_id)) = (token, settings.twitch_user_id) else {
        return Err(AppError::Unauthorized(
            "Not linked to a Twitch account".to_string(),
        ));
    };

    let client = state.twitch.shared_client().clone();

    // Resolve login → broadcaster_id
    let broadcaster_id_res: Result<reqwest::Response, reqwest::Error> = client
        .get(format!("https://api.twitch.tv/helix/users?login={}", login))
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Client-Id", crate::server::auth::TWITCH_CLIENT_ID.as_str())
        .send()
        .await;

    let broadcaster_id = match broadcaster_id_res {
        Ok(r) if r.status().is_success() => {
            let body: serde_json::Value = r.json().await.unwrap_or_default();
            body.get("data")
                .and_then(|d| d.as_array())
                .and_then(|a| a.first())
                .and_then(|u| u.get("id"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        }
        _ => {
            return Err(AppError::Internal(
                "Failed to resolve broadcaster ID".to_string(),
            ))
        }
    };

    if broadcaster_id.is_empty() {
        return Err(AppError::NotFound("Channel not found".to_string()));
    }

    // Send via Helix chat messages API (requires user:write:chat scope)
    let resp = client
        .post("https://api.twitch.tv/helix/chat/messages")
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Client-Id", crate::server::auth::TWITCH_CLIENT_ID.as_str())
        .json(&serde_json::json!({
            "broadcaster_id": broadcaster_id,
            "sender_id": sender_id,
            "message": message,
        }))
        .send()
        .await?;

    if resp.status().is_success() {
        let body: serde_json::Value = resp.json().await.unwrap_or_default();
        let result = body
            .get("data")
            .and_then(|d| d.as_array())
            .and_then(|a| a.first())
            .cloned()
            .unwrap_or_default();

        let is_sent = result
            .get("is_sent")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        if is_sent {
            Ok(Json(serde_json::json!({ "ok": true })).into_response())
        } else {
            let drop_code = result
                .get("drop_reason")
                .and_then(|d| d.get("code"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let drop_message = result
                .get("drop_reason")
                .and_then(|d| d.get("message"))
                .and_then(|v| v.as_str())
                .unwrap_or("Twitch a refusé le message.");

            Err(AppError::BadRequest(format!(
                "Message non envoyé par Twitch ({drop_code}): {drop_message}"
            )))
        }
    } else {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        Ok((status, Json(serde_json::json!({ "error": body }))).into_response())
    }
}

async fn handle_download_hls(
    Path(file_name): Path<String>,
    State(state): State<ApiState>,
) -> AppResult<Response> {
    if file_name.contains('/') || file_name.contains('\\') || file_name.contains("..") {
        return Err(AppError::BadRequest("Invalid file name".to_string()));
    }

    let settings = state.history.get_settings().await;
    let Some(base_path) = settings
        .download_local_path
        .or(settings.download_network_shared_path)
    else {
        return Err(AppError::NotFound(
            "Download path is not configured".to_string(),
        ));
    };

    let full_path = std::path::PathBuf::from(&base_path).join(&file_name);
    let file_size = match tokio::fs::metadata(&full_path).await {
        Ok(m) if m.is_file() => m.len(),
        _ => return Err(AppError::NotFound("File not found".to_string())),
    };

    // Build a byte-range HLS playlist so hls.js can load the file progressively.
    // TS packets are 188 bytes. Aligning chunks to multiples of 188 prevents sync errors.
    const CHUNK_BYTES: u64 = 188 * 50000; // ~9.4 MB per segment, perfectly aligned
    const EST_SECS: f64 = 12.0;
    let num_chunks = file_size.div_ceil(CHUNK_BYTES);

    let mut playlist = format!(
        "#EXTM3U\n#EXT-X-VERSION:4\n#EXT-X-TARGETDURATION:{}\n#EXT-X-MEDIA-SEQUENCE:0\n",
        EST_SECS.ceil() as u64
    );

    let encoded_name = urlencoding::encode(&file_name);
    let segment_url = format!(
        "/api/shared-downloads/{encoded_name}?t={}",
        state.server_token
    );
    for i in 0..num_chunks {
        let offset = i * CHUNK_BYTES;
        let length = std::cmp::min(CHUNK_BYTES, file_size - offset);
        playlist.push_str(&format!(
            "#EXTINF:{EST_SECS:.3},\n#EXT-X-BYTERANGE:{length}@{offset}\n{segment_url}\n"
        ));
    }
    playlist.push_str("#EXT-X-ENDLIST\n");

    Ok(m3u8_response(playlist))
}

async fn handle_start_download(
    State(state): State<ApiState>,
    Json(req): Json<DownloadRequest>,
) -> AppResult<Response> {
    let settings = state.history.get_settings().await;
    let out_dir = resolve_download_output_dir(settings.download_local_path);

    let port = super::SERVER_PORT;
    let master_m3u8_url = build_master_m3u8_url(port, &req.vod_id);
    let output_file_base = build_output_file_base_path(&out_dir, &req.vod_id, &req.quality);
    let output_file = build_output_file_path(&out_dir, &req.vod_id, &req.quality, "ts");
    let output_json = format!("{output_file_base}.json");

    let title = req.title.unwrap_or_else(|| format!("VOD {}", req.vod_id));
    let duration = req.duration.unwrap_or(0.0);

    // Fetch and save metadata
    let vods = state
        .twitch
        .fetch_vods_by_ids(vec![req.vod_id.clone()])
        .await;
    if let Some(vod) = vods.into_iter().next() {
        if let Ok(json_str) = serde_json::to_string_pretty(&vod) {
            let _ = tokio::fs::write(&output_json, json_str).await;
        }
    }

    state
        .download
        .start_download(
            req.vod_id,
            title,
            master_m3u8_url,
            output_file,
            req.start_time,
            req.end_time,
            duration,
        )
        .await?;

    Ok(Json(serde_json::json!({ "message": "Download started" })).into_response())
}

async fn handle_dev_sysinfo() -> impl IntoResponse {
    let mut sys = System::new_with_specifics(
        RefreshKind::new()
            .with_cpu(CpuRefreshKind::everything())
            .with_memory(MemoryRefreshKind::everything()),
    );
    // Need some wait for CPU stats to be valid
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    sys.refresh_all();

    let cpu_load = sys.global_cpu_usage();
    let memory_used = sys.used_memory();
    let memory_total = sys.total_memory();

    Json(serde_json::json!({
        "cpuLoad": cpu_load,
        "memoryUsed": memory_used,
        "memoryTotal": memory_total,
        "osName": System::name(),
        "osVersion": System::os_version(),
    }))
}

#[derive(Deserialize, Serialize, Clone)]
struct DevNotifyBody {
    title: String,
    message: String,
}

#[derive(Serialize)]
struct RuntimeCapabilities {
    platform: &'static str,
    screen_capture_host_supported: bool,
    webrtc_supported: bool,
}

async fn handle_get_capabilities() -> impl IntoResponse {
    Json(RuntimeCapabilities {
        platform: std::env::consts::OS,
        screen_capture_host_supported: cfg!(target_os = "windows"),
        webrtc_supported: true,
    })
}

async fn handle_dev_notify(
    State(state): State<ApiState>,
    Json(body): Json<DevNotifyBody>,
) -> AppResult<Response> {
    if let Some(app) = state.app_handle {
        app.emit("nsv-notification", &body)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(Json(serde_json::json!({ "success": true })).into_response())
    } else {
        Err(AppError::Internal("App handle unavailable".to_string()))
    }
}

#[derive(Deserialize)]
struct DevLogBody {
    level: String,
    message: String,
    extension_id: String,
}

async fn handle_dev_log(Json(body): Json<DevLogBody>) -> impl IntoResponse {
    let level = body.level.to_lowercase();
    let msg = format!("[Extension:{}] {}", body.extension_id, body.message);

    match level.as_str() {
        "error" => tracing::error!("{}", msg),
        "warn" => tracing::warn!("{}", msg),
        "info" => tracing::info!("{}", msg),
        "debug" => tracing::debug!("{}", msg),
        _ => tracing::info!("{}", msg),
    }

    Json(serde_json::json!({ "success": true }))
}

// ── Router factory ────────────────────────────────────────────────────────────

pub fn build_router(mut state: ApiState, portal_dist: Option<std::path::PathBuf>) -> Router {
    // Initialize download cache with 5s TTL
    state.download_cache = Cache::builder()
        .time_to_live(Duration::from_secs(5))
        .max_capacity(1) // Only one entry for the whole list
        .build();

    // Tiny backend cache for re-requested small media chunks.
    state.segment_cache = Cache::builder()
        .time_to_live(Duration::from_secs(15))
        .weigher(
            |_key: &String, value: &crate::server::state::CachedSegment| {
                value.body.len().min(u32::MAX as usize) as u32
            },
        )
        .max_capacity(32 * 1024 * 1024)
        .build();

    // CORS: allow only same-origin and local network origins (not Any)
    let cors = CorsLayer::new()
        .allow_origin(tower_http::cors::AllowOrigin::mirror_request())
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::PUT,
            axum::http::Method::DELETE,
            axum::http::Method::OPTIONS,
        ])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            "x-nsv-token".parse().unwrap(),
        ])
        .expose_headers([
            header::CONTENT_RANGE,
            header::CONTENT_LENGTH,
            header::ACCEPT_RANGES,
        ]);

    // Auth callback must remain unauthenticated (Twitch redirects here)
    let auth_callback = Router::new()
        .route(
            "/auth/twitch/callback",
            get(crate::server::auth::handle_auth_callback),
        )
        .with_state(state.clone());

    let api = Router::new()
        // Video data
        .route("/vod/:vod_id/chat", get(handle_vod_chat))
        .route("/vod/:vod_id/markers", get(handle_vod_markers))
        .route("/vod/:vod_id/info", get(handle_vod_info))
        .route("/vod/:vod_id/master.m3u8", get(handle_vod_master))
        .route("/live/:login/master.m3u8", get(handle_live_master))
        .route(
            "/live/:login/chat/ws",
            get(crate::server::chat::handle_chat_ws),
        )
        .route("/stream/variant.m3u8", get(handle_proxy_variant))
        .route("/stream/variant.ts", get(handle_proxy_segment))
        // Shared Downloads
        .route("/downloads", get(handle_get_downloads))
        .route("/downloads/active", get(handle_get_active_downloads))
        .route("/downloads/hls/:file_name", get(handle_download_hls))
        .route("/shared-downloads/*path", get(handle_shared_downloads))
        .route(
            "/download/start",
            axum::routing::post(handle_start_download),
        )
        .route("/system/dialog/folder", get(handle_system_dialog_folder))
        // Watchlist
        .route(
            "/watchlist",
            get(handle_get_watchlist).post(handle_add_watchlist),
        )
        .route("/watchlist/:vod_id", delete(handle_remove_watchlist))
        // Settings
        .route(
            "/settings",
            get(handle_get_settings).post(handle_update_settings),
        )
        .route("/capabilities", get(handle_get_capabilities))
        .route("/screenshare/state", get(handle_get_screenshare_state))
        .route("/screenshare/start", post(handle_start_screenshare))
        .route("/screenshare/stop", post(handle_stop_screenshare))
        .route("/screenshare/ws", get(handle_screenshare_ws))
        .route(
            "/screenshare/snapshot.jpg",
            get(handle_screenshare_snapshot),
        )
        .route("/trusted-devices", get(handle_get_trusted_devices))
        .route(
            "/trusted-devices/:device_id",
            put(handle_set_trusted_device),
        )
        .route("/pairing/register", post(handle_pairing_register))
        .route("/pairing/unregister", post(handle_pairing_unregister))
        .route("/pairing/remote-push", post(handle_pairing_remote_push))
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
        .route("/live/:login/chat/send", post(handle_live_chat_send))
        // Twitch auth
        .route(
            "/auth/twitch/start",
            get(crate::server::auth::handle_auth_start),
        )
        .route(
            "/auth/twitch/status",
            get(crate::server::auth::handle_auth_status),
        )
        .route(
            "/auth/twitch",
            delete(crate::server::auth::handle_auth_unlink),
        )
        .route(
            "/auth/twitch/import-follows",
            post(crate::server::auth::handle_auth_import_follows),
        )
        .route(
            "/auth/twitch/import-follows-setting",
            put(crate::server::auth::handle_auth_set_import_follows),
        )
        // History
        .route(
            "/history",
            get(handle_get_history).post(handle_post_history),
        )
        .route("/history/list", get(handle_get_history_list))
        .route("/history/:vod_id", get(handle_get_history_vod))
        // Extensions
        .route("/extensions", get(handle_get_extensions))
        .route("/extensions/:id/*file", get(handle_extension_files))
        // User
        .route("/user/:username", get(handle_get_user))
        .route("/user/:username/vods", get(handle_get_user_vods))
        .route("/user/:username/live", get(handle_get_user_live))
        // Auth middleware protects all these routes
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ))
        .with_state(state.clone());

    let dev = Router::new()
        .route("/sysinfo", get(handle_dev_sysinfo))
        .route("/notify", post(handle_dev_notify))
        .route("/log", post(handle_dev_log))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ))
        .with_state(state.clone());

    let mut router = Router::new()
        .nest("/api", auth_callback)
        .nest("/api", api)
        .nest("/api/dev", dev)
        .layer(middleware::from_fn(security_headers_middleware))
        .layer(TraceLayer::new_for_http())
        .layer(CompressionLayer::new())
        .layer(cors);

    // Serve portal static files if available
    if let Some(portal_path) = portal_dist {
        if portal_path.exists() {
            let serve_dir = ServeDir::new(&portal_path)
                .append_index_html_on_directories(true)
                .fallback(ServeFile::new(portal_path.join("index.html")));
            router = router.nest_service("/", serve_dir);
        }
    } else {
        #[cfg(debug_assertions)]
        {
            router = router.fallback(get(handle_dev_portal_redirect));
        }
    }

    router
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    // Helper to create a dummy state for testing
    async fn create_test_state() -> ApiState {
        let temp_dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&temp_dir).unwrap();

        let history =
            Arc::new(crate::server::history::HistoryStore::load(temp_dir.clone()).unwrap());
        let twitch = Arc::new(TwitchService::new());
        let download = Arc::new(DownloadManager::new());
        let screenshare = Arc::new(ScreenShareService::new());
        let oauth = Arc::new(crate::server::auth::OAuthStateStore::new());
        let extensions = Arc::new(crate::server::extensions::ExtensionManager::new(temp_dir));

        let download_cache = moka::future::Cache::builder()
            .time_to_live(std::time::Duration::from_secs(5))
            .max_capacity(1)
            .build();

        let segment_cache = moka::future::Cache::builder()
            .time_to_live(std::time::Duration::from_secs(20))
            .weigher(
                |_key: &String, value: &crate::server::state::CachedSegment| {
                    value.body.len().min(u32::MAX as usize) as u32
                },
            )
            .max_capacity(64 * 1024 * 1024)
            .build();

        ApiState {
            twitch,
            history,
            download,
            screenshare,
            extensions,
            oauth,
            server_token: "test_token".to_string(),
            app_handle: None,
            download_cache,
            segment_cache,
        }
    }

    #[tokio::test]
    async fn router_builds_and_handles_not_found() {
        let state = create_test_state().await;
        let app = build_router(state, None);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/does-not-exist")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn handle_vod_info_invalid_id() {
        let state = create_test_state().await;
        let app = build_router(state, None);

        // Making a request to an endpoint with an invalid ID
        // The id contains invalid characters like ! to trigger is_valid_id == false
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/vod/invalid!id/info")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn handle_live_master_invalid_login() {
        let state = create_test_state().await;
        let app = build_router(state, None);

        // Login is invalid due to special character
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/live/invalid!login/master.m3u8")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}
