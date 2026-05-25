import type { AppState } from "../store/appStore";
import type { ApiRequest, KeyValuePair, RequestAuth, RequestBody } from "../types/api";
import { createRequestAuth } from "../types/api";

export interface ResolvedRequest {
    method: ApiRequest["method"];
    url: string;
    headers: Record<string, string>;
    params: { key: string; value: string }[];
    body: RequestBody;
}

export function resolveRequest(request: ApiRequest, state: AppState): ResolvedRequest {
    const resolve = createVariableResolver(state);
    const params = resolvePairs(request.params, resolve);
    const headers = pairsToHeaderRecord(resolvePairs(request.headers, resolve));
    const auth = normalizeRequestAuth(request.auth);

    applyResolvedAuth(auth, headers, params, resolve);

    return {
        method: request.method,
        url: resolve(request.url),
        headers,
        params,
        body: resolveBody(request.body, resolve),
    };
}

export function createVariableResolver(state: AppState): (input: string) => string {
    const variables = new Map<string, string>();
    const env = state.environments.find((item) => item.id === state.activeEnvironmentId);

    for (const variable of env?.variables ?? []) {
        if (variable.enabled && variable.key) {
            variables.set(variable.key, variable.value);
        }
    }

    return (input: string) =>
        input.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (match, key: string) =>
            variables.has(key) ? variables.get(key)! : match,
        );
}

export function normalizeRequestAuth(auth: ApiRequest["auth"] | undefined): RequestAuth {
    return createRequestAuth(auth ?? {});
}

function resolvePairs(
    pairs: KeyValuePair[],
    resolve: (input: string) => string,
): { key: string; value: string }[] {
    return pairs
        .filter((pair) => pair.enabled && pair.key)
        .map((pair) => ({
            key: resolve(pair.key),
            value: resolve(pair.value),
        }))
        .filter((pair) => pair.key);
}

function pairsToHeaderRecord(pairs: { key: string; value: string }[]): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const pair of pairs) {
        headers[pair.key] = pair.value;
    }
    return headers;
}

function applyResolvedAuth(
    auth: RequestAuth,
    headers: Record<string, string>,
    params: { key: string; value: string }[],
    resolve: (input: string) => string,
): void {
    if (auth.type === "bearer") {
        const token = resolve(auth.bearerToken).trim();
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        return;
    }

    if (auth.type === "basic") {
        const username = resolve(auth.basicUsername);
        const password = resolve(auth.basicPassword);
        if (username || password) {
            headers.Authorization = `Basic ${encodeBasicCredential(username, password)}`;
        }
        return;
    }

    if (auth.type === "apiKey") {
        const key = resolve(auth.apiKeyName).trim();
        const value = resolve(auth.apiKeyValue);
        if (!key) {
            return;
        }

        if (auth.apiKeyPlacement === "query") {
            params.push({ key, value });
        } else {
            headers[key] = value;
        }
    }
}

function resolveBody(body: RequestBody, resolve: (input: string) => string): RequestBody {
    return {
        type: body.type,
        json: resolve(body.json),
        raw: resolve(body.raw),
        form: body.form.map((pair) => ({
            ...pair,
            key: resolve(pair.key),
            value: resolve(pair.value),
        })),
    };
}

function encodeBasicCredential(username: string, password: string): string {
    const credential = `${username}:${password}`;
    if (typeof btoa !== "undefined") {
        return btoa(credential);
    }
    return credential;
}
