/** Core type definitions for far-api */

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";

export interface KeyValuePair {
    id: string;
    key: string;
    value: string;
    enabled: boolean;
}

export type BodyType = "none" | "json" | "form" | "raw";

export interface RequestBody {
    type: BodyType;
    json: string;
    form: KeyValuePair[];
    raw: string;
}

export interface ApiRequest {
    id: string;
    name: string;
    method: HttpMethod;
    url: string;
    params: KeyValuePair[];
    headers: KeyValuePair[];
    body: RequestBody;
}

export interface ApiResponse {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    time: number;
    size: number;
}

export interface RequestFolder {
    id: string;
    name: string;
    children: (RequestFolder | ApiRequest)[];
}

export interface Collection {
    id: string;
    name: string;
    items: (RequestFolder | ApiRequest)[];
}

export interface EnvironmentVariable {
    id: string;
    key: string;
    value: string;
    enabled: boolean;
}

export interface Environment {
    id: string;
    name: string;
    variables: EnvironmentVariable[];
}

export function isFolder(item: RequestFolder | ApiRequest): item is RequestFolder {
    return "children" in item;
}

export function createKeyValuePair(key = "", value = ""): KeyValuePair {
    return { id: crypto.randomUUID(), key, value, enabled: true };
}

export function createRequest(name = "New Request"): ApiRequest {
    return {
        id: crypto.randomUUID(),
        name,
        method: "GET",
        url: "",
        params: [createKeyValuePair()],
        headers: [createKeyValuePair()],
        body: { type: "none", json: "{}", form: [createKeyValuePair()], raw: "" },
    };
}

export function createCollection(name = "New Collection"): Collection {
    return { id: crypto.randomUUID(), name, items: [] };
}

export function createEnvironment(name = "New Environment"): Environment {
    return { id: crypto.randomUUID(), name, variables: [{ id: crypto.randomUUID(), key: "", value: "", enabled: true }] };
}

/** Common HTTP header keys for autocomplete */
export const COMMON_HEADERS = [
    "Accept",
    "Accept-Encoding",
    "Accept-Language",
    "Authorization",
    "Cache-Control",
    "Content-Type",
    "Cookie",
    "Host",
    "If-Modified-Since",
    "If-None-Match",
    "Origin",
    "Referer",
    "User-Agent",
    "X-Requested-With",
    "X-Api-Key",
] as const;

export const CONTENT_TYPES = [
    "application/json",
    "application/x-www-form-urlencoded",
    "multipart/form-data",
    "text/plain",
    "text/html",
    "text/xml",
    "application/xml",
] as const;
