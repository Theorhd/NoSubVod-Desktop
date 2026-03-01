use std::sync::Arc;
use tauri::State;

use crate::server::{AppState, types::ServerInfo};

/// Returns current server info (IP, port, URL, QR code) to the renderer.
#[tauri::command]
pub async fn get_server_info(state: State<'_, Arc<AppState>>) -> Result<ServerInfo, String> {
    Ok(state.server_info.clone())
}
