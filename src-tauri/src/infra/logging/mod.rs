use log::{Level, LevelFilter, Log, Metadata, Record};
use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
#[cfg(test)]
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

const MAX_LOG_FILE_SIZE: u64 = 5 * 1024 * 1024;
const LOG_FILE_NAME: &str = "far-api.log";
const ROTATED_LOG_FILE_NAME: &str = "far-api.log.old";
const WARN_NOTIFICATION_AUTO_CLOSE_MS: u64 = 6_000;
const ERROR_NOTIFICATION_AUTO_CLOSE_MS: u64 = 9_000;
const ANSI_RESET: &str = "\x1b[0m";
const ANSI_DIM_CYAN: &str = "\x1b[2;36m";
const ANSI_DIM_BLUE: &str = "\x1b[2;34m";
const ANSI_BOLD_BLUE: &str = "\x1b[1;34m";
const ANSI_BOLD_GREEN: &str = "\x1b[1;32m";
const ANSI_BOLD_MAGENTA: &str = "\x1b[1;35m";
const ANSI_BOLD_RED: &str = "\x1b[1;31m";
const ANSI_BOLD_YELLOW: &str = "\x1b[1;33m";
const ANSI_BRIGHT_BLACK: &str = "\x1b[90m";

pub(crate) const BACKEND_LOG_NOTIFICATION_EVENT_NAME: &str = "host://log-notification";

static LOG_FILE_DIR: RwLock<Option<PathBuf>> = RwLock::new(None);
static LOG_NOTIFICATION_SEQUENCE: AtomicU64 = AtomicU64::new(1);

type LogNotificationSink = dyn Fn(BackendLogNotificationEventPayload) + Send + Sync + 'static;
static LOG_NOTIFICATION_SINK: RwLock<Option<Arc<LogNotificationSink>>> = RwLock::new(None);

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendLogNotificationEventPayload {
    pub notification_id: String,
    pub level: String,
    pub title: Option<String>,
    pub message: String,
    pub target: String,
    pub source: String,
    pub auto_close_ms: u64,
    pub progress: Option<u8>,
    pub created_at: u64,
}

#[derive(Debug, Eq, PartialEq)]
struct LogEntryParts {
    timestamp: String,
    level: Level,
    source: &'static str,
    target: String,
    kind: String,
    trace_id: Option<String>,
    command: Option<String>,
    message: String,
}

struct FarApiLogger;

static LOGGER: FarApiLogger = FarApiLogger;

impl Log for FarApiLogger {
    fn enabled(&self, _metadata: &Metadata) -> bool {
        true
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }

        let level = record.level();
        let target = record.target();
        let raw_message = record.args().to_string();
        let entry = build_log_entry(current_timestamp(), level, target, &raw_message);
        let console_line = format_console_log_line(&entry, console_colors_enabled());
        let file_line = format_plain_log_line(&entry);

        write_console_line(level, &console_line);

        if let Some(dir) = current_log_dir() {
            let _ = write_to_log_file(&dir, &file_line);
        }

        if let Some(payload) =
            build_log_notification_payload(level, target, &raw_message, current_unix_ms())
        {
            emit_log_notification(payload);
        }
    }

    fn flush(&self) {}
}

pub fn init() {
    let _ = log::set_logger(&LOGGER).map(|()| log::set_max_level(LevelFilter::Debug));
}

pub fn set_log_file_dir(dir: Option<PathBuf>) {
    if let Some(ref path) = dir {
        if let Err(error) = fs::create_dir_all(path) {
            write_internal_stderr(&format!(
                "[logging] failed to create log directory {}: {error}",
                path.to_string_lossy()
            ));
        }
    }

    if let Ok(mut guard) = LOG_FILE_DIR.write() {
        *guard = dir;
    }
}

pub fn install_tauri_log_notification_sink(app_handle: AppHandle) {
    set_log_notification_sink(Some(Arc::new(move |payload| {
        if let Err(error) = app_handle.emit(BACKEND_LOG_NOTIFICATION_EVENT_NAME, payload) {
            write_internal_stderr(&format!(
                "[logging] failed to emit backend log notification: {error}"
            ));
        }
    })));
}

pub fn set_log_notification_sink(sink: Option<Arc<LogNotificationSink>>) {
    if let Ok(mut guard) = LOG_NOTIFICATION_SINK.write() {
        *guard = sink;
    }
}

