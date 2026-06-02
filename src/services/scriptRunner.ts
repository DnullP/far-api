import type { AppState } from "../store/appStore";
import {
    createKeyValuePair,
    createRequestAuth,
    createRequestScripts,
    type ApiRequest,
    type ApiResponse,
    type Environment,
    type EnvironmentVariable,
    type KeyValuePair,
} from "../types/api";
import { logger } from "./logger";

export interface ScriptTestResult {
    name: string;
    passed: boolean;
    error?: string;
}

export interface ScriptConsoleEntry {
    level: "log" | "info" | "warn" | "error";
    message: string;
}

export interface ScriptExecutionResult {
    request: ApiRequest;
    environments: Environment[];
    activeEnvironmentId: string | null;
    variables: Record<string, string>;
    tests: ScriptTestResult[];
    console: ScriptConsoleEntry[];
}

type ScriptPhase = "pre-request" | "post-response";

interface MutableScriptState {
    request: ApiRequest;
    environments: Environment[];
    activeEnvironmentId: string | null;
    variables: Map<string, string>;
    tests: ScriptTestResult[];
    console: ScriptConsoleEntry[];
}

export function runPreRequestScript(request: ApiRequest, state: AppState): ScriptExecutionResult {
    return runRequestScript({
        phase: "pre-request",
        source: request.scripts.preRequest,
        request,
        appState: state,
    });
}

export function runPostResponseScript(
    request: ApiRequest,
    response: ApiResponse,
    state: AppState,
): ScriptExecutionResult {
    return runRequestScript({
        phase: "post-response",
        source: request.scripts.postResponse,
        request,
        response,
        appState: state,
    });
}

function runRequestScript({
    phase,
    source,
    request,
    response,
    appState,
}: {
    phase: ScriptPhase;
    source: string;
    request: ApiRequest;
    response?: ApiResponse;
    appState: AppState;
}): ScriptExecutionResult {
    const mutableState: MutableScriptState = {
        request: cloneRequest(request),
        environments: cloneEnvironments(appState.environments),
        activeEnvironmentId: appState.activeEnvironmentId,
        variables: new Map(),
        tests: [],
        console: [],
    };

    if (!source.trim()) {
        return {
            request: mutableState.request,
            environments: mutableState.environments,
            activeEnvironmentId: mutableState.activeEnvironmentId,
            variables: Object.fromEntries(mutableState.variables.entries()),
            tests: mutableState.tests,
            console: mutableState.console,
        };
    }

    logger.info("scriptRunner", `${phase} script start`, {
        requestId: request.id,
        requestName: request.name,
        phase,
    });

    try {
        const pm = createPmApi(mutableState, response);
        const scriptConsole = createScriptConsole(mutableState);
        const fn = new Function("pm", "console", `"use strict";\n${source}`);
        fn(pm, scriptConsole);
        logger.info("scriptRunner", `${phase} script success`, {
            requestId: request.id,
            phase,
            tests: mutableState.tests.length,
            failedTests: mutableState.tests.filter((test) => !test.passed).length,
        });
    } catch (error) {
        const message = formatScriptError(error);
        mutableState.tests.push({
            name: `${phase} script`,
            passed: false,
            error: message,
        });
        logger.warn("scriptRunner", `${phase} script failed`, {
            requestId: request.id,
            phase,
            error: message,
        });
    }

    return {
        request: mutableState.request,
        environments: mutableState.environments,
        activeEnvironmentId: mutableState.activeEnvironmentId,
        variables: Object.fromEntries(mutableState.variables.entries()),
        tests: mutableState.tests,
        console: mutableState.console,
    };
}

export function stateWithScriptResult(state: AppState, result: ScriptExecutionResult): AppState {
    return {
        ...state,
        environments: result.environments,
        activeEnvironmentId: result.activeEnvironmentId,
    };
}

function createPmApi(state: MutableScriptState, response?: ApiResponse) {
    return {
        request: createPmRequestApi(state),
        response: createPmResponseApi(response),
        environment: createPmEnvironmentApi(state),
        variables: createPmVariableApi(state),
        test(name: string, callback: () => void) {
            try {
                callback();
                state.tests.push({ name, passed: true });
            } catch (error) {
                state.tests.push({ name, passed: false, error: formatScriptError(error) });
            }
        },
        expect(value: unknown) {
            return createExpectation(value);
        },
    };
}

