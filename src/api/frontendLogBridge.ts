import { FAR_API_COMMANDS } from "./commandIds";
import { invokeCommand } from "./tauriClient";
import type { FrontendLogEntry, FrontendLogLevel } from "./logApi";
import { safeStringify } from "./logSanitizer";

type ConsoleMethod = (...args: unknown[]) => void;
type ConsoleLogLevel = "debug" | "info" | "warn" | "error";

let initialized = false;
let forwarding = false;

const CONSOLE_LEVELS: ConsoleLogLevel[] = ["debug", "info", "warn", "error"];

export function setupFrontendLogBridge(): void {
    if (initialized || typeof console === "undefined") {
        return;
    }
    initialized = true;

    const originals = {
        debug: console.debug.bind(console),
        info: console.info.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
    };

    for (const level of CONSOLE_LEVELS) {
        patchConsoleMethod(level, originals[level]);
    }

    console.info("[frontend-log-bridge] initialized");
}

function patchConsoleMethod(level: ConsoleLogLevel, original: ConsoleMethod): void {
    const wrapped: ConsoleMethod = (...args: unknown[]) => {
        original(...args);

        if (forwarding || shouldSkipConsoleForward(args)) {
            return;
        }

        const entry = buildConsoleLogEntry(level, args);
        forwarding = true;
        try {
            void invokeCommand<void>(FAR_API_COMMANDS.frontendLog, { entry }).catch(() => {
                // Logging must never affect application behavior.
            });
        } finally {
            forwarding = false;
        }
    };

    if (level === "debug") {
        console.debug = wrapped;
    } else if (level === "info") {
        console.info = wrapped;
    } else if (level === "warn") {
        console.warn = wrapped;
    } else {
        console.error = wrapped;
    }
}

export function buildConsoleLogEntry(
    level: FrontendLogLevel,
    args: unknown[],
): FrontendLogEntry {
    const message = stringifyLogArgs(args);
    return {
        level,
        module: "console",
        message,
        href: typeof window === "undefined" ? undefined : window.location.href,
        ts: Date.now(),
    };
}

export function stringifyLogArgs(args: unknown[]): string {
    return formatConsolePlaceholders(args).join(" ");
}

function formatConsolePlaceholders(args: unknown[]): string[] {
    if (args.length === 0 || typeof args[0] !== "string") {
        return args.map((item) => serializeLogArg(item));
    }

    let placeholderIndex = 1;
    const formattedHead = args[0].replace(/%[sdifoO]/g, (placeholder) => {
        if (placeholderIndex >= args.length) {
            return placeholder;
        }

        const replacement = args[placeholderIndex];
        placeholderIndex += 1;
        if (placeholder === "%d" || placeholder === "%i") {
            return String(Number(replacement));
        }
        if (placeholder === "%f") {
            return String(Number.parseFloat(String(replacement)));
        }
        return serializeLogArg(replacement);
    });

    const trailingArgs = args.slice(placeholderIndex).map((item) => serializeLogArg(item));
    return [formattedHead, ...trailingArgs];
}

function serializeLogArg(item: unknown): string {
    if (typeof item === "string") {
        return item;
    }

    return safeStringify(item);
}

function shouldSkipConsoleForward(args: unknown[]): boolean {
    const first = args[0];
    if (typeof first !== "string") {
        return false;
    }

    return first.startsWith("[tauriClient]")
        || first.startsWith("[mock:")
        || first.startsWith("[logger:")
        || first.startsWith("[frontend-log-bridge]");
}