#[cfg(test)]
pub fn set_log_notification_capture(
    capture: Option<Arc<Mutex<Vec<BackendLogNotificationEventPayload>>>>,
) {
    match capture {
        Some(capture) => {
            set_log_notification_sink(Some(Arc::new(move |payload| {
                if let Ok(mut guard) = capture.lock() {
                    guard.push(payload);
                }
            })));
        }
        None => set_log_notification_sink(None),
    }
}

fn build_log_entry(
    timestamp: String,
    level: Level,
    target: &str,
    raw_message: &str,
) -> LogEntryParts {
    let target = compact_log_target(target);
    let source = log_source_for_target(&target);
    let parsed = parse_log_message(raw_message, &target);

    LogEntryParts {
        timestamp,
        level,
        source,
        target,
        kind: parsed.kind,
        trace_id: parsed.trace_id,
        command: parsed.command,
        message: parsed.message,
    }
}

fn log_source_for_target(target: &str) -> &'static str {
    if target == "frontend" || target.starts_with("frontend::") {
        "frontend"
    } else {
        "backend"
    }
}

fn compact_log_target(target: &str) -> String {
    target
        .strip_prefix("far_api_lib::")
        .or_else(|| target.strip_prefix("far_api::"))
        .unwrap_or(target)
        .to_string()
}

#[derive(Debug, Eq, PartialEq)]
struct ParsedLogMessage {
    kind: String,
    trace_id: Option<String>,
    command: Option<String>,
    message: String,
}

fn parse_log_message(raw_message: &str, target: &str) -> ParsedLogMessage {
    let mut rest = raw_message.trim_start();
    let mut kind: Option<String> = None;
    let mut trace_id: Option<String> = None;
    let mut command: Option<String> = None;

    loop {
        if let Some((token, next_rest)) = consume_leading_bracket_token(rest) {
            apply_log_token(token, &mut kind, &mut trace_id, &mut command);
            rest = next_rest.trim_start();
            continue;
        }

        if let Some((field_name, field_value, next_rest)) = consume_leading_field(rest) {
            match field_name {
                "trace" | "traceId" | "trace_id" => trace_id = Some(field_value.to_string()),
                "command" => command = Some(field_value.to_string()),
                _ => {}
            }
            rest = next_rest.trim_start();
            continue;
        }

        break;
    }

    ParsedLogMessage {
        kind: kind.unwrap_or_else(|| fallback_log_kind(target)),
        trace_id,
        command,
        message: rest.to_string(),
    }
}

fn consume_leading_bracket_token(message: &str) -> Option<(&str, &str)> {
    let rest = message.strip_prefix('[')?;
    let closing_index = rest.find(']')?;
    let token = &rest[..closing_index];

    if !is_valid_bracket_token(token) {
        return None;
    }

    Some((token, &rest[closing_index + 1..]))
}

fn is_valid_bracket_token(token: &str) -> bool {
    !token.is_empty()
        && token.len() <= 128
        && !token
            .chars()
            .any(|character| character == '[' || character == ']')
}

fn consume_leading_field(message: &str) -> Option<(&str, &str, &str)> {
    let (field, rest) = message.split_once('=')?;
    if !matches!(field, "trace" | "traceId" | "trace_id" | "command") {
        return None;
    }

    let value_end = rest
        .find(char::is_whitespace)
        .unwrap_or_else(|| rest.len());
    let value = &rest[..value_end];
    if value.is_empty() {
        return None;
    }

    Some((field, value, &rest[value_end..]))
}

fn apply_log_token(
    token: &str,
    kind: &mut Option<String>,
    trace_id: &mut Option<String>,
    command: &mut Option<String>,
) {
    if let Some(value) = token.strip_prefix("trace=") {
        if !value.is_empty() {
            *trace_id = Some(value.to_string());
        }
        return;
    }

    if let Some(value) = token
        .strip_prefix("traceId=")
        .or_else(|| token.strip_prefix("trace_id="))
    {
        if !value.is_empty() {
            *trace_id = Some(value.to_string());
        }
        return;
    }

    if let Some(value) = token.strip_prefix("command=") {
        if !value.is_empty() {
            *command = Some(value.to_string());
        }
        return;
    }

    if kind.is_none() && is_valid_log_kind(token) {
        *kind = Some(token.to_string());
    }
}

