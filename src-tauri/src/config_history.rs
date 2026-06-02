use crate::db::Db;
use log::{debug, error, info};
use rusqlite::params;
use serde::{Deserialize, Serialize};

pub const CONFIG_COMMAND_IDS: &[&str] = &["get_config", "set_config", "get_all_config"];

pub const HISTORY_COMMAND_IDS: &[&str] = &[
    "add_history",
    "list_history",
    "clear_history",
    "delete_history_entry",
];

pub const RUNNER_REPORT_COMMAND_IDS: &[&str] = &[
    "add_runner_report",
    "list_runner_reports",
    "delete_runner_report",
];

fn trace_ref(trace_id: &Option<String>) -> &str {
    trace_id.as_deref().unwrap_or("none")
}

/* ---------- Config ---------- */

#[tauri::command]
pub fn get_config(
    db: tauri::State<'_, Db>,
    key: String,
    trace_id: Option<String>,
) -> Result<Option<String>, String> {
    debug!("[trace={}] [config] get key={}", trace_ref(&trace_id), key);
    let conn = db.conn();
    let mut stmt = conn
        .prepare("SELECT value FROM config WHERE key = ?1")
        .map_err(|e| { error!("[config] get failed key={}: {}", key, e); e.to_string() })?;
    let result = stmt
        .query_row(params![key], |row| row.get::<_, String>(0))
        .ok();
    debug!(
        "[trace={}] [config] get key={} found={}",
        trace_ref(&trace_id),
        key,
        result.is_some(),
    );
    Ok(result)
}

