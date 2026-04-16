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
                name            TEXT NOT NULL,
                method          TEXT NOT NULL DEFAULT 'GET',
                url             TEXT NOT NULL DEFAULT '',
                params_json     TEXT NOT NULL DEFAULT '[]',
                headers_json    TEXT NOT NULL DEFAULT '[]',
                body_json       TEXT NOT NULL DEFAULT '{\"type\":\"none\",\"json\":\"{}\",\"form\":[],\"raw\":\"\"}',
                sort_order      INTEGER NOT NULL DEFAULT 0,
                created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
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

            CREATE INDEX IF NOT EXISTS idx_requests_collection ON requests(collection_id);
            CREATE INDEX IF NOT EXISTS idx_env_vars_env ON environment_variables(environment_id);
            CREATE INDEX IF NOT EXISTS idx_history_created ON request_history(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_history_request ON request_history(request_id);
            ",
        )?;
        Ok(())
    }
}