fn is_valid_log_kind(token: &str) -> bool {
    !token.is_empty()
        && token.len() <= 64
        && !token.chars().any(char::is_whitespace)
        && !token.contains('=')
}

fn fallback_log_kind(target: &str) -> String {
    let last_module_segment = target.rsplit("::").next().unwrap_or(target);
    last_module_segment
        .rsplit('.')
        .next()
        .unwrap_or(last_module_segment)
        .to_string()
}

fn format_plain_log_line(entry: &LogEntryParts) -> String {
    let trace = entry
        .trace_id
        .as_deref()
        .map(|trace_id| format!(" trace={trace_id}"))
        .unwrap_or_default();
    let command = entry
        .command
        .as_deref()
        .map(|command| format!(" command={command}"))
        .unwrap_or_default();

    format!(
        "{} [{:<5}] source={} type={} target={}{}{} {}",
        entry.timestamp,
        entry.level,
        entry.source,
        entry.kind,
        entry.target,
        trace,
        command,
        entry.message
    )
}

fn format_console_log_line(entry: &LogEntryParts, use_color: bool) -> String {
    if !use_color {
        return format_plain_log_line(entry);
    }

    let timestamp = colorize(&entry.timestamp, ANSI_DIM_CYAN);
    let level = colorize(
        &format!("[{:<5}]", entry.level),
        console_level_color(entry.level),
    );
    let source = colorize(
        &format!("source={}", entry.source),
        console_source_color(entry.source),
    );
    let kind = colorize(&format!("type={}", entry.kind), ANSI_BOLD_YELLOW);
    let target = colorize(&format!("target={}", entry.target), ANSI_DIM_BLUE);
    let trace = entry
        .trace_id
        .as_deref()
        .map(|trace_id| {
            format!(
                " {}",
                colorize(&format!("trace={trace_id}"), ANSI_DIM_CYAN)
            )
        })
        .unwrap_or_default();
    let command = entry
        .command
        .as_deref()
        .map(|command| {
            format!(
                " {}",
                colorize(&format!("command={command}"), ANSI_BOLD_BLUE)
            )
        })
        .unwrap_or_default();

    format!(
        "{timestamp} {level} {source} {kind} {target}{trace}{command} {}",
        entry.message
    )
}

fn console_colors_enabled() -> bool {
    std::env::var_os("NO_COLOR").is_none()
        && std::env::var("CLICOLOR")
            .map(|value| value != "0")
            .unwrap_or(true)
}

fn console_level_color(level: Level) -> &'static str {
    match level {
        Level::Error => ANSI_BOLD_RED,
        Level::Warn => ANSI_BOLD_YELLOW,
        Level::Info => ANSI_BOLD_GREEN,
        Level::Debug => ANSI_BOLD_BLUE,
        Level::Trace => ANSI_BRIGHT_BLACK,
    }
}

fn console_source_color(source: &str) -> &'static str {
    match source {
        "frontend" => ANSI_BOLD_MAGENTA,
        _ => ANSI_BOLD_GREEN,
    }
}

fn colorize(text: &str, style: &str) -> String {
    format!("{style}{text}{ANSI_RESET}")
}

pub fn build_log_notification_payload(
    level: Level,
    target: &str,
    message: &str,
    created_at: u64,
) -> Option<BackendLogNotificationEventPayload> {
    let level_text = match level {
        Level::Warn => "warn",
        Level::Error => "error",
        _ => return None,
    };
    let auto_close_ms = if level == Level::Error {
        ERROR_NOTIFICATION_AUTO_CLOSE_MS
    } else {
        WARN_NOTIFICATION_AUTO_CLOSE_MS
    };
    let compact_target = compact_log_target(target);
    let source = if log_source_for_target(&compact_target) == "frontend" {
        "frontend-log"
    } else {
        "backend-log"
    };

    Some(BackendLogNotificationEventPayload {
        notification_id: format!(
            "backend-log-{}",
            LOG_NOTIFICATION_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ),
        level: level_text.to_string(),
        title: None,
        message: message.to_string(),
        target: compact_target,
        source: source.to_string(),
        auto_close_ms,
        progress: None,
        created_at,
    })
}

