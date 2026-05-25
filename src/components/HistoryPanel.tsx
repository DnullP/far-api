import { useMemo, useState } from "react";
import type { WorkbenchPanelContext } from "layout-v2";
import { RotateCcw, Search, Trash2, X } from "lucide-react";
import { useAppDispatch, useAppState } from "../store/appStore";
import { clearHistory, deleteHistoryEntry } from "../services/persistence";
import type { HistoryEntry } from "../services/persistence";
import { createRequestAuth, type ApiRequest, type HttpMethod, type KeyValuePair } from "../types/api";
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

function createHistoryReplayRequest(entry: HistoryEntry): ApiRequest {
    const headers = parseHeaderPairs(entry.requestHeaders);
    return {
        id: `history-${entry.id}`,
        name: `${entry.method} ${new URL(entry.url, "http://local.invalid").pathname || entry.url}`,
        method: entry.method as HttpMethod,
        url: entry.url,
        params: [],
        headers,
        body: inferReplayBody(entry.requestBody, headers),
        auth: createRequestAuth(),
    };
}

function parseHeaderPairs(serialized: string): KeyValuePair[] {
    try {
        const headers = JSON.parse(serialized) as Record<string, unknown>;
        const pairs = Object.entries(headers).map(([key, value]) => ({
            id: crypto.randomUUID(),
            key,
            value: String(value),
            enabled: true,
        }));
        return pairs.length > 0 ? pairs : [{ id: crypto.randomUUID(), key: "", value: "", enabled: true }];
    } catch {
        return [{ id: crypto.randomUUID(), key: "", value: "", enabled: true }];
    }
}

function inferReplayBody(requestBody: string | null, headers: KeyValuePair[]): ApiRequest["body"] {
    if (!requestBody) {
        return {
            type: "none",
            json: "{}",
            form: [{ id: crypto.randomUUID(), key: "", value: "", enabled: true }],
            raw: "",
        };
    }

    const contentType = headers
        .find((header) => header.key.toLowerCase() === "content-type")
        ?.value.toLowerCase() ?? "";

    if (contentType.includes("application/json")) {
        return {
            type: "json",
            json: requestBody,
            form: [{ id: crypto.randomUUID(), key: "", value: "", enabled: true }],
            raw: "",
        };
    }

    if (contentType.includes("application/x-www-form-urlencoded")) {
        return {
            type: "form",
            json: "{}",
            form: Array.from(new URLSearchParams(requestBody).entries()).map(([key, value]) => ({
                id: crypto.randomUUID(),
                key,
                value,
                enabled: true,
            })),
            raw: "",
        };
    }

    return {
        type: "raw",
        json: "{}",
        form: [{ id: crypto.randomUUID(), key: "", value: "", enabled: true }],
        raw: requestBody,
    };
}

function entryMatchesQuery(entry: HistoryEntry, query: string): boolean {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
        return true;
    }

    return [
        entry.method,
        entry.url,
        entry.statusText,
        String(entry.status),
        entry.requestHeaders,
        entry.requestBody ?? "",
    ].some((value) => value.toLowerCase().includes(normalized));
}

export function HistoryPanel({ context }: { context?: WorkbenchPanelContext }) {
    const { historyEntries } = useAppState();
    const dispatch = useAppDispatch();
    const [query, setQuery] = useState("");
    const entries = useMemo(
        () => [...historyEntries]
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
            .filter((entry) => entryMatchesQuery(entry, query)),
        [historyEntries, query],
    );
    const hasHistory = historyEntries.length > 0;

    const replayEntry = (entry: HistoryEntry) => {
        const request = createHistoryReplayRequest(entry);
        const tabId = `history-replay-${entry.id}`;
        dispatch({ type: "OPEN_REQUEST", tabId, request });
        context?.openTab({
            id: tabId,
            title: `${request.method} Replay`,
            component: "request-editor",
            params: { tabId, historyId: entry.id },
        });
    };

    const removeEntry = (entry: HistoryEntry) => {
        deleteHistoryEntry(entry.id)
            .then(() => dispatch({ type: "DELETE_HISTORY_ENTRY", entryId: entry.id }))
            .catch((error) => console.error("Failed to delete history entry:", error));
    };

    const clearAll = () => {
        clearHistory()
            .then(() => dispatch({ type: "CLEAR_HISTORY" }))
            .catch((error) => console.error("Failed to clear history:", error));
    };

    return (
        <div className="history-panel">
            <div className="panel-toolbar">
                <span className="panel-title">History</span>
                <button
                    className="toolbar-btn"
                    title="Clear History"
                    disabled={!hasHistory}
                    onClick={clearAll}
                >
                    <Trash2 size={14} />
                </button>
            </div>
            <div className="history-search">
                <Search size={14} />
                <input
                    aria-label="Search history"
                    value={query}
                    placeholder="Search history"
                    onChange={(event) => setQuery(event.target.value)}
                />
                {query && (
                    <button title="Clear Search" onClick={() => setQuery("")}>
                        <X size={14} />
                    </button>
                )}
            </div>
            {!hasHistory ? (
                <div className="history-empty">No request history yet.</div>
            ) : entries.length === 0 ? (
                <div className="history-empty">No history matches your search.</div>
            ) : (
                <div className="history-list">
                    {entries.map((entry) => (
                        <div
                            className="history-entry"
                            key={entry.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => replayEntry(entry)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    replayEntry(entry);
                                }
                            }}
                        >
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
                                <span className="history-actions">
                                    <button
                                        title="Replay Request"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            replayEntry(entry);
                                        }}
                                    >
                                        <RotateCcw size={13} />
                                    </button>
                                    <button
                                        title="Delete History Entry"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            removeEntry(entry);
                                        }}
                                    >
                                        <Trash2 size={13} />
                                    </button>
                                </span>
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
