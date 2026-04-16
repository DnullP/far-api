import { useMemo } from "react";
import { useAppState } from "../store/appStore";
import type { HistoryEntry } from "../services/persistence";
import "./HistoryPanel.css";

const METHOD_COLORS: Record<string, string> = {
    GET: "#22c55e",
    POST: "#eab308",
    PUT: "#3b82f6",
    PATCH: "#a855f7",
    DELETE: "#ef4444",
    HEAD: "#06b6d4",
    OPTIONS: "#64748b",
};

function getStatusClass(status: number): string {
    if (status >= 200 && status < 300) {
        return "ok";
    }

    if (status >= 400) {
        return "error";
    }

    return "warn";
}

function formatDateTime(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }

    return parsed.toLocaleString();
}

function formatSize(sizeBytes: number): string {
    if (sizeBytes >= 1024) {
        return `${(sizeBytes / 1024).toFixed(1)} KB`;
    }

    return `${sizeBytes} B`;
}

function renderStatus(entry: HistoryEntry): string {
    if (entry.status <= 0) {
        return entry.statusText;
    }

    return `${entry.status} ${entry.statusText}`;
}

export function HistoryPanel() {
    const { historyEntries } = useAppState();
    const entries = useMemo(
        () => [...historyEntries].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
        [historyEntries],
    );

    return (
        <div className="history-panel">
            <div className="panel-toolbar">
                <span className="panel-title">History</span>
            </div>
            {entries.length === 0 ? (
                <div className="history-empty">No request history yet.</div>
            ) : (
                <div className="history-list">
                    {entries.map((entry) => (
                        <div className="history-entry" key={entry.id}>
                            <div className="history-entry-header">
                                <span
                                    className="history-method"
                                    style={{ color: METHOD_COLORS[entry.method] ?? "var(--text-secondary)" }}
                                >
                                    {entry.method}
                                </span>
                                <span className={`history-status ${getStatusClass(entry.status)}`}>
                                    {renderStatus(entry)}
                                </span>
                                <span className="history-timing">{entry.timeMs} ms</span>
                            </div>
                            <div className="history-url">{entry.url}</div>
                            <div className="history-entry-footer">
                                <span>{formatDateTime(entry.createdAt)}</span>
                                <span className="history-size">{formatSize(entry.sizeBytes)}</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}