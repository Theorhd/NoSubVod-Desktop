#[cfg(not(test))]
mod commands;

#[cfg(not(test))]
pub mod server;

#[cfg(test)]
pub mod server {
    pub mod download_paths;
    pub mod error;
    pub mod http_utils;
    pub mod url_utils;
}

#[cfg(not(test))]
use std::sync::Arc;
#[cfg(not(test))]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    Manager,
};
#[cfg(not(test))]
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[cfg(not(test))]
use server::AppState;

#[cfg(not(test))]
fn init_tracing() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "nosubvod_desktop_lib=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();
}

#[cfg(not(test))]
fn init_rustls_crypto_provider() {
    // rustls 0.23 may require explicit provider installation when both
    // providers are enabled through the dependency graph.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let _ = rustls::crypto::ring::default_provider().install_default();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(not(test))]
pub fn run() {
    // Load .env from the directory next to the binary (src-tauri/ in dev)
    dotenvy::dotenv().ok();
    init_tracing();
    init_rustls_crypto_provider();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            // ── Tray icon ──────────────────────────────────────────────────
            let show_item = MenuItem::with_id(app, "show", "Show App", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit NoSubVOD", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("No window icon"))
                .menu(&menu)
                .tooltip("NoSubVOD")
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::DoubleClick { .. } = event {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // ── Intercept close → minimize to tray ─────────────────────────
            if let Some(win) = app.get_webview_window("main") {
                let win_clone = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win_clone.hide();
                    }
                });
            }

            // ── Start Axum HTTP server ─────────────────────────────────────
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| tauri::Error::from(std::io::Error::other(e.to_string())))?;

            // Initialize state synchronously (history loaded with std::fs)
            let state = Arc::new(
                AppState::new(app_data_dir)
                    .map_err(|e| tauri::Error::from(std::io::Error::other(e.to_string())))?,
            );
            app.manage(state.clone());

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                server::start_server(state, app_handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_server_info,
            commands::start_download,
            commands::start_screen_share,
            commands::stop_screen_share,
            commands::get_screen_share_state,
            commands::list_stream_windows
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
pub fn run() {}
