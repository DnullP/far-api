use crate::app::http::request_app_service;
use crate::shared::http_contracts::{HttpRequestInput, HttpResponseOutput};

pub const HTTP_COMMAND_IDS: &[&str] = &["http_request"];

#[tauri::command]
pub async fn http_request(
    input: HttpRequestInput,
    trace_id: Option<String>,
) -> Result<HttpResponseOutput, String> {
    request_app_service::send_http_request(input, trace_id).await
}
