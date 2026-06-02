/**
 * Frontend service for backend persistence via Tauri invoke.
 * In web-mock mode, these calls hit the mock invoke layer.
 */
import { FAR_API_COMMANDS } from "../api/commandIds";
import { invokeCommand } from "../api/tauriClient";
import type { RunnerReport } from "./collectionRunner";
import { createRequestAuth, createRequestScripts } from "../types/api";
import { isFolder } from "../types/api";
import type { Collection, ApiRequest, Environment, KeyValuePair, RequestAuth, RequestBody, RequestFolder, RequestScripts } from "../types/api";

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
    folderId?: string | null;
    name: string;
    method: string;
    url: string;
    params: BackendKeyValuePair[];
    headers: BackendKeyValuePair[];
    body: BackendRequestBody;
    auth?: RequestAuth;
    scripts?: RequestScripts;
    sortOrder: number;
}

interface BackendRequestFolder {
    id: string;
    collectionId: string;
    parentFolderId?: string | null;
    name: string;
    sortOrder: number;
    children: BackendCollectionItem[];
}

type BackendCollectionItem =
    | ({ type: "folder" } & BackendRequestFolder)
    | ({ type: "request" } & BackendApiRequest);

interface BackendCollection {
    id: string;
    name: string;
    sortOrder: number;
    items: BackendCollectionItem[];
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

export interface RunnerReportEntry extends RunnerReport {
    id: string;
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
        scripts: createRequestScripts(r.scripts),
    };
}

function toFrontendCollectionItem(item: BackendCollectionItem): RequestFolder | ApiRequest {
    if (item.type === "folder") {
        return {
            id: item.id,
            name: item.name,
            children: item.children.map(toFrontendCollectionItem),
        };
    }

    return toFrontendRequest(item);
}

function toFrontendCollection(c: BackendCollection): Collection {
    return {
        id: c.id,
        name: c.name,
        items: c.items.map(toFrontendCollectionItem),
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

/* ---------- Folders ---------- */

export async function createFolderApi(input: {
    collectionId: string;
    parentFolderId?: string | null;
    name: string;
}): Promise<RequestFolder> {
    const data = await invokeCommand<BackendRequestFolder>(FAR_API_COMMANDS.createFolder, {
        input: {
            collectionId: input.collectionId,
            parentFolderId: input.parentFolderId ?? null,
            name: input.name,
        },
    });
    return {
        id: data.id,
        name: data.name,
        children: data.children.map(toFrontendCollectionItem),
    };
}

export async function renameFolderApi(id: string, name: string): Promise<void> {
    await invokeCommand<void>(FAR_API_COMMANDS.renameFolder, { id, name });
}

export async function deleteFolderApi(id: string): Promise<void> {
    await invokeCommand<void>(FAR_API_COMMANDS.deleteFolder, { id });
}

export async function moveFolderApi(input: {
    folderId: string;
    targetCollectionId: string;
    targetParentFolderId?: string | null;
    beforeItemId?: string | null;
}): Promise<void> {
    await invokeCommand<void>(FAR_API_COMMANDS.moveFolder, {
        input: {
            folderId: input.folderId,
            targetCollectionId: input.targetCollectionId,
            targetParentFolderId: input.targetParentFolderId ?? null,
            beforeItemId: input.beforeItemId ?? null,
        },
    });
}

/* ---------- Requests ---------- */

export async function createRequestApi(
    collectionId: string,
    name: string,
    folderId?: string | null,
): Promise<ApiRequest> {
    const data = await invokeCommand<BackendApiRequest>(FAR_API_COMMANDS.createRequest, {
        collectionId,
        name,
        folderId: folderId ?? null,
    });
    return toFrontendRequest(data);
}

export async function updateRequestApi(
    request: ApiRequest,
    collectionId: string,
    folderId?: string | null,
): Promise<void> {
    await invokeCommand<void>(FAR_API_COMMANDS.updateRequest, {
        request: {
            id: request.id,
            collectionId,
            folderId: folderId ?? null,
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
            scripts: createRequestScripts(request.scripts),
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
    targetFolderId?: string | null;
    beforeRequestId?: string | null;
}): Promise<void> {
    await invokeCommand<void>(FAR_API_COMMANDS.moveRequest, {
        input: {
            requestId: input.requestId,
            targetCollectionId: input.targetCollectionId,
            targetFolderId: input.targetFolderId ?? null,
            beforeRequestId: input.beforeRequestId ?? null,
        },
    });
}

export function flattenCollectionItems(items: Collection["items"]): ApiRequest[] {
    return items.flatMap((item) =>
        isFolder(item) ? flattenCollectionItems(item.children) : [item],
    );
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

/* ---------- Runner Reports ---------- */

export async function addRunnerReport(report: RunnerReport): Promise<RunnerReportEntry> {
    return invokeCommand<RunnerReportEntry>(FAR_API_COMMANDS.addRunnerReport, { report });
}

export async function listRunnerReports(limit?: number, offset?: number): Promise<RunnerReportEntry[]> {
    return invokeCommand<RunnerReportEntry[]>(FAR_API_COMMANDS.listRunnerReports, {
        limit: limit ?? null,
        offset: offset ?? null,
    });
}

export async function deleteRunnerReport(id: string): Promise<void> {
    await invokeCommand<void>(FAR_API_COMMANDS.deleteRunnerReport, { id });
}
