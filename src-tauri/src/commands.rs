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
    "create_folder",
    "rename_folder",
    "delete_folder",
    "move_folder",
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

fn default_request_scripts() -> RequestScripts {
    RequestScripts {
        pre_request: String::new(),
        post_response: String::new(),
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
pub struct RequestScripts {
    #[serde(rename = "preRequest", default)]
    pub pre_request: String,
    #[serde(rename = "postResponse", default)]
    pub post_response: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ApiRequestDto {
    pub id: String,
    #[serde(rename = "collectionId")]
    pub collection_id: String,
    #[serde(rename = "folderId")]
    pub folder_id: Option<String>,
    pub name: String,
    pub method: String,
    pub url: String,
    pub params: Vec<KeyValuePair>,
    pub headers: Vec<KeyValuePair>,
    pub body: RequestBody,
    pub auth: RequestAuth,
    #[serde(default = "default_request_scripts")]
    pub scripts: RequestScripts,
    #[serde(rename = "sortOrder")]
    pub sort_order: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum CollectionItemDto {
    #[serde(rename = "folder")]
    Folder(RequestFolderDto),
    #[serde(rename = "request")]
    Request(ApiRequestDto),
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RequestFolderDto {
    pub id: String,
    #[serde(rename = "collectionId")]
    pub collection_id: String,
    #[serde(rename = "parentFolderId")]
    pub parent_folder_id: Option<String>,
    pub name: String,
    #[serde(rename = "sortOrder")]
    pub sort_order: i64,
    pub children: Vec<CollectionItemDto>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CollectionDto {
    pub id: String,
    pub name: String,
    #[serde(rename = "sortOrder")]
    pub sort_order: i64,
    pub items: Vec<CollectionItemDto>,
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
    #[serde(rename = "targetFolderId")]
    pub target_folder_id: Option<String>,
    #[serde(rename = "beforeRequestId")]
    pub before_request_id: Option<String>,
}

#[derive(Deserialize)]
pub struct MoveFolderInput {
    #[serde(rename = "folderId")]
    pub folder_id: String,
    #[serde(rename = "targetCollectionId")]
    pub target_collection_id: String,
    #[serde(rename = "targetParentFolderId")]
    pub target_parent_folder_id: Option<String>,
    #[serde(rename = "beforeItemId")]
    pub before_item_id: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateFolderInput {
    #[serde(rename = "collectionId")]
    pub collection_id: String,
    #[serde(rename = "parentFolderId")]
    pub parent_folder_id: Option<String>,
    pub name: String,
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
        result.push(CollectionDto {
            items: collection_items_for_parent(&conn, &cid, None)?,
            id: cid,
            name: cname,
            sort_order: csort,
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

#[tauri::command]
pub fn create_folder(
    db: tauri::State<'_, Db>,
    input: CreateFolderInput,
    trace_id: Option<String>,
) -> Result<RequestFolderDto, String> {
    let id = uuid_v4();
    info!(
        "[trace={}] [collections] Creating folder '{}' in collection={} parent={:?} (id={})",
        trace_ref(&trace_id),
        input.name,
        input.collection_id,
        input.parent_folder_id,
        id,
    );
    let conn = db.conn();
    ensure_collection_exists(&conn, &input.collection_id)?;
    if let Some(parent_folder_id) = &input.parent_folder_id {
        ensure_folder_in_collection(&conn, parent_folder_id, &input.collection_id)?;
    }

    let sort_order = next_child_sort_order(
        &conn,
        &input.collection_id,
        input.parent_folder_id.as_deref(),
    )?;
    conn.execute(
        "INSERT INTO request_folders (id, collection_id, parent_folder_id, name, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, input.collection_id, input.parent_folder_id, input.name, sort_order],
    )
    .map_err(|e| e.to_string())?;

    info!("[trace={}] [collections] Created folder id={}", trace_ref(&trace_id), id);
    Ok(RequestFolderDto {
        id,
        collection_id: input.collection_id,
        parent_folder_id: input.parent_folder_id,
        name: input.name,
        sort_order,
        children: vec![],
    })
}

#[tauri::command]
pub fn rename_folder(
    db: tauri::State<'_, Db>,
    id: String,
    name: String,
    trace_id: Option<String>,
) -> Result<(), String> {
    info!(
        "[trace={}] [collections] Renaming folder id={} to '{}'",
        trace_ref(&trace_id),
        id,
        name,
    );
    let conn = db.conn();
    conn.execute(
        "UPDATE request_folders SET name = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![name, id],
    )
    .map_err(|e| e.to_string())?;
    info!("[trace={}] [collections] Renamed folder id={}", trace_ref(&trace_id), id);
    Ok(())
}

#[tauri::command]
pub fn delete_folder(
    db: tauri::State<'_, Db>,
    id: String,
    trace_id: Option<String>,
) -> Result<(), String> {
    info!("[trace={}] [collections] Deleting folder id={}", trace_ref(&trace_id), id);
    let conn = db.conn();
    conn.execute("DELETE FROM request_folders WHERE id = ?1", params![id])
        .map_err(|e| { error!("[collections] Delete folder failed for id={}: {}", id, e); e.to_string() })?;
    info!("[trace={}] [collections] Deleted folder id={}", trace_ref(&trace_id), id);
    Ok(())
}

#[tauri::command]
pub fn move_folder(
    db: tauri::State<'_, Db>,
    input: MoveFolderInput,
    trace_id: Option<String>,
) -> Result<(), String> {
    info!(
        "[trace={}] [collections] Moving folder id={} to collection={} parent={:?} before={:?}",
        trace_ref(&trace_id),
        input.folder_id,
        input.target_collection_id,
        input.target_parent_folder_id,
        input.before_item_id,
    );

    if input.target_parent_folder_id.as_deref() == Some(input.folder_id.as_str()) {
        return Err("folder cannot be moved into itself".to_string());
    }

    let mut conn = db.conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let (source_collection_id, source_parent_folder_id): (String, Option<String>) = tx
        .query_row(
            "SELECT collection_id, parent_folder_id FROM request_folders WHERE id = ?1",
            params![input.folder_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("folder not found: {}", e))?;

    tx.query_row(
        "SELECT id FROM collections WHERE id = ?1",
        params![input.target_collection_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|e| format!("target collection not found: {}", e))?;

    if let Some(target_parent_folder_id) = &input.target_parent_folder_id {
        let parent_collection_id: String = tx
            .query_row(
                "SELECT collection_id FROM request_folders WHERE id = ?1",
                params![target_parent_folder_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("target parent folder not found: {}", e))?;
        if parent_collection_id != input.target_collection_id {
            return Err("target parent folder is not in target collection".to_string());
        }
        if is_descendant_folder(&tx, target_parent_folder_id, &input.folder_id)? {
            return Err("folder cannot be moved into its descendant".to_string());
        }
    }

    if let Some(before_item_id) = &input.before_item_id {
        let (before_collection_id, before_parent_folder_id) =
            child_location_by_id(&tx, before_item_id)
                .map_err(|e| format!("before item not found: {}", e))?;
        if before_collection_id != input.target_collection_id {
            return Err("before item is not in target collection".to_string());
        }
        if before_parent_folder_id != input.target_parent_folder_id {
            return Err("before item is not in target parent folder".to_string());
        }
    }

    tx.execute(
        "UPDATE request_folders
         SET collection_id = ?1, parent_folder_id = ?2, updated_at = datetime('now')
         WHERE id = ?3",
        params![
            input.target_collection_id,
            input.target_parent_folder_id,
            input.folder_id,
        ],
    )
    .map_err(|e| e.to_string())?;
    update_descendant_collection_ids(&tx, &input.folder_id, &input.target_collection_id)?;

    if source_collection_id != input.target_collection_id ||
        source_parent_folder_id != input.target_parent_folder_id
    {
        reindex_children_in_parent(&tx, &source_collection_id, source_parent_folder_id.as_deref(), None)?;
    }
    reindex_children_in_parent(
        &tx,
        &input.target_collection_id,
        input.target_parent_folder_id.as_deref(),
        Some((&input.folder_id, input.before_item_id.as_deref())),
    )?;

    tx.commit().map_err(|e| e.to_string())?;
    info!("[trace={}] [collections] Moved folder id={}", trace_ref(&trace_id), input.folder_id);
    Ok(())
}

/* ---------- Tauri commands: Requests ---------- */

#[tauri::command]
pub fn create_request(
    db: tauri::State<'_, Db>,
    collection_id: String,
    name: String,
    folder_id: Option<String>,
    trace_id: Option<String>,
) -> Result<ApiRequestDto, String> {
    let id = uuid_v4();
    info!(
        "[trace={}] [requests] Creating request '{}' in collection={} folder={:?} (id={})",
        trace_ref(&trace_id),
        name,
        collection_id,
        folder_id,
        id,
    );
    let conn = db.conn();
    ensure_collection_exists(&conn, &collection_id)?;
    if let Some(target_folder_id) = &folder_id {
        ensure_folder_in_collection(&conn, target_folder_id, &collection_id)?;
    }
    let sort_order = next_child_sort_order(&conn, &collection_id, folder_id.as_deref())?;
    conn.execute(
        "INSERT INTO requests (id, collection_id, folder_id, name, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, collection_id, folder_id, name, sort_order],
    )
    .map_err(|e| e.to_string())?;

    info!("[trace={}] [requests] Created request id={}", trace_ref(&trace_id), id);
    Ok(ApiRequestDto {
        id,
        collection_id,
        folder_id,
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
        scripts: default_request_scripts(),
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
    let scripts_json = serde_json::to_string(&request.scripts).map_err(|e| e.to_string())?;

    let conn = db.conn();
    conn.execute(
        "UPDATE requests SET name=?1, method=?2, url=?3, params_json=?4, headers_json=?5, body_json=?6, auth_json=?7, scripts_json=?8, collection_id=?9, folder_id=?10, updated_at=datetime('now')
         WHERE id=?11",
        params![
            request.name,
            request.method,
            request.url,
            params_json,
            headers_json,
            body_json,
            auth_json,
            scripts_json,
            request.collection_id,
            request.folder_id,
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
        "[trace={}] [requests] Moving request id={} to collection={} folder={:?} before={:?}",
        trace_ref(&trace_id),
        input.request_id,
        input.target_collection_id,
        input.target_folder_id,
        input.before_request_id,
    );

    let mut conn = db.conn();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let (source_collection_id, source_folder_id): (String, Option<String>) = tx
        .query_row(
            "SELECT collection_id, folder_id FROM requests WHERE id = ?1",
            params![input.request_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("request not found: {}", e))?;

    tx.query_row(
        "SELECT id FROM collections WHERE id = ?1",
        params![input.target_collection_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|e| format!("target collection not found: {}", e))?;

    if let Some(target_folder_id) = &input.target_folder_id {
        let folder_collection_id: String = tx
            .query_row(
                "SELECT collection_id FROM request_folders WHERE id = ?1",
                params![target_folder_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("target folder not found: {}", e))?;
        if folder_collection_id != input.target_collection_id {
            return Err("target folder is not in target collection".to_string());
        }
    }

    if let Some(before_request_id) = &input.before_request_id {
        let (before_collection_id, before_folder_id): (String, Option<String>) = tx
            .query_row(
                "SELECT collection_id, folder_id FROM requests WHERE id = ?1",
                params![before_request_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| format!("before request not found: {}", e))?;
        if before_collection_id != input.target_collection_id {
            return Err("before request is not in target collection".to_string());
        }
        if before_folder_id != input.target_folder_id {
            return Err("before request is not in target folder".to_string());
        }
    }

    tx.execute(
        "UPDATE requests SET collection_id = ?1, folder_id = ?2, updated_at = datetime('now') WHERE id = ?3",
        params![input.target_collection_id, input.target_folder_id, input.request_id],
    )
    .map_err(|e| e.to_string())?;

    if source_collection_id != input.target_collection_id || source_folder_id != input.target_folder_id {
        reindex_children_in_parent(&tx, &source_collection_id, source_folder_id.as_deref(), None)?;
    }
    reindex_children_in_parent(
        &tx,
        &input.target_collection_id,
        input.target_folder_id.as_deref(),
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

fn ensure_collection_exists(conn: &rusqlite::Connection, collection_id: &str) -> Result<(), String> {
    conn.query_row(
        "SELECT id FROM collections WHERE id = ?1",
        params![collection_id],
        |row| row.get::<_, String>(0),
    )
    .map(|_| ())
    .map_err(|e| format!("collection not found: {}", e))
}

fn ensure_folder_in_collection(
    conn: &rusqlite::Connection,
    folder_id: &str,
    collection_id: &str,
) -> Result<(), String> {
    let folder_collection_id: String = conn
        .query_row(
            "SELECT collection_id FROM request_folders WHERE id = ?1",
            params![folder_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("folder not found: {}", e))?;

    if folder_collection_id != collection_id {
        return Err("folder is not in target collection".to_string());
    }

    Ok(())
}

fn child_location_by_id(
    tx: &rusqlite::Transaction<'_>,
    item_id: &str,
) -> Result<(String, Option<String>), rusqlite::Error> {
    tx.query_row(
        "SELECT collection_id, folder_id FROM requests WHERE id = ?1",
        params![item_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .or_else(|_| {
        tx.query_row(
            "SELECT collection_id, parent_folder_id FROM request_folders WHERE id = ?1",
            params![item_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
    })
}

fn is_descendant_folder(
    tx: &rusqlite::Transaction<'_>,
    candidate_folder_id: &str,
    ancestor_folder_id: &str,
) -> Result<bool, String> {
    let mut current = Some(candidate_folder_id.to_string());
    while let Some(folder_id) = current {
        if folder_id == ancestor_folder_id {
            return Ok(true);
        }
        current = tx
            .query_row(
                "SELECT parent_folder_id FROM request_folders WHERE id = ?1",
                params![folder_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(false)
}

fn update_descendant_collection_ids(
    tx: &rusqlite::Transaction<'_>,
    folder_id: &str,
    collection_id: &str,
) -> Result<(), String> {
    tx.execute(
        "UPDATE requests SET collection_id = ?1, updated_at = datetime('now') WHERE folder_id = ?2",
        params![collection_id, folder_id],
    )
    .map_err(|e| e.to_string())?;

    let child_folder_ids = tx
        .prepare("SELECT id FROM request_folders WHERE parent_folder_id = ?1")
        .map_err(|e| e.to_string())?
        .query_map(params![folder_id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    for child_folder_id in child_folder_ids {
        tx.execute(
            "UPDATE request_folders SET collection_id = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![collection_id, child_folder_id],
        )
        .map_err(|e| e.to_string())?;
        update_descendant_collection_ids(tx, &child_folder_id, collection_id)?;
    }

    Ok(())
}

fn parent_clause(parent_folder_id: Option<&str>) -> &'static str {
    if parent_folder_id.is_some() {
        "folder_id = ?2"
    } else {
        "folder_id IS NULL"
    }
}

fn update_request_parent_clause(parent_folder_id: Option<&str>) -> &'static str {
    if parent_folder_id.is_some() {
        "folder_id = ?3"
    } else {
        "folder_id IS NULL"
    }
}

fn update_folder_parent_clause(parent_folder_id: Option<&str>) -> &'static str {
    if parent_folder_id.is_some() {
        "parent_folder_id = ?3"
    } else {
        "parent_folder_id IS NULL"
    }
}

fn folder_parent_clause(parent_folder_id: Option<&str>) -> &'static str {
    if parent_folder_id.is_some() {
        "parent_folder_id = ?2"
    } else {
        "parent_folder_id IS NULL"
    }
}

fn next_child_sort_order(
    conn: &rusqlite::Connection,
    collection_id: &str,
    parent_folder_id: Option<&str>,
) -> Result<i64, String> {
    let request_sql = format!(
        "SELECT COALESCE(MAX(sort_order), -1) FROM requests WHERE collection_id = ?1 AND {}",
        parent_clause(parent_folder_id),
    );
    let folder_sql = format!(
        "SELECT COALESCE(MAX(sort_order), -1) FROM request_folders WHERE collection_id = ?1 AND {}",
        folder_parent_clause(parent_folder_id),
    );

    let request_max: i64 = if let Some(parent_id) = parent_folder_id {
        conn.query_row(&request_sql, params![collection_id, parent_id], |row| row.get(0))
    } else {
        conn.query_row(&request_sql, params![collection_id], |row| row.get(0))
    }
    .map_err(|e| e.to_string())?;

    let folder_max: i64 = if let Some(parent_id) = parent_folder_id {
        conn.query_row(&folder_sql, params![collection_id, parent_id], |row| row.get(0))
    } else {
        conn.query_row(&folder_sql, params![collection_id], |row| row.get(0))
    }
    .map_err(|e| e.to_string())?;

    Ok(std::cmp::max(request_max, folder_max) + 1)
}

fn request_dto_from_row(
    row: &rusqlite::Row<'_>,
    collection_id: &str,
    folder_id: Option<String>,
) -> rusqlite::Result<ApiRequestDto> {
    let params_str: String = row.get(4)?;
    let headers_str: String = row.get(5)?;
    let body_str: String = row.get(6)?;
    let auth_str: String = row.get(7)?;
    let scripts_str: String = row.get(8)?;

    Ok(ApiRequestDto {
        id: row.get(0)?,
        collection_id: collection_id.to_string(),
        folder_id,
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
        auth: serde_json::from_str(&auth_str).unwrap_or_else(|_| default_request_auth()),
        scripts: serde_json::from_str(&scripts_str).unwrap_or_else(|_| default_request_scripts()),
        sort_order: row.get(9)?,
    })
}

fn collection_items_for_parent(
    conn: &rusqlite::Connection,
    collection_id: &str,
    parent_folder_id: Option<&str>,
) -> Result<Vec<CollectionItemDto>, String> {
    let folder_sql = format!(
        "SELECT id, name, sort_order FROM request_folders WHERE collection_id = ?1 AND {} ORDER BY sort_order, created_at",
        folder_parent_clause(parent_folder_id),
    );
    let mut folder_stmt = conn.prepare(&folder_sql).map_err(|e| e.to_string())?;
    let folders: Vec<(String, String, i64)> = if let Some(parent_id) = parent_folder_id {
        folder_stmt
            .query_map(params![collection_id, parent_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    } else {
        folder_stmt
            .query_map(params![collection_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let request_sql = format!(
        "SELECT id, name, method, url, params_json, headers_json, body_json, auth_json, scripts_json, sort_order
         FROM requests WHERE collection_id = ?1 AND {} ORDER BY sort_order, created_at",
        parent_clause(parent_folder_id),
    );
    let mut request_stmt = conn.prepare(&request_sql).map_err(|e| e.to_string())?;
    let folder_id = parent_folder_id.map(str::to_string);
    let requests: Vec<ApiRequestDto> = if let Some(parent_id) = parent_folder_id {
        request_stmt
            .query_map(params![collection_id, parent_id], |row| {
                request_dto_from_row(row, collection_id, folder_id.clone())
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    } else {
        request_stmt
            .query_map(params![collection_id], |row| request_dto_from_row(row, collection_id, None))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let mut items: Vec<(i64, CollectionItemDto)> = Vec::new();
    for (folder_id, name, sort_order) in folders {
        let children = collection_items_for_parent(conn, collection_id, Some(&folder_id))?;
        items.push((
            sort_order,
            CollectionItemDto::Folder(RequestFolderDto {
                id: folder_id,
                collection_id: collection_id.to_string(),
                parent_folder_id: parent_folder_id.map(str::to_string),
                name,
                sort_order,
                children,
            }),
        ));
    }
    for request in requests {
        items.push((request.sort_order, CollectionItemDto::Request(request)));
    }

    items.sort_by_key(|(sort_order, _)| *sort_order);
    Ok(items.into_iter().map(|(_, item)| item).collect())
}

fn child_ids_in_parent(
    tx: &rusqlite::Transaction<'_>,
    collection_id: &str,
    parent_folder_id: Option<&str>,
) -> Result<Vec<String>, String> {
    let request_sql = format!(
        "SELECT id, sort_order, created_at FROM requests WHERE collection_id = ?1 AND {}",
        update_request_parent_clause(parent_folder_id),
    );
    let folder_sql = format!(
        "SELECT id, sort_order, created_at FROM request_folders WHERE collection_id = ?1 AND {}",
        update_folder_parent_clause(parent_folder_id),
    );

    let mut rows: Vec<(String, i64, String)> = Vec::new();
    if let Some(parent_id) = parent_folder_id {
        let mut request_stmt = tx.prepare(&request_sql).map_err(|e| e.to_string())?;
        rows.extend(
            request_stmt
                .query_map(params![collection_id, parent_id, parent_id], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?,
        );
        let mut folder_stmt = tx.prepare(&folder_sql).map_err(|e| e.to_string())?;
        rows.extend(
            folder_stmt
                .query_map(params![collection_id, parent_id, parent_id], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?,
        );
    } else {
        let mut request_stmt = tx.prepare(&request_sql).map_err(|e| e.to_string())?;
        rows.extend(
            request_stmt
                .query_map(params![collection_id], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?,
        );
        let mut folder_stmt = tx.prepare(&folder_sql).map_err(|e| e.to_string())?;
        rows.extend(
            folder_stmt
                .query_map(params![collection_id], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?,
        );
    }

    rows.sort_by(|left, right| {
        left.1
            .cmp(&right.1)
            .then_with(|| left.2.cmp(&right.2))
    });
    Ok(rows.into_iter().map(|(id, _, _)| id).collect())
}

fn reindex_children_in_parent(
    tx: &rusqlite::Transaction<'_>,
    collection_id: &str,
    parent_folder_id: Option<&str>,
    move_spec: Option<(&str, Option<&str>)>,
) -> Result<(), String> {
    let mut ids = child_ids_in_parent(tx, collection_id, parent_folder_id)?;
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
        tx.execute(
            "UPDATE request_folders SET sort_order = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![index as i64, id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}
