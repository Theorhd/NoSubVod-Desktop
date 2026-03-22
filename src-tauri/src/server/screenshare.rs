use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use std::{collections::HashMap, collections::HashSet};

use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::mpsc;
use tokio::sync::RwLock;

#[cfg(target_os = "windows")]
use windows::core::PCWSTR;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{HWND, RECT};
#[cfg(target_os = "windows")]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYEVENTF_KEYUP,
    MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP,
    MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_WHEEL, MOUSEINPUT, MOUSE_EVENT_FLAGS,
    VIRTUAL_KEY,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowW, GetForegroundWindow, GetWindowRect, SetCursorPos,
};

const DEFAULT_BROWSER_URL: &str = "https://google.com";
const SCREEN_SHARE_BROWSER_LABEL: &str = "screen-share-browser";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ScreenShareSourceType {
    Browser,
    Application,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenShareSessionState {
    pub active: bool,
    pub session_id: Option<String>,
    pub source_type: Option<ScreenShareSourceType>,
    pub source_label: Option<String>,
    pub started_at: Option<u64>,
    pub interactive: bool,
    pub max_viewers: u8,
    pub current_viewers: u8,
    pub stream_ready: bool,
    pub stream_message: Option<String>,
}

impl Default for ScreenShareSessionState {
    fn default() -> Self {
        Self {
            active: false,
            session_id: None,
            source_type: None,
            source_label: None,
            started_at: None,
            interactive: true,
            max_viewers: 5,
            current_viewers: 0,
            stream_ready: false,
            stream_message: None,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartScreenShareRequest {
    pub source_type: ScreenShareSourceType,
    pub url: Option<String>,
    pub source_label: Option<String>,
}

#[derive(Clone)]
pub struct ScreenShareService {
    session: Arc<RwLock<ScreenShareSessionState>>,
    clients: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<String>>>>,
    client_roles: Arc<RwLock<HashMap<String, String>>>,
    host_client_id: Arc<RwLock<Option<String>>>,
    input_rate_limit: Arc<RwLock<HashMap<String, u64>>>,
}

use super::error::{AppError, AppResult};

impl ScreenShareService {
    pub fn new() -> Self {
        Self {
            session: Arc::new(RwLock::new(ScreenShareSessionState::default())),
            clients: Arc::new(RwLock::new(HashMap::new())),
            client_roles: Arc::new(RwLock::new(HashMap::new())),
            host_client_id: Arc::new(RwLock::new(None)),
            input_rate_limit: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn get_state(&self) -> ScreenShareSessionState {
        self.session.read().await.clone()
    }

    pub async fn start(
        &self,
        app_handle: Option<&tauri::AppHandle>,
        request: StartScreenShareRequest,
    ) -> AppResult<ScreenShareSessionState> {
        let session_id = uuid::Uuid::new_v4().to_string();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| AppError::Internal(e.to_string()))?
            .as_millis() as u64;

        match request.source_type {
            ScreenShareSourceType::Browser => {
                let app = app_handle.ok_or_else(|| {
                    AppError::Internal("Tauri app handle unavailable".to_string())
                })?;
                self.open_browser_window(app, request.url.as_deref())
                    .await?;

                let mut session = self.session.write().await;
                session.active = true;
                session.session_id = Some(session_id);
                session.source_type = Some(ScreenShareSourceType::Browser);
                session.source_label = Some("Tauri Browser Window".to_string());
                session.started_at = Some(now);
                session.interactive = true;
                session.max_viewers = 5;
                session.current_viewers = 0;
                session.stream_ready = false;
                session.stream_message = Some(
                    "Browser window launched. WebRTC capture pipeline will attach in next step."
                        .to_string(),
                );
                let snapshot = session.clone();
                drop(session);
                self.broadcast_session_state(snapshot.clone()).await;
                self.broadcast_json(
                    serde_json::json!({
                        "type": "system",
                        "message": "Screen share browser source is ready for signaling."
                    }),
                    None,
                )
                .await;
                Ok(snapshot)
            }
            ScreenShareSourceType::Application => {
                let mut session = self.session.write().await;
                session.active = true;
                session.session_id = Some(session_id);
                session.source_type = Some(ScreenShareSourceType::Application);
                session.source_label = Some(
                    request
                        .source_label
                        .unwrap_or_else(|| "Local application".to_string()),
                );
                session.started_at = Some(now);
                session.interactive = true;
                session.max_viewers = 5;
                session.current_viewers = 0;
                session.stream_ready = false;
                session.stream_message = Some(
                    "Application source reserved. Capture picker will be connected in next step."
                        .to_string(),
                );
                let snapshot = session.clone();
                drop(session);
                self.broadcast_session_state(snapshot.clone()).await;
                self.broadcast_json(
                    serde_json::json!({
                        "type": "system",
                        "message": "Application source selected. Waiting for capture attachment."
                    }),
                    None,
                )
                .await;
                Ok(snapshot)
            }
        }
    }

    pub async fn stop(
        &self,
        app_handle: Option<&tauri::AppHandle>,
    ) -> AppResult<ScreenShareSessionState> {
        if let Some(app) = app_handle {
            if let Some(window) = app.get_webview_window(SCREEN_SHARE_BROWSER_LABEL) {
                let _ = window.close();
            }
        }

        let mut session = self.session.write().await;
        *session = ScreenShareSessionState::default();
        let snapshot = session.clone();
        drop(session);

        {
            let mut host = self.host_client_id.write().await;
            *host = None;
        }
        {
            let mut roles = self.client_roles.write().await;
            roles.clear();
        }
        {
            let mut limiter = self.input_rate_limit.write().await;
            limiter.clear();
        }

        self.broadcast_session_state(snapshot.clone()).await;
        self.broadcast_json(
            serde_json::json!({
                "type": "system",
                "message": "Screen share session stopped by host."
            }),
            None,
        )
        .await;

        Ok(snapshot)
    }

    pub async fn handle_socket(&self, socket: WebSocket) {
        let client_id = uuid::Uuid::new_v4().to_string();
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();

        {
            let mut clients = self.clients.write().await;
            clients.insert(client_id.clone(), tx);
        }

        let (mut sender, mut receiver) = socket.split();
        let writer_client_id = client_id.clone();
        let write_task = tokio::spawn(async move {
            while let Some(payload) = rx.recv().await {
                if sender.send(Message::Text(payload)).await.is_err() {
                    break;
                }
            }
        });

        let state_snapshot = self.get_state().await;
        let host_client_id = self.host_client_id.read().await.clone();
        self.send_to_client(
            &client_id,
            serde_json::json!({
                "type": "welcome",
                "clientId": client_id,
                "state": state_snapshot,
                "hostClientId": host_client_id,
            }),
        )
        .await;

        while let Some(result) = receiver.next().await {
            let Ok(message) = result else {
                break;
            };

            match message {
                Message::Text(text) => {
                    self.handle_client_message(&writer_client_id, text.to_string())
                        .await;
                }
                Message::Close(_) => break,
                _ => {}
            }
        }

        write_task.abort();
        self.unregister_client(&writer_client_id).await;
    }

    async fn handle_client_message(&self, client_id: &str, payload: String) {
        let parsed = serde_json::from_str::<ClientMessage>(&payload);
        let Ok(message) = parsed else {
            self.send_to_client(
                client_id,
                serde_json::json!({
                    "type": "error",
                    "message": "Invalid signaling payload",
                }),
            )
            .await;
            return;
        };

        match message.kind.as_str() {
            "join" => {
                let Some(role) = message.role else {
                    self.send_to_client(
                        client_id,
                        serde_json::json!({
                            "type": "error",
                            "message": "Missing role in join message",
                        }),
                    )
                    .await;
                    return;
                };

                if role == "host" {
                    let mut host = self.host_client_id.write().await;
                    if let Some(existing_host) = host.as_ref() {
                        if existing_host != client_id {
                            self.send_to_client(
                                client_id,
                                serde_json::json!({
                                    "type": "error",
                                    "message": "A host is already connected",
                                }),
                            )
                            .await;
                            return;
                        }
                    } else {
                        *host = Some(client_id.to_string());
                    }
                }

                if role == "viewer" {
                    let session = self.session.read().await;
                    let max_viewers = session.max_viewers as usize;
                    drop(session);

                    let current_viewers = {
                        let roles = self.client_roles.read().await;
                        roles.values().filter(|r| r.as_str() == "viewer").count()
                    };

                    if current_viewers >= max_viewers {
                        self.send_to_client(
                            client_id,
                            serde_json::json!({
                                "type": "error",
                                "message": "Viewer limit reached for this session",
                            }),
                        )
                        .await;
                        return;
                    }
                }

                {
                    let mut roles = self.client_roles.write().await;
                    roles.insert(client_id.to_string(), role.clone());
                }

                let peers = {
                    let roles = self.client_roles.read().await;
                    roles
                        .iter()
                        .filter(|(id, _)| id.as_str() != client_id)
                        .map(|(id, role)| {
                            serde_json::json!({
                                "clientId": id,
                                "role": role,
                            })
                        })
                        .collect::<Vec<_>>()
                };

                self.send_to_client(
                    client_id,
                    serde_json::json!({
                        "type": "peers",
                        "peers": peers,
                    }),
                )
                .await;

                self.recompute_viewers().await;
                self.broadcast_json(
                    serde_json::json!({
                        "type": "peer-joined",
                        "clientId": client_id,
                        "role": role,
                    }),
                    Some(client_id),
                )
                .await;
                self.send_to_client(
                    client_id,
                    serde_json::json!({
                        "type": "joined",
                        "clientId": client_id,
                    }),
                )
                .await;
            }
            "signal" => {
                let target = message.target;
                let payload = serde_json::json!({
                    "type": "signal",
                    "from": client_id,
                    "target": target,
                    "payload": message.payload.unwrap_or(Value::Null),
                });

                if let Some(target_client_id) = target {
                    self.send_to_client(&target_client_id, payload).await;
                } else {
                    self.broadcast_json(payload, Some(client_id)).await;
                }
            }
            "input" => {
                let role = {
                    let roles = self.client_roles.read().await;
                    roles.get(client_id).cloned()
                };

                if role.as_deref() != Some("viewer") {
                    self.send_to_client(
                        client_id,
                        serde_json::json!({
                            "type": "error",
                            "message": "Only viewers can send remote inputs",
                        }),
                    )
                    .await;
                    return;
                }

                let is_session_active = self.session.read().await.active;
                if !is_session_active {
                    return;
                }

                let host_connected = self.host_client_id.read().await.is_some();
                if !host_connected {
                    self.send_to_client(
                        client_id,
                        serde_json::json!({
                            "type": "error",
                            "message": "Input blocked: no active host controller",
                        }),
                    )
                    .await;
                    return;
                }

                let Some(raw_payload) = message.payload else {
                    return;
                };

                let parsed = serde_json::from_value::<RemoteInputPayload>(raw_payload);
                let Ok(input_payload) = parsed else {
                    self.send_to_client(
                        client_id,
                        serde_json::json!({
                            "type": "error",
                            "message": "Invalid input payload",
                        }),
                    )
                    .await;
                    return;
                };

                if input_payload.kind == "pointer"
                    && input_payload.action.as_deref() == Some("move")
                    && !self.allow_input_tick(client_id, 8).await
                {
                    return;
                }

                match self.inject_remote_input(&input_payload).await {
                    Ok(_) => {}
                    Err(err) => {
                        self.send_to_client(
                            client_id,
                            serde_json::json!({
                                "type": "error",
                                "message": err.to_string(),
                            }),
                        )
                        .await;
                    }
                }
            }
            "ping" => {
                self.send_to_client(
                    client_id,
                    serde_json::json!({
                        "type": "pong",
                        "ts": SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64,
                    }),
                )
                .await;
            }
            _ => {
                self.send_to_client(
                    client_id,
                    serde_json::json!({
                        "type": "error",
                        "message": "Unknown signaling message type",
                    }),
                )
                .await;
            }
        }
    }

    async fn unregister_client(&self, client_id: &str) {
        {
            let mut clients = self.clients.write().await;
            clients.remove(client_id);
        }

        let removed_role = {
            let mut roles = self.client_roles.write().await;
            roles.remove(client_id)
        };

        {
            let mut host = self.host_client_id.write().await;
            if host.as_deref() == Some(client_id) {
                *host = None;
            }
        }
        {
            let mut limiter = self.input_rate_limit.write().await;
            limiter.remove(client_id);
        }

        self.recompute_viewers().await;

        if let Some(role) = removed_role {
            self.broadcast_json(
                serde_json::json!({
                    "type": "peer-left",
                    "clientId": client_id,
                    "role": role,
                }),
                None,
            )
            .await;
        }
    }

    async fn recompute_viewers(&self) {
        let roles = self.client_roles.read().await;
        let mut unique_viewers = HashSet::new();
        for (client_id, role) in roles.iter() {
            if role == "viewer" {
                unique_viewers.insert(client_id.clone());
            }
        }
        drop(roles);

        let mut session = self.session.write().await;
        session.current_viewers = unique_viewers.len().min(u8::MAX as usize) as u8;
        let snapshot = session.clone();
        drop(session);
        self.broadcast_session_state(snapshot).await;
    }

    async fn broadcast_session_state(&self, state: ScreenShareSessionState) {
        self.broadcast_json(
            serde_json::json!({
                "type": "session-state",
                "state": state,
            }),
            None,
        )
        .await;
    }

    async fn send_to_client(&self, client_id: &str, payload: Value) {
        let serialized = payload.to_string();
        let sender = {
            let clients = self.clients.read().await;
            clients.get(client_id).cloned()
        };

        if let Some(tx) = sender {
            let _ = tx.send(serialized);
        }
    }

    async fn broadcast_json(&self, payload: Value, skip_client_id: Option<&str>) {
        let serialized = payload.to_string();
        let targets = {
            let clients = self.clients.read().await;
            clients
                .iter()
                .filter_map(|(client_id, tx)| {
                    if skip_client_id == Some(client_id.as_str()) {
                        None
                    } else {
                        Some((client_id.clone(), tx.clone()))
                    }
                })
                .collect::<Vec<_>>()
        };

        let mut disconnected = Vec::new();
        for (client_id, tx) in targets {
            if tx.send(serialized.clone()).is_err() {
                disconnected.push(client_id);
            }
        }

        if disconnected.is_empty() {
            return;
        }

        {
            let mut clients = self.clients.write().await;
            for client_id in &disconnected {
                clients.remove(client_id);
            }
        }
        {
            let mut roles = self.client_roles.write().await;
            for client_id in &disconnected {
                roles.remove(client_id);
            }
        }
    }

    async fn open_browser_window(
        &self,
        app_handle: &tauri::AppHandle,
        requested_url: Option<&str>,
    ) -> AppResult<()> {
        if let Some(existing) = app_handle.get_webview_window(SCREEN_SHARE_BROWSER_LABEL) {
            let _ = existing.close();
        }

        let raw = requested_url
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(DEFAULT_BROWSER_URL);

        let parsed = raw.parse().map_err(|e| {
            AppError::Internal(format!("Invalid browser URL for screen share: {e}"))
        })?;

        WebviewWindowBuilder::new(
            app_handle,
            SCREEN_SHARE_BROWSER_LABEL,
            WebviewUrl::External(parsed),
        )
        .title("NoSubVOD - Screen Share Browser")
        .inner_size(1280.0, 720.0)
        .resizable(true)
        .build()
        .map_err(|e| {
            AppError::Internal(format!("Unable to create screen share browser window: {e}"))
        })?;

        Ok(())
    }

    async fn allow_input_tick(&self, client_id: &str, min_delta_ms: u64) -> bool {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let mut map = self.input_rate_limit.write().await;
        if let Some(last) = map.get(client_id) {
            if now.saturating_sub(*last) < min_delta_ms {
                return false;
            }
        }
        map.insert(client_id.to_string(), now);
        true
    }

    async fn inject_remote_input(&self, payload: &RemoteInputPayload) -> AppResult<()> {
        #[cfg(not(target_os = "windows"))]
        {
            let _ = payload;
            Err(AppError::BadRequest(
                "Remote input injection is supported on Windows only".to_string(),
            ))
        }

        #[cfg(target_os = "windows")]
        {
            inject_remote_input_windows(payload)
        }
    }
}

impl Default for ScreenShareService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(target_os = "windows")]
fn window_title_utf16(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn get_target_window() -> AppResult<HWND> {
    let title = window_title_utf16("NoSubVOD - Screen Share Browser");
    let hwnd = unsafe { FindWindowW(None, PCWSTR(title.as_ptr())) }
        .map_err(|_| AppError::NotFound("Screen share browser window was not found".to_string()))?;
    if hwnd.0.is_null() {
        return Err(AppError::NotFound(
            "Screen share browser window was not found".to_string(),
        ));
    }

    let foreground = unsafe { GetForegroundWindow() };
    if foreground != hwnd {
        return Err(AppError::BadRequest(
            "Input blocked: target browser window must be focused".to_string(),
        ));
    }

    Ok(hwnd)
}

#[cfg(target_os = "windows")]
fn window_rect(hwnd: HWND) -> AppResult<RECT> {
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect) }
        .map_err(|_| AppError::Internal("Unable to read target window geometry".to_string()))?;
    Ok(rect)
}

#[cfg(target_os = "windows")]
fn emit_mouse(flags: MOUSE_EVENT_FLAGS, data: i32) -> AppResult<()> {
    let input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: 0,
                dy: 0,
                mouseData: data as u32,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    let sent = unsafe { SendInput(&[input], std::mem::size_of::<INPUT>() as i32) };
    if sent == 0 {
        return Err(AppError::Internal(
            "SendInput mouse injection failed".to_string(),
        ));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn emit_key(vk: u16, key_up: bool) -> AppResult<()> {
    let input = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(vk),
                wScan: 0,
                dwFlags: if key_up {
                    KEYEVENTF_KEYUP
                } else {
                    Default::default()
                },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    let sent = unsafe { SendInput(&[input], std::mem::size_of::<INPUT>() as i32) };
    if sent == 0 {
        return Err(AppError::Internal(
            "SendInput keyboard injection failed".to_string(),
        ));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn map_key_to_vk(key: &str) -> Option<u16> {
    let normalized = key.trim();
    if normalized.len() == 1 {
        let c = normalized.chars().next()?.to_ascii_uppercase();
        if c.is_ascii_alphabetic() {
            return Some(c as u16);
        }
        if c.is_ascii_digit() {
            return Some(c as u16);
        }
    }

    match normalized {
        "Enter" => Some(0x0D),
        "Escape" => Some(0x1B),
        "Backspace" => Some(0x08),
        "Tab" => Some(0x09),
        " " | "Space" => Some(0x20),
        "ArrowLeft" => Some(0x25),
        "ArrowUp" => Some(0x26),
        "ArrowRight" => Some(0x27),
        "ArrowDown" => Some(0x28),
        "Shift" => Some(0x10),
        "Control" => Some(0x11),
        "Alt" => Some(0x12),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn inject_remote_input_windows(payload: &RemoteInputPayload) -> AppResult<()> {
    let hwnd = get_target_window()?;
    let rect = window_rect(hwnd)?;
    let width = (rect.right - rect.left).max(1) as f64;
    let height = (rect.bottom - rect.top).max(1) as f64;

    match payload.kind.as_str() {
        "pointer" => {
            let action = payload.action.as_deref().unwrap_or("move");
            let x = payload.x.unwrap_or(0.5).clamp(0.0, 1.0);
            let y = payload.y.unwrap_or(0.5).clamp(0.0, 1.0);

            let abs_x = rect.left + (x * width).round() as i32;
            let abs_y = rect.top + (y * height).round() as i32;
            let _ = unsafe { SetCursorPos(abs_x, abs_y) };

            match action {
                "move" => Ok(()),
                "down" => {
                    let flags = match payload.button.as_deref().unwrap_or("left") {
                        "right" => MOUSEEVENTF_RIGHTDOWN,
                        "middle" => MOUSEEVENTF_MIDDLEDOWN,
                        _ => MOUSEEVENTF_LEFTDOWN,
                    };
                    emit_mouse(flags, 0)
                }
                "up" => {
                    let flags = match payload.button.as_deref().unwrap_or("left") {
                        "right" => MOUSEEVENTF_RIGHTUP,
                        "middle" => MOUSEEVENTF_MIDDLEUP,
                        _ => MOUSEEVENTF_LEFTUP,
                    };
                    emit_mouse(flags, 0)
                }
                "wheel" => {
                    let delta = payload.delta_y.unwrap_or(0.0).round() as i32;
                    emit_mouse(MOUSEEVENTF_WHEEL, delta)
                }
                _ => Err(AppError::BadRequest(
                    "Unsupported pointer action".to_string(),
                )),
            }
        }
        "keyboard" => {
            let action = payload.action.as_deref().unwrap_or("down");
            let Some(key) = payload.key.as_deref() else {
                return Err(AppError::BadRequest(
                    "Keyboard input missing key".to_string(),
                ));
            };
            let Some(vk) = map_key_to_vk(key) else {
                return Err(AppError::BadRequest("Unsupported keyboard key".to_string()));
            };

            match action {
                "down" => emit_key(vk, false),
                "up" => emit_key(vk, true),
                _ => Err(AppError::BadRequest(
                    "Unsupported keyboard action".to_string(),
                )),
            }
        }
        _ => Err(AppError::BadRequest("Unsupported input kind".to_string())),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientMessage {
    #[serde(rename = "type")]
    kind: String,
    role: Option<String>,
    target: Option<String>,
    payload: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
struct RemoteInputPayload {
    kind: String,
    action: Option<String>,
    x: Option<f64>,
    y: Option<f64>,
    button: Option<String>,
    key: Option<String>,
    delta_y: Option<f64>,
}
