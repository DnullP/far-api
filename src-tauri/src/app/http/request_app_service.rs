use crate::shared::http_contracts::{HttpRequestInput, HttpResponseOutput};
use log::{debug, error, info};
use std::collections::HashMap;
use std::time::Instant;

pub async fn send_http_request(
    input: HttpRequestInput,
    trace_id: Option<String>,
) -> Result<HttpResponseOutput, String> {
    let trace = trace_id.as_deref().unwrap_or("none");
    info!(
        "[trace={}] [http] --> {} {} ({} header(s), body={})",
        trace,
        input.method,
        input.url,
        input.headers.len(),
        if input.body.is_some() { "yes" } else { "no" }
    );

    let client = reqwest::Client::new();
    let method = input.method.parse::<reqwest::Method>().map_err(|e| {
        error!("[trace={}] [http] Invalid method '{}': {}", trace, input.method, e);
        e.to_string()
    })?;

    let mut req = client.request(method, &input.url);
    for (key, value) in &input.headers {
        req = req.header(key.as_str(), value.as_str());
    }
    if let Some(body) = input.body {
        debug!("[trace={}] [http] Request body length: {} bytes", trace, body.len());
        req = req.body(body);
    }

    let start = Instant::now();
    let resp = req.send().await.map_err(|e| {
        error!("[trace={}] [http] Request failed for {}: {}", trace, input.url, e);
        e.to_string()
    })?;
    let elapsed = start.elapsed().as_millis() as u64;

    let status = resp.status().as_u16();
    let status_text = resp.status().canonical_reason().unwrap_or("").to_string();
    let mut headers = HashMap::new();
    for (key, value) in resp.headers() {
        if let Ok(header_value) = value.to_str() {
            headers.insert(key.to_string(), header_value.to_string());
        }
    }

    let body = resp.text().await.map_err(|e| {
        error!("[trace={}] [http] Failed to read response body: {}", trace, e);
        e.to_string()
    })?;
    let size = body.len();

    info!(
        "[trace={}] [http] <-- {} {} | {} {} | {}ms | {} bytes",
        trace, input.method, input.url, status, status_text, elapsed, size
    );

    Ok(HttpResponseOutput {
        status,
        status_text,
        headers,
        body,
        time: elapsed,
        size,
    })
}
