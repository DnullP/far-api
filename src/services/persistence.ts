/**
 * Frontend service for backend persistence via Tauri invoke.
 * In web-mock mode, these calls hit the mock invoke layer.
 */
import { FAR_API_COMMANDS } from "../api/commandIds";
import { invokeCommand } from "../api/tauriClient";
import { createRequestAuth } from "../types/api";
import type { Collection, ApiRequest, Environment, KeyValuePair, RequestAuth, RequestBody } from "../types/api";

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
    auth?: RequestAuth;
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
        auth: createRequestAuth(r.auth),
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
    const data = await invokeCommand<BackendCollection[]>(FAR_API_COMMANDS.listCollections);
    return data.map(toFrontendCollection);
}

export async function createCollectionApi(name: string): Promise<Collection> {
    const data = await invokeCommand<BackendCollection>(FAR_API_COMMANDS.createCollection, { name });
    return toFrontendCollection(data);
}

export async function deleteCollectionApi(id: string): Promise<void> {
    await invokeCommand<void>(FAR_API_COMMANDS.deleteCollection, { id });
}

export async function renameCollectionApi(id: string, name: string): Promise<void> {
    await invokeCommand<void>(FAR_API_COMMANDS.renameCollection, { id, name });
}

export async function reorderCollectionsApi(collectionIds: string[]): Promise<void> {
    await invokeCommand<void>(FAR_API_COMMANDS.reorderCollections, { collectionIds });
}

/* ---------- Requests ---------- */

export async function createRequestApi(collectionId: string, name: string): Promise<ApiRequest> {
    const data = await invokeCommand<BackendApiRequest>(FAR_API_COMMANDS.createRequest, { collectionId, name });
    return toFrontendRequest(data);
}

export async function updateRequestApi(request: ApiRequest, collectionId: string): Promise<void> {
    await invokeCommand<void>(FAR_API_COMMANDS.updateRequest, {
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
            auth: createRequestAuth(request.auth),
            sortOrder: 0,
        },
    });
}

export async function deleteRequestApi(id: string): Promise<void> {
    await invokeCommand<void>(FAR_API_COMMANDS.deleteRequest, { id });
}

export async function moveRequestApi(input: {
    requestId: string;
    targetCollectionId: string;
    beforeRequestId?: string | null;
}): Promise<void> {
    await invokeCommand<void>(FAR_API_COMMANDS.moveRequest, {
        input: {
            requestId: input.requestId,
            targetCollectionId: input.targetCollectionId,
            beforeRequestId: input.beforeRequestId ?? null,
        },
    });
}

/* ---------- Environments ---------- */

export async function fetchEnvironments(): Promise<Environment[]> {
    const data = await invokeCommand<BackendEnvironment[]>(FAR_API_COMMANDS.listEnvironments);
    return data.map(toFrontendEnvironment);
}

export async function createEnvironmentApi(name: string): Promise<Environment> {
    const data = await invokeCommand<BackendEnvironment>(FAR_API_COMMANDS.createEnvironment, { name });
    return toFrontendEnvironment(data);
}

export async function updateEnvironmentApi(env: Environment): Promise<void> {
    await invokeCommand<void>(FAR_API_COMMANDS.updateEnvironment, { env });
}

export async function deleteEnvironmentApi(id: string): Promise<void> {
    await invokeCommand<void>(FAR_API_COMMANDS.deleteEnvironment, { id });
}

/* ---------- Config ---------- */

export async function getConfig(key: string): Promise<string | null> {
    return invokeCommand<string | null>(FAR_API_COMMANDS.getConfig, { key });
}

export async function setConfig(key: string, value: string): Promise<void> {
    await invokeCommand<void>(FAR_API_COMMANDS.setConfig, { key, value });
}

export async function getAllConfig(): Promise<Array<[string, string]>> {
    return invokeCommand<Array<[string, string]>>(FAR_API_COMMANDS.getAllConfig);
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
    return invokeCommand<string>(FAR_API_COMMANDS.addHistory, {
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
    return invokeCommand<HistoryEntry[]>(FAR_API_COMMANDS.listHistory, {
        limit: limit ?? null,
        offset: offset ?? null,
    });
}

export async function fetchAllHistory(batchSize = 200): Promise<HistoryEntry[]> {
    const entries: HistoryEntry[] = [];
    let offset = 0;

    while (true) {
        const page = await listHistory(batchSize, offset);
        entries.push(...page);

        if (page.length < batchSize) {
            return entries;
        }

        offset += page.length;
    }
}

export async function clearHistory(): Promise<void> {
    await invokeCommand<void>(FAR_API_COMMANDS.clearHistory);
}

export async function deleteHistoryEntry(id: string): Promise<void> {
    await invokeCommand<void>(FAR_API_COMMANDS.deleteHistoryEntry, { id });
}
