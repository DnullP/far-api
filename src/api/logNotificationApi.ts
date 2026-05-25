import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const BACKEND_LOG_NOTIFICATION_EVENT_NAME = "host://log-notification";

export type BackendLogNotificationLevel = "warn" | "error";
export type BackendLogNotificationSource = "backend-log" | "frontend-log";

export interface BackendLogNotificationEventPayload {
    notificationId: string;
    level: BackendLogNotificationLevel;
    title: string | null;
    message: string;
    target: string;
    source: BackendLogNotificationSource;
    autoCloseMs: number;
    progress: number | null;
    createdAt: number;
}

export async function subscribeBackendLogNotifications(
    handler: (payload: BackendLogNotificationEventPayload) => void,
): Promise<UnlistenFn> {
    if (!isTauriRuntime()) {
        return () => {
            // Browser/mock mode has no native backend log event stream.
        };
    }

    return listen<BackendLogNotificationEventPayload>(
        BACKEND_LOG_NOTIFICATION_EVENT_NAME,
        (event) => {
            handler(event.payload);
        },
    );
}

function isTauriRuntime(): boolean {
    if (typeof window === "undefined") {
        return false;
    }

    const runtimeWindow = window as Window & {
        __TAURI_INTERNALS__?: unknown;
        __TAURI__?: unknown;
    };

    return Boolean(runtimeWindow.__TAURI_INTERNALS__ || runtimeWindow.__TAURI__);
}