#[tauri::command]
pub fn set_config(
    db: tauri::State<'_, Db>,
    key: String,
    value: String,
    trace_id: Option<String>,
) -> Result<(), String> {
    info!("[trace={}] [config] set key={}", trace_ref(&trace_id), key);
    let conn = db.conn();
    conn.execute(
        "INSERT INTO config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| { error!("[config] set failed key={}: {}", key, e); e.to_string() })?;
    info!("[trace={}] [config] set complete key={}", trace_ref(&trace_id), key);
    Ok(())
}

#[tauri::command]
pub fn get_all_config(
    db: tauri::State<'_, Db>,
    trace_id: Option<String>,
) -> Result<Vec<(String, String)>, String> {
    debug!("[trace={}] [config] get_all", trace_ref(&trace_id));
    let conn = db.conn();
    let mut stmt = conn
        .prepare("SELECT key, value FROM config ORDER BY key")
        .map_err(|e| { error!("[config] get_all failed: {}", e); e.to_string() })?;
    let rows = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    debug!(
        "[trace={}] [config] get_all returned {} entries",
        trace_ref(&trace_id),
        rows.len(),
    );
    Ok(rows)
}

/* ---------- Request History ---------- */

#[derive(Serialize, Deserialize, Clone)]
pub struct HistoryEntry {
    pub id: String,
    #[serde(rename = "requestId")]
    pub request_id: Option<String>,
    pub method: String,
    pub url: String,
    #[serde(rename = "requestHeaders")]
    pub request_headers: String,
    #[serde(rename = "requestBody")]
    pub request_body: Option<String>,
    pub status: i32,
    #[serde(rename = "statusText")]
    pub status_text: String,
    #[serde(rename = "responseHeaders")]
    pub response_headers: String,
    #[serde(rename = "responseBody")]
    pub response_body: Option<String>,
    #[serde(rename = "timeMs")]
    pub time_ms: i64,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: i64,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct AddHistoryInput {
    #[serde(rename = "requestId")]
    pub request_id: Option<String>,
    pub method: String,
    pub url: String,
    #[serde(rename = "requestHeaders")]
    pub request_headers: String,
    #[serde(rename = "requestBody")]
    pub request_body: Option<String>,
    pub status: i32,
    #[serde(rename = "statusText")]
    pub status_text: String,
    #[serde(rename = "responseHeaders")]
    pub response_headers: String,
    #[serde(rename = "responseBody")]
    pub response_body: Option<String>,
    #[serde(rename = "timeMs")]
    pub time_ms: i64,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: i64,
}

#[tauri::command]
pub fn add_history(
    db: tauri::State<'_, Db>,
    entry: AddHistoryInput,
    trace_id: Option<String>,
) -> Result<String, String> {
    let id = uuid_v4();
    info!(
        "[trace={}] [history] add {} {} status={} time={}ms",
        trace_ref(&trace_id),
        entry.method,
        entry.url,
        entry.status,
        entry.time_ms,
    );
    let conn = db.conn();
    conn.execute(
        "INSERT INTO request_history (id, request_id, method, url, request_headers, request_body, status, status_text, response_headers, response_body, time_ms, size_bytes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            id,
            entry.request_id,
            entry.method,
            entry.url,
            entry.request_headers,
            entry.request_body,
            entry.status,
            entry.status_text,
            entry.response_headers,
            entry.response_body,
            entry.time_ms,
            entry.size_bytes,
        ],
    )
    .map_err(|e| { error!("[history] add failed: {}", e); e.to_string() })?;
    debug!("[trace={}] [history] added id={}", trace_ref(&trace_id), id);
    Ok(id)
}

#[tauri::command]
pub fn list_history(
    db: tauri::State<'_, Db>,
    limit: Option<i64>,
    offset: Option<i64>,
    trace_id: Option<String>,
) -> Result<Vec<HistoryEntry>, String> {
    let lim = limit.unwrap_or(50);
    let off = offset.unwrap_or(0);
    debug!(
        "[trace={}] [history] list limit={} offset={}",
        trace_ref(&trace_id),
        lim,
        off,
    );
    let conn = db.conn();
    let mut stmt = conn
        .prepare(
            "SELECT id, request_id, method, url, request_headers, request_body,
                    status, status_text, response_headers, response_body,
                    time_ms, size_bytes, created_at
             FROM request_history ORDER BY created_at DESC LIMIT ?1 OFFSET ?2",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![lim, off], |row| {
            Ok(HistoryEntry {
                id: row.get(0)?,
                request_id: row.get(1)?,
                method: row.get(2)?,
                url: row.get(3)?,
                request_headers: row.get(4)?,
                request_body: row.get(5)?,
                status: row.get(6)?,
                status_text: row.get(7)?,
                response_headers: row.get(8)?,
                response_body: row.get(9)?,
                time_ms: row.get(10)?,
                size_bytes: row.get(11)?,
                created_at: row.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    debug!(
        "[trace={}] [history] list returned {} entries",
        trace_ref(&trace_id),
        rows.len(),
    );
    Ok(rows)
}

#[tauri::command]
pub fn clear_history(
    db: tauri::State<'_, Db>,
    trace_id: Option<String>,
) -> Result<(), String> {
    info!("[trace={}] [history] clear all", trace_ref(&trace_id));
    let conn = db.conn();
    conn.execute("DELETE FROM request_history", [])
        .map_err(|e| { error!("[history] clear failed: {}", e); e.to_string() })?;
    info!("[trace={}] [history] cleared", trace_ref(&trace_id));
    Ok(())
}

#[tauri::command]
pub fn delete_history_entry(
    db: tauri::State<'_, Db>,
    id: String,
    trace_id: Option<String>,
) -> Result<(), String> {
    info!("[trace={}] [history] delete id={}", trace_ref(&trace_id), id);
    let conn = db.conn();
    conn.execute("DELETE FROM request_history WHERE id = ?1", params![id])
        .map_err(|e| { error!("[history] delete failed id={}: {}", id, e); e.to_string() })?;
    info!("[trace={}] [history] deleted id={}", trace_ref(&trace_id), id);
    Ok(())
}

/* ---------- Runner Reports ---------- */

#[derive(Serialize, Deserialize, Clone)]
pub struct RunnerTestResult {
    pub name: String,
    pub passed: bool,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RunnerConsoleEntry {
    pub level: String,
    pub message: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RunnerRequestResult {
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "requestName")]
    pub request_name: String,
    pub method: String,
    pub url: String,
    pub iteration: i64,
    pub status: i64,
    #[serde(rename = "statusText")]
    pub status_text: String,
    pub time: i64,
    pub tests: Vec<RunnerTestResult>,
    pub console: Vec<RunnerConsoleEntry>,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RunnerReportEntry {
    pub id: String,
    #[serde(rename = "targetName")]
    pub target_name: String,
    #[serde(rename = "targetKind")]
    pub target_kind: String,
    #[serde(rename = "targetId")]
    pub target_id: String,
    #[serde(rename = "collectionId")]
    pub collection_id: String,
    #[serde(rename = "folderId")]
    pub folder_id: Option<String>,
    pub iterations: i64,
    #[serde(rename = "totalRequests")]
    pub total_requests: i64,
    #[serde(rename = "passedTests")]
    pub passed_tests: i64,
    #[serde(rename = "failedTests")]
    pub failed_tests: i64,
    #[serde(rename = "durationMs")]
    pub duration_ms: i64,
    pub results: Vec<RunnerRequestResult>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct AddRunnerReportInput {
    #[serde(rename = "targetName")]
    pub target_name: String,
    #[serde(rename = "targetKind")]
    pub target_kind: String,
    #[serde(rename = "targetId")]
    pub target_id: String,
    #[serde(rename = "collectionId")]
    pub collection_id: String,
    #[serde(rename = "folderId")]
    pub folder_id: Option<String>,
    pub iterations: i64,
    #[serde(rename = "totalRequests")]
    pub total_requests: i64,
    #[serde(rename = "passedTests")]
    pub passed_tests: i64,
    #[serde(rename = "failedTests")]
    pub failed_tests: i64,
    #[serde(rename = "durationMs")]
    pub duration_ms: i64,
    pub results: Vec<RunnerRequestResult>,
}

#[tauri::command]
pub fn add_runner_report(
    db: tauri::State<'_, Db>,
    report: AddRunnerReportInput,
    trace_id: Option<String>,
) -> Result<RunnerReportEntry, String> {
    let id = uuid_v4();
    let results_json = serde_json::to_string(&report.results).map_err(|e| e.to_string())?;
    info!(
        "[trace={}] [runner_reports] add target={} kind={} requests={} failed={}",
        trace_ref(&trace_id),
        report.target_name,
        report.target_kind,
        report.total_requests,
        report.failed_tests,
    );

    let conn = db.conn();
    conn.execute(
        "INSERT INTO runner_reports (
            id, target_name, target_kind, target_id, collection_id, folder_id,
            iterations, total_requests, passed_tests, failed_tests, duration_ms, results_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            id,
            report.target_name,
            report.target_kind,
            report.target_id,
            report.collection_id,
            report.folder_id,
            report.iterations,
            report.total_requests,
            report.passed_tests,
            report.failed_tests,
            report.duration_ms,
            results_json,
        ],
    )
    .map_err(|e| { error!("[runner_reports] add failed: {}", e); e.to_string() })?;

    let entry = runner_report_by_id(&conn, &id)?;
    info!("[trace={}] [runner_reports] added id={}", trace_ref(&trace_id), id);
    Ok(entry)
}

#[tauri::command]
pub fn list_runner_reports(
    db: tauri::State<'_, Db>,
    limit: Option<i64>,
    offset: Option<i64>,
    trace_id: Option<String>,
) -> Result<Vec<RunnerReportEntry>, String> {
    let lim = limit.unwrap_or(20);
    let off = offset.unwrap_or(0);
    debug!(
        "[trace={}] [runner_reports] list limit={} offset={}",
        trace_ref(&trace_id),
        lim,
        off,
    );

    let conn = db.conn();
    let mut stmt = conn
        .prepare(
            "SELECT id, target_name, target_kind, target_id, collection_id, folder_id,
                    iterations, total_requests, passed_tests, failed_tests, duration_ms,
                    results_json, created_at
             FROM runner_reports ORDER BY created_at DESC LIMIT ?1 OFFSET ?2",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![lim, off], runner_report_from_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    debug!(
        "[trace={}] [runner_reports] list returned {} reports",
        trace_ref(&trace_id),
        rows.len(),
    );
    Ok(rows)
}

#[tauri::command]
pub fn delete_runner_report(
    db: tauri::State<'_, Db>,
    id: String,
    trace_id: Option<String>,
) -> Result<(), String> {
    info!("[trace={}] [runner_reports] delete id={}", trace_ref(&trace_id), id);
    let conn = db.conn();
    conn.execute("DELETE FROM runner_reports WHERE id = ?1", params![id])
        .map_err(|e| { error!("[runner_reports] delete failed id={}: {}", id, e); e.to_string() })?;
    info!("[trace={}] [runner_reports] deleted id={}", trace_ref(&trace_id), id);
    Ok(())
}

/* ---------- Helpers ---------- */

fn runner_report_by_id(
    conn: &rusqlite::Connection,
    id: &str,
) -> Result<RunnerReportEntry, String> {
    conn.query_row(
        "SELECT id, target_name, target_kind, target_id, collection_id, folder_id,
                iterations, total_requests, passed_tests, failed_tests, duration_ms,
                results_json, created_at
         FROM runner_reports WHERE id = ?1",
        params![id],
        runner_report_from_row,
    )
    .map_err(|e| e.to_string())
}

fn runner_report_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RunnerReportEntry> {
    let results_json: String = row.get(11)?;
    Ok(RunnerReportEntry {
        id: row.get(0)?,
        target_name: row.get(1)?,
        target_kind: row.get(2)?,
        target_id: row.get(3)?,
        collection_id: row.get(4)?,
        folder_id: row.get(5)?,
        iterations: row.get(6)?,
        total_requests: row.get(7)?,
        passed_tests: row.get(8)?,
        failed_tests: row.get(9)?,
        duration_ms: row.get(10)?,
        results: serde_json::from_str(&results_json).unwrap_or_default(),
        created_at: row.get(12)?,
    })
}

fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let seed = d.as_nanos();
    format!(
        "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        (seed & 0xFFFF_FFFF) as u32,
        ((seed >> 32) & 0xFFFF) as u16,
        ((seed >> 48) & 0x0FFF) as u16,
        (0x8000 | ((seed >> 60) & 0x3FFF)) as u16,
        (seed.wrapping_mul(6364136223846793005).wrapping_add(1)) & 0xFFFF_FFFF_FFFF
    )
}
