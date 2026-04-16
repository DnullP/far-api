use log::{debug, error, info};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Instant;
use tauri::Manager;

mod commands;
mod config_history;
mod db;

use db::Db;

#[derive(Deserialize)]
struct HttpRequestInput {
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
}

#[derive(Serialize)]
struct HttpResponseOutput {
    status: u16,
    status_text: String,
    headers: HashMap<String, String>,
    body: String,
    time: u64,
    size: usize,
}

#[tauri::command]
async fn http_request(input: HttpRequestInput) -> Result<HttpResponseOutput, String> {
    info!(
        "[http] --> {} {} ({} header(s), body={})",
        input.method,
        input.url,
        input.headers.len(),
        if input.body.is_some() { "yes" } else { "no" }
    );

    let client = reqwest::Client::new();

    let method = input
        .method
        .parse::<reqwest::Method>()
        .map_err(|e| {
            error!("[http] Invalid method '{}': {}", input.method, e);
            e.to_string()
        })?;

    let mut req = client.request(method, &input.url);
    for (k, v) in &input.headers {
        req = req.header(k.as_str(), v.as_str());
    }
    if let Some(body) = input.body {
        debug!("[http] Request body length: {} bytes", body.len());
        req = req.body(body);
    }

    let start = Instant::now();
    let resp = req.send().await.map_err(|e| {
        error!("[http] Request failed for {}: {}", input.url, e);
        e.to_string()
    })?;
    let elapsed = start.elapsed().as_millis() as u64;

    let status = resp.status().as_u16();
    let status_text = resp
        .status()
        .canonical_reason()
        .unwrap_or("")
        .to_string();

    let mut headers = HashMap::new();
    for (k, v) in resp.headers() {
        if let Ok(val) = v.to_str() {
            headers.insert(k.to_string(), val.to_string());
        }
    }

    let body = resp.text().await.map_err(|e| {
        error!("[http] Failed to read response body: {}", e);
        e.to_string()
    })?;
    let size = body.len();

    info!(
        "[http] <-- {} {} | {} {} | {}ms | {} bytes",
        input.method, input.url, status, status_text, elapsed, size
    );

    Ok(HttpResponseOutput {
        status,
        status_text,
        headers,
        body,
        time: elapsed,
        size,
    })
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Receives log messages forwarded from the frontend.
#[derive(Deserialize)]
struct FrontendLogEntry {
    level: String,
    module: String,
    message: String,
    #[serde(default)]
    data: Option<String>,
}

/// Format a frontend log entry into target + message for the Rust logger.
fn format_frontend_log(entry: &FrontendLogEntry) -> (String, String) {
    let target = format!("frontend::{}", entry.module);
    let msg = match &entry.data {
        Some(d) if !d.is_empty() => format!("{} | {}", entry.message, d),
        _ => entry.message.clone(),
    };
    (target, msg)
}

#[tauri::command]
fn frontend_log(entry: FrontendLogEntry) {
    let (target, msg) = format_frontend_log(&entry);
    match entry.level.as_str() {
        "error" => log::error!(target: &target, "{}", msg),
        "warn" => log::warn!(target: &target, "{}", msg),
        "debug" => log::debug!(target: &target, "{}", msg),
        "trace" => log::trace!(target: &target, "{}", msg),
        _ => log::info!(target: &target, "{}", msg),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logger: defaults to info, configurable via RUST_LOG env var
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();

    info!("[app] Far API starting up");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");
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
            greet,
            http_request,
            frontend_log,
            // Collections & requests
            commands::list_collections,
            commands::create_collection,
            commands::delete_collection,
            commands::rename_collection,
            commands::create_request,
            commands::update_request,
            commands::delete_request,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_entry(level: &str, module: &str, message: &str, data: Option<&str>) -> FrontendLogEntry {
        FrontendLogEntry {
            level: level.to_string(),
            module: module.to_string(),
            message: message.to_string(),
            data: data.map(|s| s.to_string()),
        }
    }

    #[test]
    fn format_frontend_log_target() {
        let entry = make_entry("info", "httpClient", "request sent", None);
        let (target, _) = format_frontend_log(&entry);
        assert_eq!(target, "frontend::httpClient");
    }

    #[test]
    fn format_frontend_log_message_without_data() {
        let entry = make_entry("error", "appStore", "failed to load", None);
        let (_, msg) = format_frontend_log(&entry);
        assert_eq!(msg, "failed to load");
    }

    #[test]
    fn format_frontend_log_message_with_empty_data() {
        let entry = make_entry("warn", "mod", "msg", Some(""));
        let (_, msg) = format_frontend_log(&entry);
        assert_eq!(msg, "msg");
    }

    #[test]
    fn format_frontend_log_message_with_data() {
        let entry = make_entry("debug", "persistence", "save failed", Some("{\"id\":\"abc\"}"));
        let (_, msg) = format_frontend_log(&entry);
        assert_eq!(msg, "save failed | {\"id\":\"abc\"}");
    }

    #[test]
    fn frontend_log_entry_deserializes_from_json() {
        let json = r#"{"level":"info","module":"test","message":"hello"}"#;
        let entry: FrontendLogEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.level, "info");
        assert_eq!(entry.module, "test");
        assert_eq!(entry.message, "hello");
        assert!(entry.data.is_none());
    }

    #[test]
    fn frontend_log_entry_deserializes_with_data() {
        let json = r#"{"level":"error","module":"m","message":"fail","data":"details"}"#;
        let entry: FrontendLogEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.data, Some("details".to_string()));
    }
}
