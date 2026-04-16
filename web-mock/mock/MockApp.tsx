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
    items: MockRequest[];
}

interface MockRequest {
    id: string;
    collectionId: string;
    name: string;
    method: string;
    url: string;
    params: unknown[];
    headers: unknown[];
    body: { type: string; json: string; form: unknown[]; raw: string };
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

const mockStore = {
    collections: [] as MockCollection[],
    environments: [] as MockEnvironment[],
    config: new Map<string, string>(),
    history: [] as MockHistoryEntry[],
    _counter: 0,
};

function mockId(): string {
    mockStore._counter++;
    return `mock-${Date.now()}-${mockStore._counter}`;
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

        // ---- Requests ----
        case "create_request": {
            const req: MockRequest = {
                id: mockId(),
                collectionId: args?.collectionId as string,
                name: args?.name as string,
                method: "GET",
                url: "",
                params: [],
                headers: [],
                body: { type: "none", json: "{}", form: [], raw: "" },
                sortOrder: 0,
            };
            const parent = mockStore.collections.find((c) => c.id === req.collectionId);
            parent?.items.push(req);
            return req;
        }
        case "update_request": {
            const r = args?.request as MockRequest;
            const parent = mockStore.collections.find((c) => c.id === r.collectionId);
            if (parent) {
                const idx = parent.items.findIndex((i) => i.id === r.id);
                if (idx >= 0) parent.items[idx] = r;
            }
            return undefined;
        }
        case "delete_request":
            for (const c of mockStore.collections) {
                c.items = c.items.filter((i) => i.id !== args?.id);
            }
            return undefined;

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

        case "frontend_log": {
            const entry = args?.entry as { level: string; module: string; message: string; data?: string } | undefined;
            if (entry) {
                const tag = `[mock:${entry.module}]`;
                switch (entry.level) {
                    case "error": console.error(tag, entry.message, entry.data ?? ""); break;
                    case "warn":  console.warn(tag, entry.message, entry.data ?? ""); break;
                    case "debug": console.debug(tag, entry.message, entry.data ?? ""); break;
                    default:      console.info(tag, entry.message, entry.data ?? "");
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