fn current_log_dir() -> Option<PathBuf> {
    LOG_FILE_DIR.read().ok().and_then(|guard| guard.clone())
}

fn write_to_log_file(dir: &PathBuf, line: &str) -> io::Result<()> {
    let log_file_path = dir.join(LOG_FILE_NAME);

    if let Ok(metadata) = fs::metadata(&log_file_path) {
        if metadata.len() >= MAX_LOG_FILE_SIZE {
            rotate_log_file(dir);
        }
    }

    let mut file: File = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file_path)?;

    writeln!(file, "{line}")
}

fn rotate_log_file(dir: &PathBuf) {
    let current = dir.join(LOG_FILE_NAME);
    let rotated = dir.join(ROTATED_LOG_FILE_NAME);

    let _ = fs::remove_file(&rotated);

    if let Err(error) = fs::rename(&current, &rotated) {
        write_internal_stderr(&format!(
            "[logging] failed to rotate log file {}: {error}",
            current.to_string_lossy()
        ));
    }
}

fn write_console_line(level: Level, line: &str) {
    let write_result = match level {
        Level::Error | Level::Warn => {
            let mut stderr = io::stderr().lock();
            writeln!(stderr, "{line}")
        }
        _ => {
            let mut stdout = io::stdout().lock();
            writeln!(stdout, "{line}")
        }
    };

    if let Err(error) = write_result {
        write_internal_stderr(&format!("[logging] failed to write console log: {error}"));
    }
}

fn emit_log_notification(payload: BackendLogNotificationEventPayload) {
    let sink = LOG_NOTIFICATION_SINK
        .read()
        .ok()
        .and_then(|guard| guard.clone());

    if let Some(sink) = sink {
        sink(payload);
    }
}

fn write_internal_stderr(line: &str) {
    let mut stderr = io::stderr().lock();
    let _ = writeln!(stderr, "{line}");
}

fn current_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let days = secs / 86_400;
    let time_of_day = secs % 86_400;
    let hours = time_of_day / 3_600;
    let minutes = (time_of_day % 3_600) / 60;
    let seconds = time_of_day % 60;
    let (year, month, day) = days_to_date(days);

    format!("{year:04}-{month:02}-{day:02} {hours:02}:{minutes:02}:{seconds:02}")
}

