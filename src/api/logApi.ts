import { FAR_API_COMMANDS } from "./commandIds";
import { invokeCommand } from "./tauriClient";

export type FrontendLogLevel = "error" | "warn" | "info" | "debug" | "trace";

export interface FrontendLogEntry {
    level: FrontendLogLevel;
    module: string;
    message: string;
    data?: string;
    traceId?: string;
    command?: string;
    href?: string;
    ts?: number;
}

export function forwardFrontendLog(entry: FrontendLogEntry): Promise<void> {
    return invokeCommand<void>(FAR_API_COMMANDS.frontendLog, { entry });
}
