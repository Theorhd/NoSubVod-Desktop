pub mod history;
pub mod routes;
pub mod twitch;
pub mod types;

use std::path::PathBuf;
use std::sync::Arc;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use image::ImageEncoder;
use qrcode::QrCode;
use tauri::AppHandle;
#[cfg(not(debug_assertions))]
use tauri::Manager;
use tokio::net::TcpListener;

use history::HistoryStore;
use routes::{build_router, ApiState};
use twitch::TwitchService;
use types::ServerInfo;

pub const SERVER_PORT: u16 = 23455;

pub struct AppState {
    pub server_info: ServerInfo,
    pub api_state: ApiState,
}

impl AppState {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let history = Arc::new(HistoryStore::load(app_data_dir));
        let twitch = Arc::new(TwitchService::new());

        let ip = get_local_ipv4();
        let port = SERVER_PORT;
        // In dev mode the portal is served by Vite (port 5173) which proxies
        // /api calls to Axum. In release, Axum serves the portal directly.
        #[cfg(debug_assertions)]
        let portal_port = 5173u16;
        #[cfg(not(debug_assertions))]
        let portal_port = port;
        let url = format!("http://{ip}:{portal_port}");
        let qrcode = generate_qr_data_url(&url);

        let server_info = ServerInfo {
            ip,
            port,
            url,
            qrcode,
        };

        let api_state = ApiState { twitch, history };

        Self {
            server_info,
            api_state,
        }
    }
}

fn get_local_ipv4() -> String {
    local_ip_address::local_ip()
        .ok()
        .and_then(|ip| match ip {
            std::net::IpAddr::V4(v4) => Some(v4.to_string()),
            _ => None,
        })
        .unwrap_or_else(|| "127.0.0.1".to_string())
}

fn generate_qr_data_url(data: &str) -> String {
    let Ok(code) = QrCode::new(data.as_bytes()) else {
        return String::new();
    };

    let image = code
        .render::<image::Luma<u8>>()
        .quiet_zone(true)
        .max_dimensions(400, 400)
        .build();

    let mut buffer: Vec<u8> = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut buffer);
    if encoder
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::L8,
        )
        .is_err()
    {
        return String::new();
    }

    format!("data:image/png;base64,{}", B64.encode(&buffer))
}

pub async fn start_server(state: Arc<AppState>, app: AppHandle) {
    // Resolve portal dist directory in release (bundled resources first).
    let portal_dist = resolve_portal_dist(&app);

    let router = build_router(state.api_state.clone(), portal_dist.clone());
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], SERVER_PORT));

    match TcpListener::bind(addr).await {
        Ok(listener) => {
            eprintln!("[NoSubVOD] HTTP server listening on {addr}");
            #[cfg(not(debug_assertions))]
            match &portal_dist {
                Some(path) => eprintln!("[NoSubVOD] Serving portal from {}", path.display()),
                None => eprintln!("[NoSubVOD] Portal static files not found in bundle resources"),
            }
            if let Err(e) = axum::serve(listener, router).await {
                eprintln!("[NoSubVOD] Server error: {e}");
            }
        }
        Err(e) => {
            eprintln!("[NoSubVOD] Failed to bind port {SERVER_PORT}: {e}");
        }
    }
}

fn resolve_portal_dist(_app: &AppHandle) -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    {
        None
    }
    #[cfg(not(debug_assertions))]
    {
        let mut candidates: Vec<PathBuf> = Vec::new();

        if let Ok(resource_dir) = _app.path().resource_dir() {
            candidates.push(resource_dir.join("portal"));
            candidates.push(resource_dir.join("dist").join("portal"));
            candidates.push(resource_dir.join("_up_").join("portal"));
            candidates.push(resource_dir.join("_up_").join("dist").join("portal"));
        }

        if let Ok(exe) = std::env::current_exe() {
            if let Some(exe_dir) = exe.parent() {
                candidates.push(exe_dir.join("portal"));
                candidates.push(exe_dir.join("resources").join("portal"));
                candidates.push(exe_dir.join("resources").join("dist").join("portal"));
                candidates.push(exe_dir.join("_up_").join("portal"));
                candidates.push(exe_dir.join("_up_").join("dist").join("portal"));
            }
        }

        candidates
            .into_iter()
            .find(|path| path.join("index.html").exists())
    }
}
