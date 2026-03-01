mod commands;
pub mod server;

use std::sync::Arc;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    Manager,
};

use server::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // ── Tray icon ──────────────────────────────────────────────────
            let show_item = MenuItem::with_id(app, "show", "Show App", true, None::<&str>)?;
            let quit_item =
                MenuItem::with_id(app, "quit", "Quit NoSubVOD", true, None::<&str>)?;
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
                .expect("Failed to resolve app data dir");

            // Initialize state synchronously (history loaded with std::fs)
            let state = Arc::new(AppState::new(app_data_dir));
            app.manage(state.clone());

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                server::start_server(state, app_handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::get_server_info])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
