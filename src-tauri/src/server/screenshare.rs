use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use std::collections::HashMap;

use ax_ws::{Message, WebSocket};
use axum::extract::ws as ax_ws;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::{broadcast, mpsc, RwLock};

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

// ── Consolidated Internal State ──────────────────────────────────────────────

struct ScreenShareClient {
    role: String,
    /// Targeted sender for this specific client (signaling)
    sender: mpsc::UnboundedSender<Arc<str>>,
}

struct SessionInternal {
    state: ScreenShareSessionState,
    clients: HashMap<String, ScreenShareClient>,
    host_client_id: Option<String>,
    input_rate_limit: HashMap<String, u64>,
}

#[derive(Clone)]
pub struct ScreenShareService {
    internal: Arc<RwLock<SessionInternal>>,
    /// Global broadcast channel for system events and state updates
    broadcast_tx: broadcast::Sender<Arc<str>>,
}

use super::error::{AppError, AppResult};

impl ScreenShareService {
    pub fn new() -> Self {
        let (broadcast_tx, _) = broadcast::channel(32);
        Self {
            internal: Arc::new(RwLock::new(SessionInternal {
                state: ScreenShareSessionState::default(),
                clients: HashMap::new(),
                host_client_id: None,
                input_rate_limit: HashMap::new(),
            })),
            broadcast_tx,
        }
    }

    pub async fn get_state(&self) -> ScreenShareSessionState {
        self.internal.read().await.state.clone()
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

        let mut internal = self.internal.write().await;
        
        match request.source_type {
            ScreenShareSourceType::Browser => {
                let app = app_handle.ok_or_else(|| {
                    AppError::Internal("Tauri app handle unavailable".to_string())
                })?;
                self.open_browser_window(app, request.url.as_deref())
                    .await?;

                internal.state.active = true;
                internal.state.session_id = Some(session_id);
                internal.state.source_type = Some(ScreenShareSourceType::Browser);
                internal.state.source_label = Some("Tauri Browser Window".to_string());
                internal.state.started_at = Some(now);
                internal.state.interactive = true;
                internal.state.max_viewers = 5;
                internal.state.current_viewers = 0;
                internal.state.stream_ready = false;
                internal.state.stream_message = Some(
                    "Browser window launched. WebRTC capture pipeline will attach in next step."
                        .to_string(),
                );
            }
            ScreenShareSourceType::Application => {
                internal.state.active = true;
                internal.state.session_id = Some(session_id);
                internal.state.source_type = Some(ScreenShareSourceType::Application);
                internal.state.source_label = Some(
                    request
                        .source_label
                        .unwrap_or_else(|| "Local application".to_string()),
                );
                internal.state.started_at = Some(now);
                internal.state.interactive = true;
                internal.state.max_viewers = 5;
                internal.state.current_viewers = 0;
                internal.state.stream_ready = false;
                internal.state.stream_message = Some(
                    "Application source reserved. Capture picker will be connected in next step."
                        .to_string(),
                );
            }
        }

        let snapshot = internal.state.clone();
        drop(internal);

        self.broadcast_state(&snapshot).await;
        self.broadcast_system_message("Screen share source is ready for signaling.").await;
        
        Ok(snapshot)
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

        let mut internal = self.internal.write().await;
        internal.state = ScreenShareSessionState::default();
        internal.host_client_id = None;
        internal.input_rate_limit.clear();
        // We keep clients connected but they will see session is inactive
        
        let snapshot = internal.state.clone();
        drop(internal);

        self.broadcast_state(&snapshot).await;
        self.broadcast_system_message("Screen share session stopped by host.").await;

        Ok(snapshot)
    }