function createPmRequestApi(state: MutableScriptState) {
    return {
        get method() {
            return state.request.method;
        },
        set method(value: string) {
            const method = value.toUpperCase();
            if (["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method)) {
                state.request = { ...state.request, method: method as ApiRequest["method"] };
            }
        },
        get url() {
            return state.request.url;
        },
        set url(value: string) {
            state.request = { ...state.request, url: String(value) };
        },
        headers: createPairListApi(
            () => state.request.headers,
            (headers) => {
                state.request = { ...state.request, headers };
            },
        ),
        params: createPairListApi(
            () => state.request.params,
            (params) => {
                state.request = { ...state.request, params };
            },
        ),
        body: {
            get mode() {
                return state.request.body.type;
            },
            set mode(value: string) {
                if (["none", "json", "form", "raw"].includes(value)) {
                    state.request = {
                        ...state.request,
                        body: { ...state.request.body, type: value as ApiRequest["body"]["type"] },
                    };
                }
            },
            get raw() {
                return state.request.body.raw;
            },
            set raw(value: string) {
                state.request = {
                    ...state.request,
                    body: { ...state.request.body, type: "raw", raw: String(value) },
                };
            },
            get json() {
                return state.request.body.json;
            },
            set json(value: string) {
                state.request = {
                    ...state.request,
                    body: { ...state.request.body, type: "json", json: String(value) },
                };
            },
            update(value: unknown) {
                if (typeof value === "string") {
                    state.request = {
                        ...state.request,
                        body: { ...state.request.body, type: "raw", raw: value },
                    };
                    return;
                }
                state.request = {
                    ...state.request,
                    body: {
                        ...state.request.body,
                        type: "json",
                        json: JSON.stringify(value ?? {}, null, 2),
                    },
                };
            },
        },
    };
}

function createPmResponseApi(response?: ApiResponse) {
    return {
        get code() {
            return response?.status ?? 0;
        },
        get status() {
            return response?.statusText ?? "";
        },
        headers: {
            get(key: string) {
                const normalized = key.toLowerCase();
                const entry = Object.entries(response?.headers ?? {})
                    .find(([header]) => header.toLowerCase() === normalized);
                return entry?.[1];
            },
            all() {
                return Object.entries(response?.headers ?? {}).map(([key, value]) => ({ key, value }));
            },
        },
        text() {
            return response?.body ?? "";
        },
        json() {
            const body = response?.body ?? "";
            return body ? JSON.parse(body) : null;
        },
        responseTime: response?.time ?? 0,
        responseSize: response?.size ?? 0,
    };
}

function createPmEnvironmentApi(state: MutableScriptState) {
    return {
        get(key: string) {
            return activeVariables(state).find((variable) => variable.key === key && variable.enabled)?.value;
        },
        set(key: string, value: unknown) {
            setEnvironmentVariable(state, key, String(value));
        },
        unset(key: string) {
            unsetEnvironmentVariable(state, key);
        },
    };
}

function createPmVariableApi(state: MutableScriptState) {
    return {
        get(key: string) {
            if (state.variables.has(key)) {
                return state.variables.get(key);
            }
            return activeVariables(state).find((variable) => variable.key === key && variable.enabled)?.value;
        },
        set(key: string, value: unknown) {
            state.variables.set(key, String(value));
        },
        unset(key: string) {
            state.variables.delete(key);
        },
    };
}

function createPairListApi(
    getPairs: () => KeyValuePair[],
    setPairs: (pairs: KeyValuePair[]) => void,
) {
    return {
        add(pair: { key?: string; value?: unknown; disabled?: boolean }) {
            const key = pair.key ?? "";
            const value = pair.value === undefined ? "" : String(pair.value);
            setPairs([...getPairs(), { ...createKeyValuePair(key, value), enabled: pair.disabled !== true }]);
        },
        upsert(pair: { key?: string; value?: unknown; disabled?: boolean }) {
            const key = pair.key ?? "";
            const value = pair.value === undefined ? "" : String(pair.value);
            const normalized = key.toLowerCase();
            const pairs = getPairs();
            const index = pairs.findIndex((entry) => entry.key.toLowerCase() === normalized);
            if (index < 0) {
                this.add(pair);
                return;
            }
            setPairs(pairs.map((entry, entryIndex) =>
                entryIndex === index
                    ? { ...entry, key, value, enabled: pair.disabled !== true }
                    : entry,
            ));
        },
        remove(key: string) {
            const normalized = key.toLowerCase();
            setPairs(getPairs().filter((pair) => pair.key.toLowerCase() !== normalized));
        },
        get(key: string) {
            const normalized = key.toLowerCase();
            return getPairs().find((pair) => pair.enabled && pair.key.toLowerCase() === normalized)?.value;
        },
        all() {
            return getPairs().map((pair) => ({ key: pair.key, value: pair.value, enabled: pair.enabled }));
        },
    };
}

function createExpectation(value: unknown) {
    const api = {
        to: {
            equal(expected: unknown) {
                assertCondition(Object.is(value, expected), `expected ${formatValue(value)} to equal ${formatValue(expected)}`);
            },
            include(expected: unknown) {
                assertCondition(
                    typeof value === "string" || Array.isArray(value),
                    `expected ${formatValue(value)} to support include`,
                );
                assertCondition(
                    (value as string | unknown[]).includes(expected as never),
                    `expected ${formatValue(value)} to include ${formatValue(expected)}`,
                );
            },
            be: {
                below(expected: number) {
                    assertCondition(Number(value) < expected, `expected ${formatValue(value)} to be below ${expected}`);
                },
                above(expected: number) {
                    assertCondition(Number(value) > expected, `expected ${formatValue(value)} to be above ${expected}`);
                },
                true() {
                    assertCondition(value === true, `expected ${formatValue(value)} to be true`);
                },
                false() {
                    assertCondition(value === false, `expected ${formatValue(value)} to be false`);
                },
            },
            have: {
                property(key: string, expected?: unknown) {
                    assertCondition(isRecord(value) && key in value, `expected ${formatValue(value)} to have property ${key}`);
                    if (arguments.length > 1) {
                        assertCondition(
                            Object.is((value as Record<string, unknown>)[key], expected),
                            `expected property ${key} to equal ${formatValue(expected)}`,
                        );
                    }
                },
            },
        },
    };
    return api;
}

function createScriptConsole(state: MutableScriptState) {
    const write = (level: ScriptConsoleEntry["level"], values: unknown[]) => {
        const message = values.map(formatValue).join(" ");
        state.console.push({ level, message });
        logger.info("scriptRunner", `console.${level}`, { message });
    };

    return {
        log: (...values: unknown[]) => write("log", values),
        info: (...values: unknown[]) => write("info", values),
        warn: (...values: unknown[]) => write("warn", values),
        error: (...values: unknown[]) => write("error", values),
    };
}

function setEnvironmentVariable(state: MutableScriptState, key: string, value: string): void {
    const env = activeEnvironment(state);
    if (!env) {
        return;
    }

    const existing = env.variables.find((variable) => variable.key === key);
    if (existing) {
        existing.value = value;
        existing.enabled = true;
        return;
    }

    env.variables.push({
        id: crypto.randomUUID(),
        key,
        value,
        enabled: true,
    });
}

function unsetEnvironmentVariable(state: MutableScriptState, key: string): void {
    const env = activeEnvironment(state);
    if (!env) {
        return;
    }
    env.variables = env.variables.filter((variable) => variable.key !== key);
}

function activeEnvironment(state: MutableScriptState): Environment | undefined {
    return state.environments.find((env) => env.id === state.activeEnvironmentId);
}

function activeVariables(state: MutableScriptState): EnvironmentVariable[] {
    return activeEnvironment(state)?.variables ?? [];
}

function cloneRequest(request: ApiRequest): ApiRequest {
    return {
        ...request,
        params: request.params.map((pair) => ({ ...pair })),
        headers: request.headers.map((pair) => ({ ...pair })),
        body: {
            ...request.body,
            form: request.body.form.map((pair) => ({ ...pair })),
        },
        auth: createRequestAuth(request.auth),
        scripts: createRequestScripts(request.scripts),
    };
}

function cloneEnvironments(environments: Environment[]): Environment[] {
    return environments.map((environment) => ({
        ...environment,
        variables: environment.variables.map((variable) => ({ ...variable })),
    }));
}

function assertCondition(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

function formatScriptError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function formatValue(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
