use crate::db::Db;
use log::{debug, error, info};
use rusqlite::params;
use serde::{Deserialize, Serialize};

/* ---------- Config ---------- */

#[tauri::command]
pub fn get_config(db: tauri::State<'_, Db>, key: String) -> Result<Option<String>, String> {
    debug!("[config] get key={}", key);
    let conn = db.conn();
    let mut stmt = conn
        .prepare("SELECT value FROM config WHERE key = ?1")
        .map_err(|e| { error!("[config] get failed key={}: {}", key, e); e.to_string() })?;
    let result = stmt
        .query_row(params![key], |row| row.get::<_, String>(0))
        .ok();
    debug!("[config] get key={} found={}", key, result.is_some());
    Ok(result)
}

#[tauri::command]
pub fn set_config(db: tauri::State<'_, Db>, key: String, value: String) -> Result<(), String> {
    info!("[config] set key={}", key);
    let conn = db.conn();
    conn.execute(
        "INSERT INTO config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| { error!("[config] set failed key={}: {}", key, e); e.to_string() })?;
    Ok(())
}

#[tauri::command]
pub fn get_all_config(db: tauri::State<'_, Db>) -> Result<Vec<(String, String)>, String> {
    debug!("[config] get_all");
    let conn = db.conn();
    let mut stmt = conn
        .prepare("SELECT key, value FROM config ORDER BY key")
        .map_err(|e| { error!("[config] get_all failed: {}", e); e.to_string() })?;
    let rows = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    debug!("[config] get_all returned {} entries", rows.len());
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
pub fn add_history(db: tauri::State<'_, Db>, entry: AddHistoryInput) -> Result<String, String> {
    let id = uuid_v4();
    info!("[history] add {} {} status={} time={}ms", entry.method, entry.url, entry.status, entry.time_ms);
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
    debug!("[history] added id={}", id);
    Ok(id)
}

#[tauri::command]
pub fn list_history(
    db: tauri::State<'_, Db>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<HistoryEntry>, String> {
    let lim = limit.unwrap_or(50);
    let off = offset.unwrap_or(0);
    debug!("[history] list limit={} offset={}", lim, off);
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

    debug!("[history] list returned {} entries", rows.len());
    Ok(rows)
}

#[tauri::command]
pub fn clear_history(db: tauri::State<'_, Db>) -> Result<(), String> {
    info!("[history] clear all");
    let conn = db.conn();
    conn.execute("DELETE FROM request_history", [])
        .map_err(|e| { error!("[history] clear failed: {}", e); e.to_string() })?;
    Ok(())
}

#[tauri::command]
pub fn delete_history_entry(db: tauri::State<'_, Db>, id: String) -> Result<(), String> {
    info!("[history] delete id={}", id);
    let conn = db.conn();
    conn.execute("DELETE FROM request_history WHERE id = ?1", params![id])
        .map_err(|e| { error!("[history] delete failed id={}: {}", id, e); e.to_string() })?;
    Ok(())
}

/* ---------- Helpers ---------- */

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
