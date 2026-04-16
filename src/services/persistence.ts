/**
 * Frontend service for backend persistence via Tauri invoke.
 * In web-mock mode, these calls hit the mock invoke layer.
 */
import { invoke } from "@tauri-apps/api/core";
import type { Collection, ApiRequest, Environment, KeyValuePair, RequestBody } from "../types/api";

/* ---------- Backend DTOs ---------- */

interface BackendKeyValuePair {
    id: string;
    key: string;
    value: string;
    enabled: boolean;
}

interface BackendRequestBody {
    type: string;
    json: string;
    form: BackendKeyValuePair[];
    raw: string;
}

interface BackendApiRequest {
    id: string;
    collectionId: string;
    name: string;
    method: string;
    url: string;
    params: BackendKeyValuePair[];
    headers: BackendKeyValuePair[];
    body: BackendRequestBody;
    sortOrder: number;
}

interface BackendCollection {
    id: string;
    name: string;
    sortOrder: number;
    items: BackendApiRequest[];
}

interface BackendEnvironmentVariable {
    id: string;
    key: string;
    value: string;
    enabled: boolean;
}

interface BackendEnvironment {
    id: string;
    name: string;
    variables: BackendEnvironmentVariable[];
}

export interface HistoryEntry {
    id: string;
    requestId: string | null;
    method: string;
    url: string;
    requestHeaders: string;
    requestBody: string | null;
    status: number;
    statusText: string;
    responseHeaders: string;
    responseBody: string | null;
    timeMs: number;
    sizeBytes: number;
    createdAt: string;
}

/* ---------- Converters ---------- */

function toFrontendRequest(r: BackendApiRequest): ApiRequest {
    return {
        id: r.id,
        name: r.name,
        method: r.method as ApiRequest["method"],
        url: r.url,
        params: r.params as KeyValuePair[],
        headers: r.headers as KeyValuePair[],
        body: {
            type: r.body.type as RequestBody["type"],
            json: r.body.json,
            form: r.body.form as KeyValuePair[],
            raw: r.body.raw,
        },
    };
}

function toFrontendCollection(c: BackendCollection): Collection {
    return {
        id: c.id,
        name: c.name,
        items: c.items.map(toFrontendRequest),
    };
}

function toFrontendEnvironment(e: BackendEnvironment): Environment {
    return {
        id: e.id,
        name: e.name,
        variables: e.variables,
    };
}

/* ---------- Collections ---------- */

export async function fetchCollections(): Promise<Collection[]> {
    const data = await invoke<BackendCollection[]>("list_collections");
    return data.map(toFrontendCollection);
}

export async function createCollectionApi(name: string): Promise<Collection> {
    const data = await invoke<BackendCollection>("create_collection", { name });
    return toFrontendCollection(data);
}

export async function deleteCollectionApi(id: string): Promise<void> {
    await invoke("delete_collection", { id });
}

export async function renameCollectionApi(id: string, name: string): Promise<void> {
    await invoke("rename_collection", { id, name });
}

/* ---------- Requests ---------- */

export async function createRequestApi(collectionId: string, name: string): Promise<ApiRequest> {
    const data = await invoke<BackendApiRequest>("create_request", { collectionId, name });
    return toFrontendRequest(data);
}

export async function updateRequestApi(request: ApiRequest, collectionId: string): Promise<void> {
    await invoke("update_request", {
        request: {
            id: request.id,
            collectionId,
            name: request.name,
            method: request.method,
            url: request.url,
            params: request.params,
            headers: request.headers,
            body: {
                type: request.body.type,
                json: request.body.json,
                form: request.body.form,
                raw: request.body.raw,
            },
            sortOrder: 0,
        },
    });
}

export async function deleteRequestApi(id: string): Promise<void> {
    await invoke("delete_request", { id });
}

/* ---------- Environments ---------- */

export async function fetchEnvironments(): Promise<Environment[]> {
    const data = await invoke<BackendEnvironment[]>("list_environments");
    return data.map(toFrontendEnvironment);
}

export async function createEnvironmentApi(name: string): Promise<Environment> {
    const data = await invoke<BackendEnvironment>("create_environment", { name });
    return toFrontendEnvironment(data);
}

export async function updateEnvironmentApi(env: Environment): Promise<void> {
    await invoke("update_environment", { env });
}

export async function deleteEnvironmentApi(id: string): Promise<void> {
    await invoke("delete_environment", { id });
}

/* ---------- Config ---------- */

export async function getConfig(key: string): Promise<string | null> {
    return invoke<string | null>("get_config", { key });
}

export async function setConfig(key: string, value: string): Promise<void> {
    await invoke("set_config", { key, value });
}

export async function getAllConfig(): Promise<Array<[string, string]>> {
    return invoke("get_all_config");
}

/* ---------- History ---------- */

export async function addHistory(entry: {
    requestId?: string;
    method: string;
    url: string;
    requestHeaders: string;
    requestBody?: string;
    status: number;
    statusText: string;
    responseHeaders: string;
    responseBody?: string;
    timeMs: number;
    sizeBytes: number;
}): Promise<string> {
    return invoke<string>("add_history", {
        entry: {
            requestId: entry.requestId ?? null,
            method: entry.method,
            url: entry.url,
            requestHeaders: entry.requestHeaders,
            requestBody: entry.requestBody ?? null,
            status: entry.status,
            statusText: entry.statusText,
            responseHeaders: entry.responseHeaders,
            responseBody: entry.responseBody ?? null,
            timeMs: entry.timeMs,
            sizeBytes: entry.sizeBytes,
        },
    });
}

export async function listHistory(limit?: number, offset?: number): Promise<HistoryEntry[]> {
    return invoke<HistoryEntry[]>("list_history", {
        limit: limit ?? null,
        offset: offset ?? null,
    });
}

export async function clearHistory(): Promise<void> {
    await invoke("clear_history");
}

export async function deleteHistoryEntry(id: string): Promise<void> {
    await invoke("delete_history_entry", { id });
}
