/**
 * @module web-mock/mock/MockApp
 * @description 前端 Mock 测试页：复用主应用组件，不依赖 Tauri 后端。
 *
 * 通过在 window.__TAURI_INTERNALS__ 上挂载 mock invoke，
 * 拦截所有 Tauri 命令：HTTP 请求走 Vite 代理，持久化命令使用内存存储。
 */

import { type ReactNode } from "react";
import App from "../../src/App";

/* ---- In-memory persistence store ---- */

interface MockCollection {
    id: string;
    name: string;
    sortOrder: number;
    items: MockCollectionItem[];
}

type MockCollectionItem = MockFolder | MockRequest;

interface MockFolder {
    type: "folder";
    id: string;
    collectionId: string;
    parentFolderId: string | null;
    name: string;
    sortOrder: number;
    children: MockCollectionItem[];
}

interface MockRequest {
    type: "request";
    id: string;
    collectionId: string;
    folderId: string | null;
    name: string;
    method: string;
    url: string;
    params: unknown[];
    headers: unknown[];
    body: { type: string; json: string; form: unknown[]; raw: string };
    auth: {
        type: string;
        bearerToken: string;
        basicUsername: string;
        basicPassword: string;
        apiKeyName: string;
        apiKeyValue: string;
        apiKeyPlacement: string;
    };
    scripts: {
        preRequest: string;
        postResponse: string;
    };
    sortOrder: number;
}

interface MockEnvironment {
    id: string;
    name: string;
    variables: { id: string; key: string; value: string; enabled: boolean }[];
}

