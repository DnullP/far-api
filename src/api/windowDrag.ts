import { getCurrentWindow } from "@tauri-apps/api/window";
import { formatErrorForLog } from "./logSanitizer";

interface WindowDragTestHook {
    startDragging?: (source: string, traceId: string) => void | Promise<void>;
}

interface TauriRuntimeInternals {
    metadata?: {
        currentWindow?: {
            label?: string;
        };
    };
}

type RuntimeWindow = Window & {
    __TAURI_INTERNALS__?: TauriRuntimeInternals;
    __TAURI__?: unknown;
    __FAR_API_WINDOW_DRAG__?: WindowDragTestHook;
};

let traceCounter = 0;

export function isTauriRuntime(): boolean {
    if (typeof window === "undefined") {
        return false;
    }

    const runtimeWindow = window as RuntimeWindow;
    return Boolean(runtimeWindow.__TAURI_INTERNALS__ || runtimeWindow.__TAURI__);
}

export function startWindowDrag(source: string): void {
    if (typeof window === "undefined") {
        return;
    }

    const traceId = createWindowDragTraceId(source);
    const runtimeWindow = window as RuntimeWindow;
    const dragPromise = startNativeWindowDrag(runtimeWindow);
    notifyWindowDragTestHook(runtimeWindow, source, traceId);

    console.info("[windowDrag] start", {
        source,
        traceId,
        native: Boolean(dragPromise),
    });

    dragPromise?.then(() => {
        console.info("[windowDrag] success", { source, traceId });
    }).catch((error: unknown) => {
        console.warn("[windowDrag] failed", {
            source,
            traceId,
            error: formatErrorForLog(error),
        });
    });
}

function startNativeWindowDrag(runtimeWindow: RuntimeWindow): Promise<void> | null {
    if (!canUseNativeWindowDrag(runtimeWindow)) {
        return null;
    }

    try {
        return getCurrentWindow().startDragging();
    } catch (error) {
        console.warn("[windowDrag] failed to start native drag", {
            error: formatErrorForLog(error),
        });
        return null;
    }
}

function canUseNativeWindowDrag(runtimeWindow: RuntimeWindow): boolean {
    return typeof runtimeWindow.__TAURI_INTERNALS__?.metadata?.currentWindow?.label === "string";
}

function notifyWindowDragTestHook(
    runtimeWindow: RuntimeWindow,
    source: string,
    traceId: string,
): void {
    try {
        void runtimeWindow.__FAR_API_WINDOW_DRAG__?.startDragging?.(source, traceId);
    } catch (error) {
        console.warn("[windowDrag] test hook failed", {
            source,
            traceId,
            error: formatErrorForLog(error),
        });
    }
}

function createWindowDragTraceId(source: string): string {
    traceCounter += 1;
    return `far-api:window-drag:${source}:${Date.now().toString(36)}:${traceCounter.toString(36)}`;
}
