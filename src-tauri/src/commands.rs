use std::sync::Arc;

use tauri::State;
#[cfg(target_os = "windows")]
use tokio::process::Command;

use crate::server::download_paths::{
    build_master_m3u8_url, build_output_file_path, resolve_download_output_dir,
};
use crate::server::screenshare::{
    ScreenShareSessionState, ScreenShareSourceType, StartScreenShareRequest,
};
use crate::server::{types::ServerInfo, AppState};

const DOWNLOAD_STARTED_MESSAGE: &str = "Download started in background";

struct FfmpegDownloadJob {
    master_m3u8_url: String,
    output_file: String,
    start_time: Option<f64>,
    end_time: Option<f64>,
}

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
    let out_dir = resolve_download_output_dir(settings.download_local_path);

    let job = FfmpegDownloadJob {
        master_m3u8_url: build_master_m3u8_url(state.server_info.port, &vod_id),
        output_file: build_output_file_path(&out_dir, &vod_id, &quality, "mp4"),
        start_time,
        end_time,
    };

    tauri::async_runtime::spawn(spawn_ffmpeg_download(job));

    Ok(DOWNLOAD_STARTED_MESSAGE.to_string())
}

#[tauri::command]
pub async fn start_screen_share(
    source_type: String,
    source_label: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<ScreenShareSessionState, String> {
    let parsed_source = parse_screen_share_source_type(&source_type)?;

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
        .map_err(|e| e.to_string())
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
        .map_err(|e| e.to_string())
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

fn clip_duration(start_time: Option<f64>, end_time: Option<f64>) -> Option<f64> {
    match (start_time, end_time) {
        (Some(start), Some(end)) if end > start => Some(end - start),
        _ => None,
    }
}

async fn spawn_ffmpeg_download(job: FfmpegDownloadJob) {
    let mut cmd = tokio::process::Command::new("ffmpeg");

    if let Some(start_time) = job.start_time {
        cmd.arg("-ss").arg(start_time.to_string());
    }

    cmd.arg("-i").arg(&job.master_m3u8_url);

    if let Some(duration) = clip_duration(job.start_time, job.end_time) {
        cmd.arg("-t").arg(duration.to_string());
    }

    cmd.arg("-c")
        .arg("copy")
        .arg("-bsf:a")
        .arg("aac_adtstoasc")
        .arg("-y")
        .arg(&job.output_file);

    match cmd.spawn() {
        Ok(mut child) => {
            let _ = child.wait().await;
        }
        Err(error) => {
            eprintln!("Failed to spawn ffmpeg: {error}");
        }
    }
}

fn parse_screen_share_source_type(source_type: &str) -> Result<ScreenShareSourceType, String> {
    match source_type.trim().to_lowercase().as_str() {
        "browser" => Ok(ScreenShareSourceType::Browser),
        "application" => Ok(ScreenShareSourceType::Application),
        _ => Err("Unsupported source type".to_string()),
    }
}