interface MockHistoryEntry {
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

interface MockRunnerReport {
    id: string;
    targetName: string;
    targetKind: string;
    targetId: string;
    collectionId: string;
    folderId: string | null;
    iterations: number;
    totalRequests: number;
    passedTests: number;
    failedTests: number;
    durationMs: number;
    results: unknown[];
    createdAt: string;
}

const mockStore = {
    collections: [] as MockCollection[],
    environments: [] as MockEnvironment[],
    config: new Map<string, string>(),
    history: [] as MockHistoryEntry[],
    runnerReports: [] as MockRunnerReport[],
    _counter: 0,
};

const DEFAULT_ENV_ID = "mock-env-dev";
const DEFAULT_COLLECTION_ID = "mock-col-default";
const DEFAULT_REQUEST_ID = "mock-req-example";

seedMockStore();

function mockId(): string {
    mockStore._counter++;
    return `mock-${Date.now()}-${mockStore._counter}`;
}

function isMockFolder(item: MockCollectionItem): item is MockFolder {
    return item.type === "folder";
}

function findMockFolder(items: MockCollectionItem[], folderId: string): MockFolder | null {
    for (const item of items) {
        if (!isMockFolder(item)) {
            continue;
        }
        if (item.id === folderId) {
            return item;
        }
        const nested = findMockFolder(item.children, folderId);
        if (nested) {
            return nested;
        }
    }

    return null;
}

function takeMockRequest(items: MockCollectionItem[], requestId: string): MockRequest | null {
    const index = items.findIndex((item) => !isMockFolder(item) && item.id === requestId);
    if (index >= 0) {
        return items.splice(index, 1)[0] as MockRequest;
    }

    for (const item of items) {
        if (isMockFolder(item)) {
            const request = takeMockRequest(item.children, requestId);
            if (request) {
                return request;
            }
        }
    }

    return null;
}

function updateMockRequest(items: MockCollectionItem[], request: MockRequest): boolean {
    for (let index = 0; index < items.length; index++) {
        const item = items[index];
        if (isMockFolder(item)) {
            if (updateMockRequest(item.children, request)) {
                request.folderId = item.id;
                return true;
            }
            continue;
        }
        if (item.id === request.id) {
            items[index] = { ...request, type: "request", folderId: item.folderId };
            return true;
        }
    }

    return false;
}

function deleteMockRequest(items: MockCollectionItem[], requestId: string): boolean {
    const index = items.findIndex((item) => !isMockFolder(item) && item.id === requestId);
    if (index >= 0) {
        items.splice(index, 1);
        return true;
    }

    for (const item of items) {
        if (isMockFolder(item) && deleteMockRequest(item.children, requestId)) {
            return true;
        }
    }

    return false;
}

function deleteMockFolder(items: MockCollectionItem[], folderId: string): boolean {
    const index = items.findIndex((item) => isMockFolder(item) && item.id === folderId);
    if (index >= 0) {
        items.splice(index, 1);
        return true;
    }

    for (const item of items) {
        if (isMockFolder(item) && deleteMockFolder(item.children, folderId)) {
            return true;
        }
    }

    return false;
}

function takeMockFolder(items: MockCollectionItem[], folderId: string): MockFolder | null {
    const index = items.findIndex((item) => isMockFolder(item) && item.id === folderId);
    if (index >= 0) {
        return items.splice(index, 1)[0] as MockFolder;
    }

    for (const item of items) {
        if (isMockFolder(item)) {
            const folder = takeMockFolder(item.children, folderId);
            if (folder) {
                return folder;
            }
        }
    }

    return null;
}

function updateMockFolderCollection(folder: MockFolder, collectionId: string, parentFolderId: string | null): void {
    folder.collectionId = collectionId;
    folder.parentFolderId = parentFolderId;
    for (const child of folder.children) {
        child.collectionId = collectionId;
        if (isMockFolder(child)) {
            updateMockFolderCollection(child, collectionId, folder.id);
        } else {
            child.folderId = folder.id;
        }
    }
}

function insertMockRequest(
    collection: MockCollection,
    request: MockRequest,
    folderId: string | null,
    beforeRequestId?: string | null,
): void {
    const targetItems = folderId
        ? findMockFolder(collection.items, folderId)?.children
        : collection.items;
    if (!targetItems) {
        return;
    }
    request.collectionId = collection.id;
    request.folderId = folderId;
    const insertAt = beforeRequestId
        ? targetItems.findIndex((item) => !isMockFolder(item) && item.id === beforeRequestId)
        : -1;
    if (insertAt >= 0) {
        targetItems.splice(insertAt, 0, request);
    } else {
        targetItems.push(request);
    }
    reindexMockItems(targetItems);
}

function insertMockFolder(
    collection: MockCollection,
    folder: MockFolder,
    parentFolderId: string | null,
    beforeItemId?: string | null,
): void {
    const targetItems = parentFolderId
        ? findMockFolder(collection.items, parentFolderId)?.children
        : collection.items;
    if (!targetItems) {
        return;
    }
    updateMockFolderCollection(folder, collection.id, parentFolderId);
    const insertAt = beforeItemId
        ? targetItems.findIndex((item) => item.id === beforeItemId)
        : -1;
    if (insertAt >= 0) {
        targetItems.splice(insertAt, 0, folder);
    } else {
        targetItems.push(folder);
    }
    reindexMockItems(targetItems);
}

function reindexMockItems(items: MockCollectionItem[]): void {
    items.forEach((item, index) => {
        item.sortOrder = index;
    });
}

/* ---- Mock Tauri invoke ---- */

interface HttpRequestInput {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string | null;
}

async function mockHttpRequest(input: HttpRequestInput) {
    const start = performance.now();
    const url = new URL(input.url);
    if (url.hostname === "mock.local") {
        const elapsed = Math.round(performance.now() - start);
        const responseBody = JSON.stringify({
            method: input.method,
            url: input.url,
            path: url.pathname,
            query: Object.fromEntries(url.searchParams.entries()),
            headers: input.headers,
            body: input.body,
        });

        return {
            status: 200,
            status_text: "OK",
            headers: { "content-type": "application/json" },
            body: responseBody,
            time: elapsed,
            size: new TextEncoder().encode(responseBody).length,
        };
    }

    const proxyUrl = `/api-proxy?url=${encodeURIComponent(input.url)}`;

    const res = await fetch(proxyUrl, {
        method: input.method,
        headers: input.headers,
        body: input.body,
    });

    const elapsed = Math.round(performance.now() - start);
    const text = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });

    return {
        status: res.status,
        status_text: res.statusText,
        headers,
        body: text,
        time: elapsed,
        size: new TextEncoder().encode(text).length,
    };
}

