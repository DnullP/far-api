use log::{error, info};
use tauri::Manager;

mod app;
mod backend_module_manifest;
mod commands;
mod config_history;
mod db;
mod host;
mod infra;
mod module_contribution;
mod shared;

use db::Db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    infra::logging::init();

    info!("[app] Far API starting up");
    backend_module_manifest::validate_builtin_backend_module_contributions()
        .expect("invalid builtin backend module contributions");
    host::command_registry::validate_registered_commands()
        .expect("registered Tauri commands must match backend module contributions");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");
            let log_dir = app_dir.join("logs");
            infra::logging::set_log_file_dir(Some(log_dir.clone()));
            infra::logging::install_tauri_log_notification_sink(app.handle().clone());
            info!("[logging] Writing logs to {:?}", log_dir);
            let db_path = app_dir.join("far-api.db");
            info!("[db] Opening database at {:?}", db_path);
            let db = Db::open(&db_path).map_err(|e| {
                error!("[db] Failed to open database: {}", e);
                e
            }).expect("failed to open database");
            info!("[db] Database ready (WAL mode, migrations applied)");
            app.manage(db);
            info!("[app] Setup complete");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            host::commands::http_commands::http_request,
            host::commands::frontend_log_commands::frontend_log,
            // Collections & requests
            commands::list_collections,
            commands::create_collection,
            commands::delete_collection,
            commands::rename_collection,
            commands::reorder_collections,
            commands::create_folder,
            commands::rename_folder,
            commands::delete_folder,
            commands::move_folder,
            commands::create_request,
            commands::update_request,
            commands::delete_request,
            commands::move_request,
            // Environments
            commands::list_environments,
            commands::create_environment,
            commands::update_environment,
            commands::delete_environment,
            // Config
            config_history::get_config,
            config_history::set_config,
            config_history::get_all_config,
            // History
            config_history::add_history,
            config_history::list_history,
            config_history::clear_history,
            config_history::delete_history_entry,
            config_history::add_runner_report,
            config_history::list_runner_reports,
            config_history::delete_runner_report,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
