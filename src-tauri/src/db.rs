use log::info;
use rusqlite::{Connection, Result};
use std::path::Path;
use std::sync::Mutex;

/// Thread-safe wrapper around a SQLite connection.
pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    /// Open (or create) the database file and run migrations.
    pub fn open(path: &Path) -> Result<Self> {
        info!("[db] opening database at {}", path.display());
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        info!("[db] PRAGMA journal_mode=WAL, foreign_keys=ON");
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        info!("[db] migrations complete");
        Ok(db)
    }

    /// Acquire the connection lock.
    pub fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().expect("db mutex poisoned")
    }

    fn migrate(&self) -> Result<()> {
        let conn = self.conn();
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS collections (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                sort_order  INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS requests (
                id              TEXT PRIMARY KEY,
                collection_id   TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
                folder_id       TEXT REFERENCES request_folders(id) ON DELETE CASCADE,
                name            TEXT NOT NULL,
                method          TEXT NOT NULL DEFAULT 'GET',
                url             TEXT NOT NULL DEFAULT '',
                params_json     TEXT NOT NULL DEFAULT '[]',
                headers_json    TEXT NOT NULL DEFAULT '[]',
                body_json       TEXT NOT NULL DEFAULT '{\"type\":\"none\",\"json\":\"{}\",\"form\":[],\"raw\":\"\"}',
                auth_json       TEXT NOT NULL DEFAULT '{\"type\":\"none\",\"bearerToken\":\"\",\"basicUsername\":\"\",\"basicPassword\":\"\",\"apiKeyName\":\"\",\"apiKeyValue\":\"\",\"apiKeyPlacement\":\"header\"}',
                scripts_json    TEXT NOT NULL DEFAULT '{\"preRequest\":\"\",\"postResponse\":\"\"}',
                sort_order      INTEGER NOT NULL DEFAULT 0,
                created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS request_folders (
                id                  TEXT PRIMARY KEY,
                collection_id       TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
                parent_folder_id    TEXT REFERENCES request_folders(id) ON DELETE CASCADE,
                name                TEXT NOT NULL,
                sort_order          INTEGER NOT NULL DEFAULT 0,
                created_at          TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS environments (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                sort_order  INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS environment_variables (
                id              TEXT PRIMARY KEY,
                environment_id  TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
                key             TEXT NOT NULL DEFAULT '',
                value           TEXT NOT NULL DEFAULT '',
                enabled         INTEGER NOT NULL DEFAULT 1,
                sort_order      INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS config (
                key     TEXT PRIMARY KEY,
                value   TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS request_history (
                id              TEXT PRIMARY KEY,
                request_id      TEXT,
                method          TEXT NOT NULL,
                url             TEXT NOT NULL,
                request_headers TEXT NOT NULL DEFAULT '{}',
                request_body    TEXT,
                status          INTEGER NOT NULL,
                status_text     TEXT NOT NULL DEFAULT '',
                response_headers TEXT NOT NULL DEFAULT '{}',
                response_body   TEXT,
                time_ms         INTEGER NOT NULL DEFAULT 0,
                size_bytes      INTEGER NOT NULL DEFAULT 0,
                created_at      TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS runner_reports (
                id              TEXT PRIMARY KEY,
                target_name     TEXT NOT NULL,
                target_kind     TEXT NOT NULL,
                target_id       TEXT NOT NULL,
                collection_id   TEXT NOT NULL,
                folder_id       TEXT,
                iterations      INTEGER NOT NULL DEFAULT 1,
                total_requests  INTEGER NOT NULL DEFAULT 0,
                passed_tests    INTEGER NOT NULL DEFAULT 0,
                failed_tests    INTEGER NOT NULL DEFAULT 0,
                duration_ms     INTEGER NOT NULL DEFAULT 0,
                results_json    TEXT NOT NULL DEFAULT '[]',
                created_at      TEXT NOT NULL DEFAULT (datetime('now'))
            );
            ",
        )?;
        add_column_if_missing(
            &conn,
            "requests",
            "auth_json",
            "TEXT NOT NULL DEFAULT '{\"type\":\"none\",\"bearerToken\":\"\",\"basicUsername\":\"\",\"basicPassword\":\"\",\"apiKeyName\":\"\",\"apiKeyValue\":\"\",\"apiKeyPlacement\":\"header\"}'",
        )?;
        add_column_if_missing(
            &conn,
            "requests",
            "folder_id",
            "TEXT REFERENCES request_folders(id) ON DELETE CASCADE",
        )?;
        add_column_if_missing(
            &conn,
            "requests",
            "scripts_json",
            "TEXT NOT NULL DEFAULT '{\"preRequest\":\"\",\"postResponse\":\"\"}'",
        )?;
        conn.execute_batch(
            "
            CREATE INDEX IF NOT EXISTS idx_requests_collection ON requests(collection_id);
            CREATE INDEX IF NOT EXISTS idx_requests_folder ON requests(folder_id);
            CREATE INDEX IF NOT EXISTS idx_request_folders_collection ON request_folders(collection_id);
            CREATE INDEX IF NOT EXISTS idx_request_folders_parent ON request_folders(parent_folder_id);
            CREATE INDEX IF NOT EXISTS idx_env_vars_env ON environment_variables(environment_id);
            CREATE INDEX IF NOT EXISTS idx_history_created ON request_history(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_history_request ON request_history(request_id);
            CREATE INDEX IF NOT EXISTS idx_runner_reports_created ON runner_reports(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_runner_reports_target ON runner_reports(target_kind, target_id);
            ",
        )?;
        Ok(())
    }
}

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>>>()?;

    if columns.iter().any(|item| item == column) {
        return Ok(());
    }

    conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {definition};"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_legacy_request_table_before_creating_indexes() {
        let path = std::env::temp_dir().join(format!(
            "far-api-legacy-migration-{}.db",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));

        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "
                CREATE TABLE collections (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE requests (
                    id TEXT PRIMARY KEY,
                    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    method TEXT NOT NULL DEFAULT 'GET',
                    url TEXT NOT NULL DEFAULT '',
                    params_json TEXT NOT NULL DEFAULT '[]',
                    headers_json TEXT NOT NULL DEFAULT '[]',
                    body_json TEXT NOT NULL DEFAULT '{\"type\":\"none\",\"json\":\"{}\",\"form\":[],\"raw\":\"\"}',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                ",
            )
            .unwrap();
        }

        let db = Db::open(&path).unwrap();
        let conn = db.conn();
        assert!(column_exists(&conn, "requests", "folder_id"));
        assert!(column_exists(&conn, "requests", "auth_json"));
        assert!(column_exists(&conn, "requests", "scripts_json"));
        assert!(index_exists(&conn, "idx_requests_folder"));

        drop(conn);
        drop(db);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})")).unwrap();
        let exists = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .any(|item| item.unwrap() == column);
        exists
    }

    fn index_exists(conn: &Connection, index: &str) -> bool {
        conn.query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?1",
            [index],
            |_| Ok(()),
        )
        .is_ok()
    }
}