async function mockInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
    switch (cmd) {
        case "plugin:window|start_dragging":
            console.info("[mock:window] start_dragging", args);
            return undefined;
        case "http_request":
            return mockHttpRequest(args?.input as HttpRequestInput);
        case "greet":
            return `Hello, ${args?.name ?? "world"}! (mock)`;

        // ---- Collections ----
        case "list_collections":
            return mockStore.collections;
        case "create_collection": {
            const col: MockCollection = { id: mockId(), name: args?.name as string, sortOrder: 0, items: [] };
            mockStore.collections.push(col);
            return col;
        }
        case "delete_collection":
            mockStore.collections = mockStore.collections.filter((c) => c.id !== args?.id);
            return undefined;
        case "rename_collection": {
            const c = mockStore.collections.find((c) => c.id === args?.id);
            if (c) c.name = args?.name as string;
            return undefined;
        }
        case "reorder_collections": {
            const ids = args?.collectionIds as string[];
            const orderById = new Map(ids.map((id, index) => [id, index]));
            mockStore.collections.sort((left, right) =>
                (orderById.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
                (orderById.get(right.id) ?? Number.MAX_SAFE_INTEGER),
            );
            mockStore.collections.forEach((collection, index) => {
                collection.sortOrder = index;
            });
            return undefined;
        }
        case "create_folder": {
            const input = args?.input as {
                collectionId: string;
                parentFolderId?: string | null;
                name: string;
            };
            const folder: MockFolder = {
                type: "folder",
                id: mockId(),
                collectionId: input.collectionId,
                parentFolderId: input.parentFolderId ?? null,
                name: input.name,
                sortOrder: 0,
                children: [],
            };
            const parent = mockStore.collections.find((c) => c.id === input.collectionId);
            const targetItems = input.parentFolderId
                ? parent ? findMockFolder(parent.items, input.parentFolderId)?.children : null
                : parent?.items;
            targetItems?.push(folder);
            if (targetItems) reindexMockItems(targetItems);
            return folder;
        }
        case "rename_folder": {
            for (const collection of mockStore.collections) {
                const folder = findMockFolder(collection.items, args?.id as string);
                if (folder) {
                    folder.name = args?.name as string;
                    break;
                }
            }
            return undefined;
        }
        case "delete_folder": {
            for (const collection of mockStore.collections) {
                if (deleteMockFolder(collection.items, args?.id as string)) {
                    break;
                }
            }
            return undefined;
        }
        case "move_folder": {
            const input = args?.input as {
                folderId: string;
                targetCollectionId: string;
                targetParentFolderId?: string | null;
                beforeItemId?: string | null;
            };
            let moving: MockFolder | null = null;
            for (const collection of mockStore.collections) {
                moving = takeMockFolder(collection.items, input.folderId);
                if (moving) {
                    break;
                }
            }
            const target = mockStore.collections.find((collection) => collection.id === input.targetCollectionId);
            if (!moving || !target) {
                return undefined;
            }
            insertMockFolder(target, moving, input.targetParentFolderId ?? null, input.beforeItemId ?? null);
            return undefined;
        }

        // ---- Requests ----
        case "create_request": {
            const req: MockRequest = {
                type: "request",
                id: mockId(),
                collectionId: args?.collectionId as string,
                folderId: (args?.folderId as string | null | undefined) ?? null,
                name: args?.name as string,
                method: "GET",
                url: "",
                params: [],
                headers: [],
                body: { type: "none", json: "{}", form: [], raw: "" },
                auth: defaultMockAuth(),
                scripts: defaultMockScripts(),
                sortOrder: 0,
            };
            const parent = mockStore.collections.find((c) => c.id === req.collectionId);
            if (parent) {
                insertMockRequest(parent, req, req.folderId, null);
            }
            return req;
        }
        case "update_request": {
            const r = args?.request as MockRequest;
            for (const collection of mockStore.collections) {
                if (updateMockRequest(collection.items, r)) {
                    break;
                }
            }
            return undefined;
        }
        case "delete_request":
            for (const c of mockStore.collections) {
                deleteMockRequest(c.items, args?.id as string);
            }
            return undefined;
        case "move_request": {
            const input = args?.input as {
                requestId: string;
                targetCollectionId: string;
                targetFolderId?: string | null;
                beforeRequestId?: string | null;
            };
            let moving: MockRequest | null = null;
            for (const collection of mockStore.collections) {
                moving = takeMockRequest(collection.items, input.requestId);
                if (moving) {
                    break;
                }
            }
            const target = mockStore.collections.find((collection) => collection.id === input.targetCollectionId);
            if (!moving || !target) {
                return undefined;
            }
            insertMockRequest(target, moving, input.targetFolderId ?? null, input.beforeRequestId);
            return undefined;
        }

        // ---- Environments ----
        case "list_environments":
            return mockStore.environments;
        case "create_environment": {
            const env: MockEnvironment = { id: mockId(), name: args?.name as string, variables: [] };
            mockStore.environments.push(env);
            return env;
        }
        case "update_environment": {
            const e = args?.env as MockEnvironment;
            const idx = mockStore.environments.findIndex((x) => x.id === e.id);
            if (idx >= 0) mockStore.environments[idx] = e;
            return undefined;
        }
        case "delete_environment":
            mockStore.environments = mockStore.environments.filter((e) => e.id !== args?.id);
            return undefined;

        // ---- Config ----
        case "get_config":
            return mockStore.config.get(args?.key as string) ?? null;
        case "set_config":
            mockStore.config.set(args?.key as string, args?.value as string);
            return undefined;
        case "get_all_config":
            return Array.from(mockStore.config.entries());

        // ---- History ----
        case "add_history": {
            const entry = args?.entry as Record<string, unknown>;
            const h: MockHistoryEntry = {
                id: mockId(),
                requestId: (entry.requestId as string) ?? null,
                method: entry.method as string,
                url: entry.url as string,
                requestHeaders: entry.requestHeaders as string,
                requestBody: (entry.requestBody as string) ?? null,
                status: entry.status as number,
                statusText: entry.statusText as string,
                responseHeaders: entry.responseHeaders as string,
                responseBody: (entry.responseBody as string) ?? null,
                timeMs: entry.timeMs as number,
                sizeBytes: entry.sizeBytes as number,
                createdAt: new Date().toISOString(),
            };
            mockStore.history.unshift(h);
            return h.id;
        }
        case "list_history": {
            const limit = (args?.limit as number) ?? 50;
            const offset = (args?.offset as number) ?? 0;
            return mockStore.history.slice(offset, offset + limit);
        }
        case "clear_history":
            mockStore.history = [];
            return undefined;
        case "delete_history_entry":
            mockStore.history = mockStore.history.filter((h) => h.id !== args?.id);
            return undefined;

        // ---- Runner Reports ----
        case "add_runner_report": {
            const report = args?.report as Omit<MockRunnerReport, "id" | "createdAt">;
            const savedReport: MockRunnerReport = {
                ...report,
                id: mockId(),
                folderId: report.folderId ?? null,
                createdAt: new Date().toISOString(),
            };
            mockStore.runnerReports.unshift(savedReport);
            return savedReport;
        }
        case "list_runner_reports": {
            const limit = (args?.limit as number) ?? 20;
            const offset = (args?.offset as number) ?? 0;
            return mockStore.runnerReports.slice(offset, offset + limit);
        }
        case "delete_runner_report":
            mockStore.runnerReports = mockStore.runnerReports.filter((report) => report.id !== args?.id);
            return undefined;

        case "frontend_log": {
            const entry = args?.entry as {
                level: string;
                module: string;
                message: string;
                data?: string;
                traceId?: string;
                command?: string;
                href?: string;
                ts?: number;
            } | undefined;
            if (entry) {
                const tag = `[mock:${entry.module}]`;
                const details = [
                    entry.traceId ? `trace=${entry.traceId}` : "",
                    entry.command ? `command=${entry.command}` : "",
                    entry.data ?? "",
                    entry.href ? `href=${entry.href}` : "",
                    entry.ts ? `ts=${entry.ts}` : "",
                ].filter(Boolean).join(" ");
                switch (entry.level) {
                    case "error": console.error(tag, entry.message, details); break;
                    case "warn":  console.warn(tag, entry.message, details); break;
                    case "debug": console.debug(tag, entry.message, details); break;
                    default:      console.info(tag, entry.message, details);
                }
            }
            return undefined;
        }

        default:
            console.warn(`[web-mock] unhandled invoke: ${cmd}`, args);
            throw new Error(`Mock invoke: command "${cmd}" not implemented`);
    }
}

