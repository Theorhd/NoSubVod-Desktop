use std::sync::Arc;
use tauri::State;
#[cfg(target_os = "windows")]
use tokio::process::Command;

use crate::server::{AppState, types::ServerInfo};
use crate::server::screenshare::{
    ScreenShareSessionState, ScreenShareSourceType, StartScreenShareRequest,
};

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

#[tauri::command]
pub async fn start_screen_share(
    source_type: String,
    source_label: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<ScreenShareSessionState, String> {
    let parsed_source = match source_type.trim().to_lowercase().as_str() {
        "browser" => ScreenShareSourceType::Browser,
        "application" => ScreenShareSourceType::Application,
        _ => return Err("Unsupported source type".to_string()),
    };

    let request = StartScreenShareRequest {
        source_type: parsed_source,
        url: None,
        source_label,
    };

    state
        .api_state
        .screenshare
        .start(Some(&app_handle), request)
        .await
}

#[tauri::command]
pub async fn stop_screen_share(
    app_handle: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<ScreenShareSessionState, String> {
    state
        .api_state
        .screenshare
        .stop(Some(&app_handle))
        .await
}

#[tauri::command]
pub async fn get_screen_share_state(
    state: State<'_, Arc<AppState>>,
) -> Result<ScreenShareSessionState, String> {
    Ok(state.api_state.screenshare.get_state().await)
}

#[tauri::command]
pub async fn list_stream_windows() -> Result<Vec<String>, String> {
    #[cfg(not(target_os = "windows"))]
    {
        Err("Window selection is currently supported on Windows only".to_string())
    }

    #[cfg(target_os = "windows")]
    {
        let output = Command::new("ffmpeg")
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("info")
            .arg("-f")
            .arg("gdigrab")
            .arg("-list_windows")
            .arg("true")
            .arg("-i")
            .arg("desktop")
            .output()
            .await
            .map_err(|e| format!("Failed to execute ffmpeg window listing: {e}"))?;

        let text = format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );

        let mut titles = std::collections::BTreeSet::new();
        for line in text.lines() {
            let trimmed = line.trim();
            if let Some((_, right)) = trimmed.split_once("title=") {
                let title = right.trim().trim_matches('"').trim();
                if !title.is_empty() {
                    titles.insert(title.to_string());
                }
            }
        }

        if titles.is_empty() {
            return Err("No capturable windows found. Open the app window first.".to_string());
        }

        Ok(titles.into_iter().collect())
    }
}