fn current_unix_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn days_to_date(days: u64) -> (u64, u64, u64) {
    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn parses_trace_and_kind_from_existing_backend_message() {
        let entry = build_log_entry(
            "2026-05-26 00:00:00".to_string(),
            Level::Info,
            "far_api_lib::commands",
            "[trace=far-api:create_collection:abc:1] [collections] Created collection id=1",
        );

        assert_eq!(entry.source, "backend");
        assert_eq!(entry.target, "commands");
        assert_eq!(entry.kind, "collections");
        assert_eq!(
            entry.trace_id.as_deref(),
            Some("far-api:create_collection:abc:1")
        );
        assert_eq!(entry.message, "Created collection id=1");
    }

    #[test]
    fn parses_frontend_trace_and_command_fields() {
        let entry = build_log_entry(
            "2026-05-26 00:00:00".to_string(),
            Level::Info,
            "frontend::tauriClient",
            "trace=far-api:create_request:def:2 command=create_request invoke success",
        );

        assert_eq!(entry.source, "frontend");
        assert_eq!(entry.kind, "tauriClient");
        assert_eq!(
            entry.trace_id.as_deref(),
            Some("far-api:create_request:def:2")
        );
        assert_eq!(entry.command.as_deref(), Some("create_request"));
        assert_eq!(entry.message, "invoke success");
    }

    #[test]
    fn formats_plain_line_with_structured_fields() {
        let entry = LogEntryParts {
            timestamp: "2026-05-26 00:00:00".to_string(),
            level: Level::Warn,
            source: "frontend",
            target: "frontend::console".to_string(),
            kind: "console".to_string(),
            trace_id: Some("trace-1".to_string()),
            command: Some("create_request".to_string()),
            message: "probe".to_string(),
        };

        assert_eq!(
            format_plain_log_line(&entry),
            "2026-05-26 00:00:00 [WARN ] source=frontend type=console target=frontend::console trace=trace-1 command=create_request probe"
        );
    }

    #[test]
    fn formats_console_line_with_colored_fields() {
        let entry = LogEntryParts {
            timestamp: "2026-05-26 00:00:00".to_string(),
            level: Level::Error,
            source: "frontend",
            target: "frontend::tauriClient".to_string(),
            kind: "tauriClient".to_string(),
            trace_id: Some("trace-1".to_string()),
            command: Some("create_request".to_string()),
            message: "invoke failed".to_string(),
        };

        let line = format_console_log_line(&entry, true);

        assert!(line.contains(ANSI_DIM_CYAN));
        assert!(line.contains(ANSI_BOLD_RED));
        assert!(line.contains(ANSI_BOLD_MAGENTA));
        assert!(line.contains(ANSI_BOLD_YELLOW));
        assert!(line.contains(ANSI_BOLD_BLUE));
        assert!(line.contains("source=frontend"));
        assert!(line.contains("trace=trace-1"));
        assert!(line.contains("command=create_request"));
        assert!(line.ends_with("invoke failed"));
    }

    #[test]
    fn console_line_without_color_matches_plain_file_line() {
        let entry = LogEntryParts {
            timestamp: "2026-05-26 00:00:00".to_string(),
            level: Level::Debug,
            source: "backend",
            target: "commands".to_string(),
            kind: "collections".to_string(),
            trace_id: None,
            command: None,
            message: "listed".to_string(),
        };

        assert_eq!(
            format_console_log_line(&entry, false),
            format_plain_log_line(&entry)
        );
    }

    #[test]
    fn write_to_log_file_appends_and_rotates() {
        let dir = std::env::temp_dir().join("far-api-log-write-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        write_to_log_file(&dir, "line one").unwrap();
        write_to_log_file(&dir, "line two").unwrap();
        let content = fs::read_to_string(dir.join(LOG_FILE_NAME)).unwrap();
        assert!(content.contains("line one"));
        assert!(content.contains("line two"));

        fs::write(dir.join(LOG_FILE_NAME), "x".repeat(MAX_LOG_FILE_SIZE as usize + 1)).unwrap();
        write_to_log_file(&dir, "after rotate").unwrap();

        assert!(dir.join(ROTATED_LOG_FILE_NAME).exists());
        assert!(fs::read_to_string(dir.join(LOG_FILE_NAME))
            .unwrap()
            .contains("after rotate"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn notification_payload_maps_warn_and_error_sources() {
        let backend = build_log_notification_payload(Level::Error, "commands", "failed", 10)
            .expect("error payload");
        assert_eq!(backend.level, "error");
        assert_eq!(backend.source, "backend-log");
        assert_eq!(backend.auto_close_ms, ERROR_NOTIFICATION_AUTO_CLOSE_MS);

        let frontend =
            build_log_notification_payload(Level::Warn, "frontend::console", "warned", 11)
                .expect("warn payload");
        assert_eq!(frontend.level, "warn");
        assert_eq!(frontend.source, "frontend-log");
        assert_eq!(frontend.auto_close_ms, WARN_NOTIFICATION_AUTO_CLOSE_MS);

        assert!(build_log_notification_payload(Level::Info, "commands", "ok", 12).is_none());
    }

    #[test]
    fn log_notification_capture_collects_payloads() {
        let capture = Arc::new(Mutex::new(Vec::new()));
        set_log_notification_capture(Some(capture.clone()));

        emit_log_notification(BackendLogNotificationEventPayload {
            notification_id: "backend-log-test".to_string(),
            level: "warn".to_string(),
            title: None,
            message: "captured".to_string(),
            target: "frontend::console".to_string(),
            source: "frontend-log".to_string(),
            auto_close_ms: WARN_NOTIFICATION_AUTO_CLOSE_MS,
            progress: None,
            created_at: 42,
        });

        let guard = capture.lock().unwrap();
        assert_eq!(guard.len(), 1);
        assert_eq!(guard[0].message, "captured");
        drop(guard);
        set_log_notification_capture(None);
    }

    #[test]
    fn set_log_file_dir_updates_global_path() {
        let path = Path::new("/tmp/far-api-log-path-test");
        set_log_file_dir(Some(path.to_path_buf()));
        assert_eq!(current_log_dir().as_deref(), Some(path));

        set_log_file_dir(None);
        assert!(current_log_dir().is_none());
    }
}