    pub async fn handle_socket(&self, socket: WebSocket) {
        let client_id = uuid::Uuid::new_v4().to_string();
        let (tx, mut rx) = mpsc::unbounded_channel::<Arc<str>>();
        let mut broadcast_rx = self.broadcast_tx.subscribe();

        {
            let mut internal = self.internal.write().await;
            internal.clients.insert(client_id.clone(), ScreenShareClient {
                role: "pending".to_string(),
                sender: tx,
            });
        }

        let (mut ws_sender, mut ws_receiver) = socket.split();
        let writer_client_id = client_id.clone();

        // Send welcome message before moving ws_sender
        let initial_data = {
            let internal = self.internal.read().await;
            serde_json::json!({
                "type": "welcome",
                "clientId": client_id,
                "state": internal.state,
                "hostClientId": internal.host_client_id,
            }).to_string()
        };
        let _ = ws_sender.send(Message::Text(initial_data)).await;

        // Combined write task: handles both targeted signaling and global broadcasts
        let write_task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    // Global broadcast (state updates, system messages)
                    Ok(payload) = broadcast_rx.recv() => {
                        if ws_sender.send(Message::Text(payload.to_string())).await.is_err() {
                            break;
                        }
                    }
                    // Targeted signaling
                    Some(payload) = rx.recv() => {
                        if ws_sender.send(Message::Text(payload.to_string())).await.is_err() {
                            break;
                        }
                    }
                    else => break,
                }
            }
        });

        while let Some(result) = ws_receiver.next().await {
            let Ok(message) = result else { break; };
            if let Message::Text(text) = message {
                self.handle_client_message(&writer_client_id, text.to_string()).await;
            } else if let Message::Close(_) = message {
                break;
            }
        }

        write_task.abort();
        self.unregister_client(&writer_client_id).await;
    }

    async fn handle_client_message(&self, client_id: &str, payload: String) {
        let Ok(message) = serde_json::from_str::<ClientMessage>(&payload) else {
            self.send_error(client_id, "Invalid signaling payload").await;
            return;
        };

        match message.kind.as_str() {
            "join" => self.handle_join(client_id, message).await,
            "signal" => self.handle_signal(client_id, message).await,
            "input" => self.handle_input(client_id, message).await,
            "ping" => self.handle_ping(client_id).await,
            _ => self.send_error(client_id, "Unknown signaling message type").await,
        }
    }

    async fn handle_join(&self, client_id: &str, message: ClientMessage) {
        let Some(role) = message.role else {
            self.send_error(client_id, "Missing role in join message").await;
            return;
        };

        let mut internal = self.internal.write().await;
        
        if role == "host" {
            if let Some(existing_host) = internal.host_client_id.as_ref() {
                if existing_host != client_id {
                    drop(internal);
                    self.send_error(client_id, "A host is already connected").await;
                    return;
                }
            } else {
                internal.host_client_id = Some(client_id.to_string());
            }
        } else if role == "viewer" {
            let current_viewers = internal.clients.values().filter(|c| c.role == "viewer").count();
            if current_viewers >= internal.state.max_viewers as usize {
                drop(internal);
                self.send_error(client_id, "Viewer limit reached for this session").await;
                return;
            }
        }

        if let Some(client) = internal.clients.get_mut(client_id) {
            client.role = role.clone();
        }

        let peers: Vec<_> = internal.clients.iter()
            .filter(|(id, _)| id.as_str() != client_id)
            .map(|(id, c)| serde_json::json!({ "clientId": id, "role": c.role }))
            .collect();

        // Update current viewers in state
        let viewer_count = internal.clients.values().filter(|c| c.role == "viewer").count();
        internal.state.current_viewers = viewer_count as u8;
        let state_snapshot = internal.state.clone();

        // 1. Send peer list to new client
        let peers_msg: Arc<str> = serde_json::json!({ "type": "peers", "peers": peers }).to_string().into();
        if let Some(c) = internal.clients.get(client_id) {
            let _ = c.sender.send(peers_msg);
        }

        // 2. Notify others and broadcast updated state
        let joined_msg: Arc<str> = serde_json::json!({
            "type": "peer-joined",
            "clientId": client_id,
            "role": role
        }).to_string().into();
        
        drop(internal);

        let _ = self.broadcast_tx.send(joined_msg);
        self.broadcast_state(&state_snapshot).await;
        
        self.send_json(client_id, serde_json::json!({ "type": "joined", "clientId": client_id })).await;
    }

    async fn handle_signal(&self, client_id: &str, message: ClientMessage) {
        let target = message.target;
        let payload: Arc<str> = serde_json::json!({
            "type": "signal",
            "from": client_id,
            "target": target,
            "payload": message.payload.unwrap_or(Value::Null),
        }).to_string().into();

        let internal = self.internal.read().await;
        if let Some(target_id) = target {
            if let Some(client) = internal.clients.get(&target_id) {
                let _ = client.sender.send(payload);
            }
        } else {
            // Signal broadcast (rare, but supported)
            let _ = self.broadcast_tx.send(payload);
        }
    }

    async fn handle_input(&self, client_id: &str, message: ClientMessage) {
        let internal = self.internal.read().await;
        let Some(client) = internal.clients.get(client_id) else { return; };
        
        if client.role != "viewer" {
            drop(internal);
            self.send_error(client_id, "Only viewers can send remote inputs").await;
            return;
        }

        if !internal.state.active || internal.host_client_id.is_none() {
            return;
        }
        drop(internal);

        let Some(raw_payload) = message.payload else { return; };
        let Ok(input_payload) = serde_json::from_value::<RemoteInputPayload>(raw_payload) else {
            self.send_error(client_id, "Invalid input payload").await;
            return;
        };

        if input_payload.kind == "pointer" && input_payload.action.as_deref() == Some("move") {
            if !self.allow_input_tick(client_id, 8).await { return; }
        }

        if let Err(err) = self.inject_remote_input(&input_payload).await {
            self.send_error(client_id, &err.to_string()).await;
        }
    }

    async fn handle_ping(&self, client_id: &str) {
        let ts = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
        self.send_json(client_id, serde_json::json!({ "type": "pong", "ts": ts })).await;
    }

    async fn unregister_client(&self, client_id: &str) {
        let mut internal = self.internal.write().await;
        let removed = internal.clients.remove(client_id);
        if internal.host_client_id.as_deref() == Some(client_id) {
            internal.host_client_id = None;
        }
        internal.input_rate_limit.remove(client_id);

        let viewer_count = internal.clients.values().filter(|c| c.role == "viewer").count();
        internal.state.current_viewers = viewer_count as u8;
        let state_snapshot = internal.state.clone();
        drop(internal);

        self.broadcast_state(&state_snapshot).await;

        if let Some(client) = removed {
            let left_msg: Arc<str> = serde_json::json!({
                "type": "peer-left",
                "clientId": client_id,
                "role": client.role,
            }).to_string().into();
            let _ = self.broadcast_tx.send(left_msg);
        }
    }

    async fn broadcast_state(&self, state: &ScreenShareSessionState) {
        let msg: Arc<str> = serde_json::json!({ "type": "session-state", "state": state }).to_string().into();
        let _ = self.broadcast_tx.send(msg);
    }

    async fn broadcast_system_message(&self, message: &str) {
        let msg: Arc<str> = serde_json::json!({ "type": "system", "message": message }).to_string().into();
        let _ = self.broadcast_tx.send(msg);
    }

    async fn send_json(&self, client_id: &str, payload: Value) {
        let msg: Arc<str> = payload.to_string().into();
        let internal = self.internal.read().await;
        if let Some(client) = internal.clients.get(client_id) {
            let _ = client.sender.send(msg);
        }
    }

    async fn send_error(&self, client_id: &str, message: &str) {
        self.send_json(client_id, serde_json::json!({ "type": "error", "message": message })).await;
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

        let mut internal = self.internal.write().await;
        if let Some(last) = internal.input_rate_limit.get(client_id) {
            if now.saturating_sub(*last) < min_delta_ms {
                return false;
            }
        }
        internal.input_rate_limit.insert(client_id.to_string(), now);
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
