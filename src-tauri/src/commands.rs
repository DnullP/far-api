use crate::db::Db;
use log::{debug, error, info};
use rusqlite::params;
use serde::{Deserialize, Serialize};

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

/* ---------- Tauri commands: Collections ---------- */

#[tauri::command]
pub fn list_collections(db: tauri::State<'_, Db>) -> Result<Vec<CollectionDto>, String> {
    debug!("[collections] Listing all collections");
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
                "SELECT id, name, method, url, params_json, headers_json, body_json, sort_order
                 FROM requests WHERE collection_id = ?1 ORDER BY sort_order, created_at",
            )
            .map_err(|e| e.to_string())?;

        let items: Vec<ApiRequestDto> = req_stmt
            .query_map(params![cid], |row| {
                let params_str: String = row.get(4)?;
                let headers_str: String = row.get(5)?;
                let body_str: String = row.get(6)?;
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
                    sort_order: row.get(7)?,
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

    info!("[collections] Listed {} collection(s)", result.len());
    Ok(result)
}

#[tauri::command]
pub fn create_collection(db: tauri::State<'_, Db>, name: String) -> Result<CollectionDto, String> {
    let id = uuid_v4();
    info!("[collections] Creating collection '{}' (id={})", name, id);
    let conn = db.conn();
    conn.execute(
        "INSERT INTO collections (id, name) VALUES (?1, ?2)",
        params![id, name],
    )
    .map_err(|e| e.to_string())?;

    Ok(CollectionDto {
        id,
        name,
        sort_order: 0,
        items: vec![],
    })
}

#[tauri::command]
pub fn delete_collection(db: tauri::State<'_, Db>, id: String) -> Result<(), String> {
    info!("[collections] Deleting collection id={}", id);
    let conn = db.conn();
    conn.execute("DELETE FROM collections WHERE id = ?1", params![id])
        .map_err(|e| { error!("[collections] Delete failed for id={}: {}", id, e); e.to_string() })?;
    Ok(())
}

#[tauri::command]
pub fn rename_collection(
    db: tauri::State<'_, Db>,
    id: String,
    name: String,
) -> Result<(), String> {
    info!("[collections] Renaming collection id={} to '{}'", id, name);
    let conn = db.conn();
    conn.execute(
        "UPDATE collections SET name = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![name, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/* ---------- Tauri commands: Requests ---------- */

#[tauri::command]
pub fn create_request(
    db: tauri::State<'_, Db>,
    collection_id: String,
    name: String,
) -> Result<ApiRequestDto, String> {
    let id = uuid_v4();
    info!("[requests] Creating request '{}' in collection={} (id={})", name, collection_id, id);
    let conn = db.conn();
    conn.execute(
        "INSERT INTO requests (id, collection_id, name) VALUES (?1, ?2, ?3)",
        params![id, collection_id, name],
    )
    .map_err(|e| e.to_string())?;

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
        sort_order: 0,
    })
}

#[tauri::command]
pub fn update_request(db: tauri::State<'_, Db>, request: ApiRequestDto) -> Result<(), String> {
    debug!("[requests] Updating request id={} ({} {})", request.id, request.method, request.url);
    let params_json = serde_json::to_string(&request.params).map_err(|e| e.to_string())?;
    let headers_json = serde_json::to_string(&request.headers).map_err(|e| e.to_string())?;
    let body_json = serde_json::to_string(&request.body).map_err(|e| e.to_string())?;

    let conn = db.conn();
    conn.execute(
        "UPDATE requests SET name=?1, method=?2, url=?3, params_json=?4, headers_json=?5, body_json=?6, updated_at=datetime('now')
         WHERE id=?7",
        params![
            request.name,
            request.method,
            request.url,
            params_json,
            headers_json,
            body_json,
            request.id
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_request(db: tauri::State<'_, Db>, id: String) -> Result<(), String> {
    info!("[requests] Deleting request id={}", id);
    let conn = db.conn();
    conn.execute("DELETE FROM requests WHERE id = ?1", params![id])
        .map_err(|e| { error!("[requests] Delete failed for id={}: {}", id, e); e.to_string() })?;
    Ok(())
}

/* ---------- Tauri commands: Environments ---------- */

#[tauri::command]
pub fn list_environments(db: tauri::State<'_, Db>) -> Result<Vec<EnvironmentDto>, String> {
    debug!("[environments] Listing all environments");
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

    Ok(result)
}

#[tauri::command]
pub fn create_environment(
    db: tauri::State<'_, Db>,
    name: String,
) -> Result<EnvironmentDto, String> {
    let id = uuid_v4();
    info!("[environments] Creating environment '{}' (id={})", name, id);
    let conn = db.conn();
    conn.execute(
        "INSERT INTO environments (id, name) VALUES (?1, ?2)",
        params![id, name],
    )
    .map_err(|e| e.to_string())?;

    Ok(EnvironmentDto {
        id,
        name,
        variables: vec![],
    })
}

#[tauri::command]
pub fn update_environment(db: tauri::State<'_, Db>, env: EnvironmentDto) -> Result<(), String> {
    debug!("[environments] Updating environment id={} '{}' ({} vars)", env.id, env.name, env.variables.len());
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

    Ok(())
}

#[tauri::command]
pub fn delete_environment(db: tauri::State<'_, Db>, id: String) -> Result<(), String> {
    info!("[environments] Deleting environment id={}", id);
    let conn = db.conn();
    conn.execute("DELETE FROM environments WHERE id = ?1", params![id])
        .map_err(|e| { error!("[environments] Delete failed for id={}: {}", id, e); e.to_string() })?;
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
