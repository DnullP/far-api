const MAX_LOG_LENGTH = 4_000;

export function sanitizeForLog(value: unknown, seen = new WeakSet<object>()): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeForLog(item, seen));
    }

    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack,
        };
    }

    if (!value || typeof value !== "object") {
        return value;
    }

    if (seen.has(value)) {
        return "[circular]";
    }
    seen.add(value);

    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value)) {
        if (isSensitiveKey(key)) {
            result[key] = "[redacted]";
            continue;
        }
        result[key] = sanitizeForLog(entryValue, seen);
    }
    return result;
}

export function safeStringify(value: unknown): string {
    try {
        const serialized = JSON.stringify(sanitizeForLog(value));
        if (serialized === undefined) {
            return String(value);
        }
        return truncateLogText(serialized);
    } catch {
        return truncateLogText(String(value));
    }
}

export function formatErrorForLog(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

function truncateLogText(value: string): string {
    if (value.length <= MAX_LOG_LENGTH) {
        return value;
    }
    return `${value.slice(0, MAX_LOG_LENGTH)}...`;
}

function isSensitiveKey(key: string): boolean {
    return /authorization|cookie|password|secret|token|api[_-]?key/i.test(key);
}
