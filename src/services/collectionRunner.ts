import type { AppState } from "../store/appStore";
import { isFolder, type ApiRequest, type ApiResponse, type Collection, type RequestFolder } from "../types/api";
import { sendRequest } from "./httpClient";
import { resolveRequest } from "./requestResolver";
import {
    runPostResponseScript,
    runPreRequestScript,
    stateWithScriptResult,
    type ScriptConsoleEntry,
    type ScriptTestResult,
} from "./scriptRunner";
import { logger } from "./logger";

export type RunnerTarget =
    | { kind: "collection"; collectionId: string }
    | { kind: "folder"; collectionId: string; folderId: string };

export interface RunnerRequestResult {
    requestId: string;
    requestName: string;
    method: ApiRequest["method"];
    url: string;
    iteration: number;
    status: number;
    statusText: string;
    time: number;
    tests: ScriptTestResult[];
    console: ScriptConsoleEntry[];
    error?: string;
}

export interface RunnerReport {
    targetName: string;
    targetKind: RunnerTarget["kind"];
    targetId: string;
    collectionId: string;
    folderId: string | null;
    iterations: number;
    totalRequests: number;
    passedTests: number;
    failedTests: number;
    durationMs: number;
    results: RunnerRequestResult[];
}

export async function runCollectionTarget(
    state: AppState,
    target: RunnerTarget,
    iterations: number,
): Promise<RunnerReport> {
    const startedAt = performance.now();
    const { targetName, requests } = resolveRunnerTarget(state.collections, target);
    const safeIterations = Math.max(1, Math.floor(iterations));
    const results: RunnerRequestResult[] = [];

    logger.info("collectionRunner", "run start", {
        targetKind: target.kind,
        targetName,
        iterations: safeIterations,
        requests: requests.length,
    });

    for (let iteration = 1; iteration <= safeIterations; iteration += 1) {
        for (const request of requests) {
            results.push(await runSingleRequest(state, request, iteration));
        }
    }

    const report = {
        targetName,
        targetKind: target.kind,
        targetId: target.kind === "collection" ? target.collectionId : target.folderId,
        collectionId: target.collectionId,
        folderId: target.kind === "folder" ? target.folderId : null,
        iterations: safeIterations,
        totalRequests: results.length,
        passedTests: results.reduce((total, result) =>
            total + result.tests.filter((test) => test.passed).length, 0),
        failedTests: results.reduce((total, result) =>
            total + result.tests.filter((test) => !test.passed).length + (result.error ? 1 : 0), 0),
        durationMs: Math.round(performance.now() - startedAt),
        results,
    };

    logger.info("collectionRunner", "run complete", {
        targetName,
        totalRequests: report.totalRequests,
        passedTests: report.passedTests,
        failedTests: report.failedTests,
        durationMs: report.durationMs,
    });

    return report;
}

function resolveRunnerTarget(
    collections: Collection[],
    target: RunnerTarget,
): { targetName: string; requests: ApiRequest[] } {
    const collection = collections.find((item) => item.id === target.collectionId);
    if (!collection) {
        throw new Error("Runner target collection was not found.");
    }

    if (target.kind === "collection") {
        return {
            targetName: collection.name,
            requests: collectRequests(collection.items),
        };
    }

    const folder = findFolder(collection.items, target.folderId);
    if (!folder) {
        throw new Error("Runner target folder was not found.");
    }

    return {
        targetName: folder.name,
        requests: collectRequests(folder.children),
    };
}

async function runSingleRequest(
    state: AppState,
    request: ApiRequest,
    iteration: number,
): Promise<RunnerRequestResult> {
    const startedAt = performance.now();

    try {
        const preResult = runPreRequestScript(request, state);
        if (preResult.tests.some((test) => !test.passed)) {
            return failedResult(request, iteration, preResult.tests, preResult.console, "Pre-request script failed.", startedAt);
        }

        const scriptState = stateWithScriptResult(state, preResult);
        const resolved = resolveRequest(preResult.request, scriptState, {
            variables: preResult.variables,
        });
        const response = await sendRequest(resolved);
        const postResult = runPostResponseScript(preResult.request, response, scriptState);
        return responseResult(preResult.request, iteration, response, [
            ...preResult.tests,
            ...postResult.tests,
        ], [
            ...preResult.console,
            ...postResult.console,
        ]);
    } catch (error) {
        return failedResult(
            request,
            iteration,
            [],
            [],
            error instanceof Error ? error.message : String(error),
            startedAt,
        );
    }
}

function responseResult(
    request: ApiRequest,
    iteration: number,
    response: ApiResponse,
    tests: ScriptTestResult[],
    console: ScriptConsoleEntry[],
): RunnerRequestResult {
    return {
        requestId: request.id,
        requestName: request.name,
        method: request.method,
        url: request.url,
        iteration,
        status: response.status,
        statusText: response.statusText,
        time: response.time,
        tests,
        console,
    };
}

function failedResult(
    request: ApiRequest,
    iteration: number,
    tests: ScriptTestResult[],
    console: ScriptConsoleEntry[],
    error: string,
    startedAt: number,
): RunnerRequestResult {
    return {
        requestId: request.id,
        requestName: request.name,
        method: request.method,
        url: request.url,
        iteration,
        status: 0,
        statusText: "Error",
        time: Math.round(performance.now() - startedAt),
        tests,
        console,
        error,
    };
}

function collectRequests(items: Collection["items"]): ApiRequest[] {
    return items.flatMap((item) => isFolder(item) ? collectRequests(item.children) : [item]);
}

function findFolder(items: Collection["items"], folderId: string): RequestFolder | null {
    for (const item of items) {
        if (!isFolder(item)) {
            continue;
        }
        if (item.id === folderId) {
            return item;
        }
        const nested = findFolder(item.children, folderId);
        if (nested) {
            return nested;
        }
    }
    return null;
}