// 挂载 mock，使 @tauri-apps/api/core 的 invoke() 使用我们的实现
(window as Record<string, unknown>).__TAURI_INTERNALS__ = {
    invoke: mockInvoke,
    metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
    },
    transformCallback: (callback: (payload: unknown) => void) => {
        const id = `_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        (window as Record<string, unknown>)[id] = callback;
        return id;
    },
};

/* ---- Render ---- */

export function MockApp(): ReactNode {
    return <App />;
}

function defaultMockAuth(): MockRequest["auth"] {
    return {
        type: "none",
        bearerToken: "",
        basicUsername: "",
        basicPassword: "",
        apiKeyName: "",
        apiKeyValue: "",
        apiKeyPlacement: "header",
    };
}

function defaultMockScripts(): MockRequest["scripts"] {
    return {
        preRequest: "",
        postResponse: "",
    };
}

function seedMockStore(): void {
    if (mockStore.collections.length > 0) {
        return;
    }

    const request: MockRequest = {
        type: "request",
        id: DEFAULT_REQUEST_ID,
        collectionId: DEFAULT_COLLECTION_ID,
        folderId: null,
        name: "Example Request",
        method: "POST",
        url: "{{base_url}}/anything",
        params: [
            { id: "mock-param-1", key: "from", value: "{{workspace}}", enabled: true },
        ],
        headers: [
            { id: "mock-header-1", key: "X-Trace", value: "{{trace_value}}", enabled: true },
        ],
        body: {
            type: "json",
            json: "{\"env\":\"{{workspace}}\"}",
            form: [],
            raw: "",
        },
        auth: defaultMockAuth(),
        scripts: defaultMockScripts(),
        sortOrder: 0,
    };

    mockStore.collections.push({
        id: DEFAULT_COLLECTION_ID,
        name: "My Collection",
        sortOrder: 0,
        items: [request],
    });
    mockStore.environments.push({
        id: DEFAULT_ENV_ID,
        name: "Development",
        variables: [
            { id: "mock-var-base", key: "base_url", value: "https://mock.local", enabled: true },
            { id: "mock-var-workspace", key: "workspace", value: "dev", enabled: true },
            { id: "mock-var-token", key: "api_token", value: "secret-token", enabled: true },
            { id: "mock-var-trace", key: "trace_value", value: "trace-dev", enabled: true },
        ],
    });
    mockStore.config.set("activeEnvironmentId", DEFAULT_ENV_ID);
}
