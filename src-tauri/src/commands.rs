use std::sync::Arc;
use tauri::State;

use crate::server::{AppState, types::ServerInfo};

/// Returns current server info (IP, port, URL, QR code) to the renderer.
#[tauri::command]
pub async fn get_server_info(state: State<'_, Arc<AppState>>) -> Result<ServerInfo, String> {
    Ok(state.server_info.clone())
}

#[tauri::command]
pub async fn start_download(
    vod_id: String,
    quality: String,
    start_time: Option<f64>,
    end_time: Option<f64>,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let settings = state.api_state.history.get_settings().await;
    let out_dir = settings.download_local_path.unwrap_or_else(|| {
        dirs::download_dir()
            .map(|p: std::path::PathBuf| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string())
    });

    let master_m3u8_url = format!("http://127.0.0.1:{}/api/vod/{}/master.m3u8", state.server_info.port, vod_id);
    let output_file = format!("{}/{}_{}.mp4", out_dir, vod_id, quality);

    // Run ffmpeg in background
    tauri::async_runtime::spawn(async move {
        let mut cmd = tokio::process::Command::new("ffmpeg");
        
        if let Some(st) = start_time {
            cmd.arg("-ss").arg(st.to_string());
        }
        
        cmd.arg("-i").arg(&master_m3u8_url);
        
        if let Some(et) = end_time {
            if let Some(st) = start_time {
                let duration = et - st;
                if duration > 0.0 {
                    cmd.arg("-t").arg(duration.to_string());
                }
            }
        }
        
        cmd.arg("-c").arg("copy")
           .arg("-bsf:a").arg("aac_adtstoasc")
           .arg("-y")
           .arg(&output_file);
           
        match cmd.spawn() {
            Ok(mut child) => {
                let _ = child.wait().await;
            }
            Err(e) => {
                eprintln!("Failed to spawn ffmpeg: {}", e);
            }
        }
    });

    Ok("Download started in background".to_string())
}
