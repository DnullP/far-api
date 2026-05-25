use serde::Deserialize;

pub const FRONTEND_LOG_COMMAND_IDS: &[&str] = &["frontend_log"];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendLogEntry {
    level: String,
    module: String,
    message: String,
    #[serde(default)]
    data: Option<String>,
    #[serde(default)]
    trace_id: Option<String>,
    #[serde(default)]
    command: Option<String>,
    #[serde(default)]
    href: Option<String>,
    #[serde(default)]
    ts: Option<u64>,
}

fn format_frontend_log(entry: &FrontendLogEntry) -> (String, String) {
    let target = format!("frontend::{}", entry.module);
    (target, format_frontend_log_message(entry))
}

fn format_frontend_log_message(entry: &FrontendLogEntry) -> String {
    let mut prefix_parts = Vec::new();
    if let Some(trace_id) = non_empty(entry.trace_id.as_deref()) {
        prefix_parts.push(format!("trace={trace_id}"));
    }
    if let Some(command) = non_empty(entry.command.as_deref()) {
        prefix_parts.push(format!("command={command}"));
    }

    let mut parts = Vec::new();
    parts.push(entry.message.clone());
    if let Some(data) = non_empty(entry.data.as_deref()) {
        parts.push(format!("data={data}"));
    }
    if let Some(href) = non_empty(entry.href.as_deref()) {
        parts.push(format!("href={href}"));
    }
    if let Some(ts) = entry.ts {
        parts.push(format!("ts={ts}"));
    }

    if prefix_parts.is_empty() {
        parts.join(" | ")
    } else {
        format!("{} {}", prefix_parts.join(" "), parts.join(" | "))
    }
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.and_then(|item| {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

#[tauri::command]
pub fn frontend_log(entry: FrontendLogEntry) {
    let (target, msg) = format_frontend_log(&entry);
    match entry.level.as_str() {
        "error" => log::error!(target: &target, "{}", msg),
        "warn" => log::warn!(target: &target, "{}", msg),
        "debug" => log::debug!(target: &target, "{}", msg),
        "trace" => log::trace!(target: &target, "{}", msg),
        _ => log::info!(target: &target, "{}", msg),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_entry(level: &str, module: &str, message: &str, data: Option<&str>) -> FrontendLogEntry {
        FrontendLogEntry {
            level: level.to_string(),
            module: module.to_string(),
            message: message.to_string(),
            data: data.map(|value| value.to_string()),
            trace_id: None,
            command: None,
            href: None,
            ts: None,
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
        assert_eq!(msg, "save failed | data={\"id\":\"abc\"}");
    }

    #[test]
    fn format_frontend_log_message_with_trace_context() {
        let mut entry = make_entry("info", "tauriClient", "invoke success", Some("{\"durationMs\":1}"));
        entry.trace_id = Some("far-api:create_request:abc:1".to_string());
        entry.command = Some("create_request".to_string());
        entry.href = Some("http://localhost/mock".to_string());
        entry.ts = Some(123);

        let (_, msg) = format_frontend_log(&entry);
        assert_eq!(
            msg,
            "trace=far-api:create_request:abc:1 command=create_request invoke success | data={\"durationMs\":1} | href=http://localhost/mock | ts=123"
        );
    }

    #[test]
    fn frontend_log_entry_deserializes_from_json() {
        let json = r#"{"level":"info","module":"test","message":"hello"}"#;
        let entry: FrontendLogEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.level, "info");
        assert_eq!(entry.module, "test");
        assert_eq!(entry.message, "hello");
        assert!(entry.data.is_none());
        assert!(entry.trace_id.is_none());
    }

    #[test]
    fn frontend_log_entry_deserializes_with_data() {
        let json = r#"{"level":"error","module":"m","message":"fail","data":"details"}"#;
        let entry: FrontendLogEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.data, Some("details".to_string()));
    }

    #[test]
    fn frontend_log_entry_deserializes_with_camel_case_context() {
        let json = r#"{"level":"info","module":"m","message":"ok","traceId":"trace-1","command":"create_request","href":"http://localhost","ts":42}"#;
        let entry: FrontendLogEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.trace_id, Some("trace-1".to_string()));
        assert_eq!(entry.command, Some("create_request".to_string()));
        assert_eq!(entry.href, Some("http://localhost".to_string()));
        assert_eq!(entry.ts, Some(42));
    }
}
