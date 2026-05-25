import { invoke } from "@tauri-apps/api/core";
import { FAR_API_COMMANDS } from "./commandIds";
import type { FarApiCommandId } from "./commandIds";
import { formatErrorForLog, safeStringify, sanitizeForLog } from "./logSanitizer";

let traceCounter = 0;

export async function invokeCommand<T>(
    command: FarApiCommandId,
    args?: Record<string, unknown>,
): Promise<T> {
    if (command === FAR_API_COMMANDS.frontendLog) {
        return invoke<T>(command, args);
    }

    const traceId = createTraceId(command);
    const startedAt = nowMs();
    const invokeArgs = withTraceId(args, traceId);
    emitInvokeTrace("info", "invoke start", {
        traceId,
        command,
        args: sanitizeForLog(args),
    });

    try {
        const result = await invoke<T>(command, invokeArgs);
        emitInvokeTrace("info", "invoke success", {
            traceId,
            command,
            durationMs: Math.round(nowMs() - startedAt),
        });
        return result;
    } catch (error) {
        emitInvokeTrace("error", "invoke failed", {
            traceId,
            command,
            durationMs: Math.round(nowMs() - startedAt),
            error: formatErrorForLog(error),
        });
        throw error;
    }
}

function withTraceId(
    args: Record<string, unknown> | undefined,
    traceId: string,
): Record<string, unknown> {
    return {
        ...(args ?? {}),
        traceId,
    };
}

function createTraceId(command: FarApiCommandId): string {
    traceCounter += 1;
    const timePart = Date.now().toString(36);
    const countPart = traceCounter.toString(36);
    return `far-api:${command}:${timePart}:${countPart}`;
}

function nowMs(): number {
    return typeof performance === "undefined" ? Date.now() : performance.now();
}

function emitInvokeTrace(
    level: "info" | "error",
    message: string,
    data: Record<string, unknown>,
): void {
    const formatted = safeStringify(data);
    const consoleMethod = level === "error" ? console.error : console.info;
    consoleMethod(`[tauriClient] ${message}`, data);

    invoke(FAR_API_COMMANDS.frontendLog, {
        entry: {
            level,
            module: "tauriClient",
            message,
            data: formatted,
            traceId: typeof data.traceId === "string" ? data.traceId : undefined,
            command: typeof data.command === "string" ? data.command : undefined,
            href: typeof window === "undefined" ? undefined : window.location.href,
            ts: Date.now(),
        },
    }).catch(() => {
        // Logging must never change command behavior.
    });
}
