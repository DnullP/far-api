use crate::db::Db;
use log::{debug, error, info};
use rusqlite::params;
use serde::{Deserialize, Serialize};

pub const COLLECTION_COMMAND_IDS: &[&str] = &[
    "list_collections",
    "create_collection",
    "delete_collection",
    "rename_collection",
    "reorder_collections",
];

pub const REQUEST_COMMAND_IDS: &[&str] = &[
    "create_request",
    "update_request",
    "delete_request",
    "move_request",
];

pub const ENVIRONMENT_COMMAND_IDS: &[&str] = &[
    "list_environments",
    "create_environment",
    "update_environment",
    "delete_environment",
];

fn trace_ref(trace_id: &Option<String>) -> &str {
    trace_id.as_deref().unwrap_or("none")
}

fn default_api_key_placement() -> String {
    "header".into()
}

fn default_request_auth() -> RequestAuth {
    RequestAuth {
        auth_type: "none".into(),
        bearer_token: String::new(),
        basic_username: String::new(),
        basic_password: String::new(),
        api_key_name: String::new(),
        api_key_value: String::new(),
        api_key_placement: default_api_key_placement(),
    }
}

/* ---------- DTOs ---------- */

#[derive(Serialize, Deserialize, Clone)]
pub struct KeyValuePair {
    pub id: String,
    pub key: String,
    pub value: String,
    pub enabled: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RequestBody {
    #[serde(rename = "type")]
    pub body_type: String,
    pub json: String,
    pub form: Vec<KeyValuePair>,
    pub raw: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RequestAuth {
    #[serde(rename = "type")]
    pub auth_type: String,
    #[serde(rename = "bearerToken", default)]
    pub bearer_token: String,
    #[serde(rename = "basicUsername", default)]
    pub basic_username: String,
    #[serde(rename = "basicPassword", default)]
    pub basic_password: String,
    #[serde(rename = "apiKeyName", default)]
    pub api_key_name: String,
    #[serde(rename = "apiKeyValue", default)]
    pub api_key_value: String,
    #[serde(rename = "apiKeyPlacement", default = "default_api_key_placement")]
    pub api_key_placement: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ApiRequestDto {
    pub id: String,
    #[serde(rename = "collectionId")]
    pub collection_id: String,
    pub name: String,
    pub method: String,
    pub url: String,
    pub params: Vec<KeyValuePair>,
    pub headers: Vec<KeyValuePair>,
    pub body: RequestBody,
    pub auth: RequestAuth,
    #[serde(rename = "sortOrder")]
    pub sort_order: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CollectionDto {
    pub id: String,
    pub name: String,
    #[serde(rename = "sortOrder")]
    pub sort_order: i64,
    pub items: Vec<ApiRequestDto>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct EnvironmentVariableDto {
    pub id: String,
    pub key: String,
    pub value: String,
    pub enabled: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct EnvironmentDto {
    pub id: String,
    pub name: String,
    pub variables: Vec<EnvironmentVariableDto>,
}

#[derive(Deserialize)]
pub struct MoveRequestInput {
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "targetCollectionId")]
    pub target_collection_id: String,
    #[serde(rename = "beforeRequestId")]
    pub before_request_id: Option<String>,
}

/* ---------- Tauri commands: Collections ---------- */

#[tauri::command]
pub fn list_collections(
    db: tauri::State<'_, Db>,
    trace_id: Option<String>,
) -> Result<Vec<CollectionDto>, String> {
    debug!("[trace={}] [collections] Listing all collections", trace_ref(&trace_id));
    let conn = db.conn();

    let mut stmt = conn
        .prepare("SELECT id, name, sort_order FROM collections ORDER BY sort_order, created_at")
        .map_err(|e| { error!("[collections] Failed to list: {}", e); e.to_string() })?;

    let collections: Vec<(String, String, i64)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for (cid, cname, csort) in collections {
        let mut req_stmt = conn
            .prepare(
                "SELECT id, name, method, url, params_json, headers_json, body_json, auth_json, sort_order
                 FROM requests WHERE collection_id = ?1 ORDER BY sort_order, created_at",
            )
            .map_err(|e| e.to_string())?;

        let items: Vec<ApiRequestDto> = req_stmt
            .query_map(params![cid], |row| {
                let params_str: String = row.get(4)?;
                let headers_str: String = row.get(5)?;
                let body_str: String = row.get(6)?;
                let auth_str: String = row.get(7)?;
                Ok(ApiRequestDto {
                    id: row.get(0)?,
                    collection_id: cid.clone(),
                    name: row.get(1)?,
                    method: row.get(2)?,
                    url: row.get(3)?,
                    params: serde_json::from_str(&params_str).unwrap_or_default(),
                    headers: serde_json::from_str(&headers_str).unwrap_or_default(),
                    body: serde_json::from_str(&body_str).unwrap_or_else(|_| RequestBody {
                        body_type: "none".into(),
                        json: "{}".into(),
                        form: vec![],
                        raw: String::new(),
                    }),
                    auth: serde_json::from_str(&auth_str)
                        .unwrap_or_else(|_| default_request_auth()),
                    sort_order: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        result.push(CollectionDto {
            id: cid,
            name: cname,
            sort_order: csort,
            items,
        });
    }

    info!("[trace={}] [collections] Listed {} collection(s)", trace_ref(&trace_id), result.len());
    Ok(result)
}

#[tauri::command]
pub fn create_collection(
    db: tauri::State<'_, Db>,
    name: String,
    trace_id: Option<String>,
) -> Result<CollectionDto, String> {
    let id = uuid_v4();
    info!(
        "[trace={}] [collections] Creating collection '{}' (id={})",
        trace_ref(&trace_id),
        name,
        id,
    );
    let conn = db.conn();
    let sort_order = next_collection_sort_order(&conn)?;
    conn.execute(
        "INSERT INTO collections (id, name, sort_order) VALUES (?1, ?2, ?3)",
        params![id, name, sort_order],
    )
    .map_err(|e| e.to_string())?;

    info!("[trace={}] [collections] Created collection id={}", trace_ref(&trace_id), id);
    Ok(CollectionDto {
        id,
        name,
        sort_order,
        items: vec![],
    })
}

#[tauri::command]
pub fn delete_collection(
    db: tauri::State<'_, Db>,
    id: String,
    trace_id: Option<String>,
) -> Result<(), String> {
    info!("[trace={}] [collections] Deleting collection id={}", trace_ref(&trace_id), id);
    let conn = db.conn();
    conn.execute("DELETE FROM collections WHERE id = ?1", params![id])
        .map_err(|e| { error!("[collections] Delete failed for id={}: {}", id, e); e.to_string() })?;
    info!("[trace={}] [collections] Deleted collection id={}", trace_ref(&trace_id), id);
    Ok(())
}

#[tauri::command]
pub fn rename_collection(
    db: tauri::State<'_, Db>,
    id: String,
    name: String,
    trace_id: Option<String>,
) -> Result<(), String> {
    info!(
        "[trace={}] [collections] Renaming collection id={} to '{}'",
        trace_ref(&trace_id),
        id,
        name,
    );
    let conn = db.conn();
    conn.execute(
        "UPDATE collections SET name = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![name, id],
    )
    .map_err(|e| e.to_string())?;
    info!("[trace={}] [collections] Renamed collection id={}", trace_ref(&trace_id), id);
    Ok(())
}

#[tauri::command]
pub fn reorder_collections(
    db: tauri::State<'_, Db>,
    collection_ids: Vec<String>,
    trace_id: Option<String>,
) -> Result<(), String> {
    info!(
        "[trace={}] [collections] Reordering {} collection(s)",
        trace_ref(&trace_id),
        collection_ids.len(),
    );
    let mut conn = db.conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for (index, id) in collection_ids.iter().enumerate() {
        tx.execute(
            "UPDATE collections SET sort_order = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![index as i64, id],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    info!("[trace={}] [collections] Reordered collections", trace_ref(&trace_id));
    Ok(())
}

/* ---------- Tauri commands: Requests ---------- */

#[tauri::command]
pub fn create_request(
    db: tauri::State<'_, Db>,
    collection_id: String,
    name: String,
    trace_id: Option<String>,
) -> Result<ApiRequestDto, String> {
    let id = uuid_v4();
    info!(
        "[trace={}] [requests] Creating request '{}' in collection={} (id={})",
        trace_ref(&trace_id),
        name,
        collection_id,
        id,
    );
    let conn = db.conn();
    let sort_order = next_request_sort_order(&conn, &collection_id)?;
    conn.execute(
        "INSERT INTO requests (id, collection_id, name, sort_order) VALUES (?1, ?2, ?3, ?4)",
        params![id, collection_id, name, sort_order],
    )
    .map_err(|e| e.to_string())?;

    info!("[trace={}] [requests] Created request id={}", trace_ref(&trace_id), id);
    Ok(ApiRequestDto {
        id,
        collection_id,
        name,
        method: "GET".into(),
        url: String::new(),
        params: vec![],
        headers: vec![],
        body: RequestBody {
            body_type: "none".into(),
            json: "{}".into(),
            form: vec![],
            raw: String::new(),
        },
        auth: default_request_auth(),
        sort_order,
    })
}

#[tauri::command]
pub fn update_request(
    db: tauri::State<'_, Db>,
    request: ApiRequestDto,
    trace_id: Option<String>,
) -> Result<(), String> {
    debug!(
        "[trace={}] [requests] Updating request id={} ({} {})",
        trace_ref(&trace_id),
        request.id,
        request.method,
        request.url,
    );
    let params_json = serde_json::to_string(&request.params).map_err(|e| e.to_string())?;
    let headers_json = serde_json::to_string(&request.headers).map_err(|e| e.to_string())?;
    let body_json = serde_json::to_string(&request.body).map_err(|e| e.to_string())?;
    let auth_json = serde_json::to_string(&request.auth).map_err(|e| e.to_string())?;

    let conn = db.conn();
    conn.execute(
        "UPDATE requests SET name=?1, method=?2, url=?3, params_json=?4, headers_json=?5, body_json=?6, auth_json=?7, updated_at=datetime('now')
         WHERE id=?8",
        params![
            request.name,
            request.method,
            request.url,
            params_json,
            headers_json,
            body_json,
            auth_json,
            request.id
        ],
    )
    .map_err(|e| e.to_string())?;
    info!("[trace={}] [requests] Updated request id={}", trace_ref(&trace_id), request.id);
    Ok(())
}

#[tauri::command]
pub fn delete_request(
    db: tauri::State<'_, Db>,
    id: String,
    trace_id: Option<String>,
) -> Result<(), String> {
    info!("[trace={}] [requests] Deleting request id={}", trace_ref(&trace_id), id);
    let conn = db.conn();
    conn.execute("DELETE FROM requests WHERE id = ?1", params![id])
        .map_err(|e| { error!("[requests] Delete failed for id={}: {}", id, e); e.to_string() })?;
    info!("[trace={}] [requests] Deleted request id={}", trace_ref(&trace_id), id);
    Ok(())
}

#[tauri::command]
pub fn move_request(
    db: tauri::State<'_, Db>,
    input: MoveRequestInput,
    trace_id: Option<String>,
) -> Result<(), String> {
    info!(
        "[trace={}] [requests] Moving request id={} to collection={} before={:?}",
        trace_ref(&trace_id),
        input.request_id,
        input.target_collection_id,
        input.before_request_id,
    );

    let mut conn = db.conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let source_collection_id: String = tx
        .query_row(
            "SELECT collection_id FROM requests WHERE id = ?1",
            params![input.request_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("request not found: {}", e))?;

    tx.query_row(
        "SELECT id FROM collections WHERE id = ?1",
        params![input.target_collection_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|e| format!("target collection not found: {}", e))?;

    if let Some(before_request_id) = &input.before_request_id {
        let before_collection_id: String = tx
            .query_row(
                "SELECT collection_id FROM requests WHERE id = ?1",
                params![before_request_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("before request not found: {}", e))?;
        if before_collection_id != input.target_collection_id {
            return Err("before request is not in target collection".to_string());
        }
    }

    tx.execute(
        "UPDATE requests SET collection_id = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![input.target_collection_id, input.request_id],
    )
    .map_err(|e| e.to_string())?;

    if source_collection_id != input.target_collection_id {
        reindex_requests_in_collection(&tx, &source_collection_id, None)?;
    }
    reindex_requests_in_collection(
        &tx,
        &input.target_collection_id,
        Some((&input.request_id, input.before_request_id.as_deref())),
    )?;

    tx.commit().map_err(|e| e.to_string())?;
    info!("[trace={}] [requests] Moved request id={}", trace_ref(&trace_id), input.request_id);
    Ok(())
}

/* ---------- Tauri commands: Environments ---------- */

#[tauri::command]
pub fn list_environments(
    db: tauri::State<'_, Db>,
    trace_id: Option<String>,
) -> Result<Vec<EnvironmentDto>, String> {
    debug!("[trace={}] [environments] Listing all environments", trace_ref(&trace_id));
    let conn = db.conn();
    let mut stmt = conn
        .prepare("SELECT id, name FROM environments ORDER BY sort_order, created_at")
        .map_err(|e| { error!("[environments] Failed to list: {}", e); e.to_string() })?;

    let envs: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for (eid, ename) in envs {
        let mut var_stmt = conn
            .prepare(
                "SELECT id, key, value, enabled FROM environment_variables
                 WHERE environment_id = ?1 ORDER BY sort_order",
            )
            .map_err(|e| e.to_string())?;

        let vars: Vec<EnvironmentVariableDto> = var_stmt
            .query_map(params![eid], |row| {
                Ok(EnvironmentVariableDto {
                    id: row.get(0)?,
                    key: row.get(1)?,
                    value: row.get(2)?,
                    enabled: row.get::<_, i32>(3)? != 0,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        result.push(EnvironmentDto {
            id: eid,
            name: ename,
            variables: vars,
        });
    }

    info!("[trace={}] [environments] Listed {} environment(s)", trace_ref(&trace_id), result.len());
    Ok(result)
}

#[tauri::command]
pub fn create_environment(
    db: tauri::State<'_, Db>,
    name: String,
    trace_id: Option<String>,
) -> Result<EnvironmentDto, String> {
    let id = uuid_v4();
    info!(
        "[trace={}] [environments] Creating environment '{}' (id={})",
        trace_ref(&trace_id),
        name,
        id,
    );
    let conn = db.conn();
    conn.execute(
        "INSERT INTO environments (id, name) VALUES (?1, ?2)",
        params![id, name],
    )
    .map_err(|e| e.to_string())?;

    info!("[trace={}] [environments] Created environment id={}", trace_ref(&trace_id), id);
    Ok(EnvironmentDto {
        id,
        name,
        variables: vec![],
    })
}

#[tauri::command]
pub fn update_environment(
    db: tauri::State<'_, Db>,
    env: EnvironmentDto,
    trace_id: Option<String>,
) -> Result<(), String> {
    debug!(
        "[trace={}] [environments] Updating environment id={} '{}' ({} vars)",
        trace_ref(&trace_id),
        env.id,
        env.name,
        env.variables.len(),
    );
    let conn = db.conn();
    conn.execute(
        "UPDATE environments SET name = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![env.name, env.id],
    )
    .map_err(|e| e.to_string())?;

    // Replace all variables: delete then re-insert
    conn.execute(
        "DELETE FROM environment_variables WHERE environment_id = ?1",
        params![env.id],
    )
    .map_err(|e| e.to_string())?;

    for (i, v) in env.variables.iter().enumerate() {
        conn.execute(
            "INSERT INTO environment_variables (id, environment_id, key, value, enabled, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![v.id, env.id, v.key, v.value, v.enabled as i32, i as i64],
        )
        .map_err(|e| e.to_string())?;
    }

    info!("[trace={}] [environments] Updated environment id={}", trace_ref(&trace_id), env.id);
    Ok(())
}

#[tauri::command]
pub fn delete_environment(
    db: tauri::State<'_, Db>,
    id: String,
    trace_id: Option<String>,
) -> Result<(), String> {
    info!("[trace={}] [environments] Deleting environment id={}", trace_ref(&trace_id), id);
    let conn = db.conn();
    conn.execute("DELETE FROM environments WHERE id = ?1", params![id])
        .map_err(|e| { error!("[environments] Delete failed for id={}: {}", id, e); e.to_string() })?;
    info!("[trace={}] [environments] Deleted environment id={}", trace_ref(&trace_id), id);
    Ok(())
}

/* ---------- Helpers ---------- */

fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let seed = d.as_nanos();
    // Simple pseudo-UUID (good enough for local IDs)
    format!(
        "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        (seed & 0xFFFF_FFFF) as u32,
        ((seed >> 32) & 0xFFFF) as u16,
        ((seed >> 48) & 0x0FFF) as u16,
        (0x8000 | ((seed >> 60) & 0x3FFF)) as u16,
        (seed.wrapping_mul(6364136223846793005).wrapping_add(1)) & 0xFFFF_FFFF_FFFF
    )
}

fn next_collection_sort_order(conn: &rusqlite::Connection) -> Result<i64, String> {
    conn.query_row(
        "SELECT COALESCE(MAX(sort_order) + 1, 0) FROM collections",
        [],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn next_request_sort_order(conn: &rusqlite::Connection, collection_id: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT COALESCE(MAX(sort_order) + 1, 0) FROM requests WHERE collection_id = ?1",
        params![collection_id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn request_ids_in_collection(
    tx: &rusqlite::Transaction<'_>,
    collection_id: &str,
) -> Result<Vec<String>, String> {
    let mut stmt = tx
        .prepare(
            "SELECT id FROM requests WHERE collection_id = ?1 ORDER BY sort_order, created_at",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![collection_id], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn reindex_requests_in_collection(
    tx: &rusqlite::Transaction<'_>,
    collection_id: &str,
    move_spec: Option<(&str, Option<&str>)>,
) -> Result<(), String> {
    let mut ids = request_ids_in_collection(tx, collection_id)?;
    if let Some((request_id, before_request_id)) = move_spec {
        ids.retain(|id| id != request_id);
        let insert_at = before_request_id
            .and_then(|target_id| ids.iter().position(|id| id == target_id))
            .unwrap_or(ids.len());
        ids.insert(insert_at, request_id.to_string());
    }

    for (index, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE requests SET sort_order = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![index as i64, id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}
