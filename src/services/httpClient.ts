import { invoke } from "@tauri-apps/api/core";
import { logger } from "./logger";
import type { HttpMethod, RequestBody } from "../types/api";
import type { ApiResponse } from "../types/api";

interface SendRequestInput {
    method: HttpMethod;
    url: string;
    headers: Record<string, string>;
    params: { key: string; value: string }[];
    body: RequestBody;
}

interface TauriHttpResponse {
    status: number;
    status_text: string;
    headers: Record<string, string>;
    body: string;
    time: number;
    size: number;
}

export async function sendRequest(input: SendRequestInput): Promise<ApiResponse> {
    const { method, url, headers, params, body } = input;

    // Build URL with query params
    let fullUrl: string;
    try {
        const u = new URL(url);
        for (const p of params) {
            u.searchParams.append(p.key, p.value);
        }
        fullUrl = u.toString();
    } catch {
        const qs = params.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join("&");
        fullUrl = qs ? `${url}?${qs}` : url;
    }

    // Build body string
    let bodyStr: string | null = null;
    if (method !== "GET" && method !== "HEAD") {
        switch (body.type) {
            case "json":
                bodyStr = body.json;
                if (!headers["Content-Type"]) {
                    headers["Content-Type"] = "application/json";
                }
                break;
            case "form": {
                const formData = new URLSearchParams();
                for (const p of body.form) {
                    if (p.enabled && p.key) formData.append(p.key, p.value);
                }
                bodyStr = formData.toString();
                if (!headers["Content-Type"]) {
                    headers["Content-Type"] = "application/x-www-form-urlencoded";
                }
                break;
            }
            case "raw":
                bodyStr = body.raw;
                break;
        }
    }

    // Use Tauri command if available, fallback to fetch
    try {
        logger.info('httpClient', `${method} ${fullUrl}`);
        const res = await invoke<TauriHttpResponse>("http_request", {
            input: { method, url: fullUrl, headers, body: bodyStr },
        });
        logger.info('httpClient', `response ${res.status} ${res.status_text} ${res.time}ms`);
        return {
            status: res.status,
            statusText: res.status_text,
            headers: res.headers,
            body: res.body,
            time: res.time,
            size: res.size,
        };
    } catch {
        // Fallback to fetch (for web dev mode)
        logger.debug('httpClient', 'Tauri unavailable, using fetch fallback');
        return fetchFallback(fullUrl, method, headers, bodyStr);
    }
}

async function fetchFallback(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string | null,
): Promise<ApiResponse> {
    const start = performance.now();
    const res = await fetch(url, { method, headers, body });
    const elapsed = Math.round(performance.now() - start);
    const text = await res.text();
    const resHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
        resHeaders[k] = v;
    });
    return {
        status: res.status,
        statusText: res.statusText,
        headers: resHeaders,
        body: text,
        time: elapsed,
        size: new TextEncoder().encode(text).length,
    };
}
