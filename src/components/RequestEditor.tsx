import { useState, useCallback, useRef, useEffect } from "react";
import type { WorkbenchTabApi } from "layout-v2";
import { type HttpMethod, type BodyType, type ApiRequest, type KeyValuePair } from "../types/api";
import { useAppState, useAppDispatch, interpolateVariables } from "../store/appStore";
import { KeyValueEditor } from "./KeyValueEditor";
import { ResponseViewer } from "./ResponseViewer";
import { sendRequest } from "../services/httpClient";
import { updateRequestApi, addHistory } from "../services/persistence";
import { Send, ChevronDown } from "lucide-react";
import "./RequestEditor.css";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const METHOD_COLORS: Record<HttpMethod, string> = {
    GET: "#22c55e",
    POST: "#eab308",
    PUT: "#3b82f6",
    PATCH: "#a855f7",
    DELETE: "#ef4444",
    HEAD: "#06b6d4",
    OPTIONS: "#64748b",
};

type ReqTab = "params" | "headers" | "body";

interface Props {
    params: Record<string, unknown>;
    api: WorkbenchTabApi;
}

export function RequestEditor({ params, api }: Props) {
    const tabId = params.tabId as string;
    const state = useAppState();
    const dispatch = useAppDispatch();
    const request = state.openRequests[tabId];
    const response = state.responses[tabId] ?? null;
    const loading = state.loadingRequests[tabId] ?? false;

    const [activeTab, setActiveTab] = useState<ReqTab>("params");
    const [methodOpen, setMethodOpen] = useState(false);
    const methodRef = useRef<HTMLDivElement>(null);

    // Resizable split state
    const containerRef = useRef<HTMLDivElement>(null);
    const urlBarRef = useRef<HTMLDivElement>(null);
    const [splitRatio, setSplitRatio] = useState(0.5);
    const isDraggingRef = useRef(false);

    const handleResizePointerDown = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        isDraggingRef.current = true;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }, []);

    const handleResizePointerMove = useCallback((e: React.PointerEvent) => {
        if (!isDraggingRef.current || !containerRef.current || !urlBarRef.current) return;
        const containerRect = containerRef.current.getBoundingClientRect();
        const urlBarHeight = urlBarRef.current.getBoundingClientRect().height;
        const availableHeight = containerRect.height - urlBarHeight;
        if (availableHeight <= 0) return;
        const offsetFromUrlBar = e.clientY - containerRect.top - urlBarHeight;
        const ratio = Math.max(0.15, Math.min(0.85, offsetFromUrlBar / availableHeight));
        setSplitRatio(ratio);
    }, []);

    const handleResizePointerUp = useCallback(() => {
        isDraggingRef.current = false;
    }, []);

    useEffect(() => {
        const onClickOutside = (e: MouseEvent) => {
            if (methodRef.current && !methodRef.current.contains(e.target as Node)) {
                setMethodOpen(false);
            }
        };
        document.addEventListener("mousedown", onClickOutside);
        return () => document.removeEventListener("mousedown", onClickOutside);
    }, []);

    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const updateReq = useCallback(
        (patch: Partial<ApiRequest>) => {
            if (!request) return;

            const nextRequest = { ...request, ...patch };
            dispatch({ type: "UPDATE_REQUEST_BY_ID", requestId: request.id, request: patch });

            if ("method" in patch || "name" in patch) {
                api.setTitle(`${nextRequest.method} ${nextRequest.name}`);
            }

            // Debounced save to backend
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
            }
            saveTimerRef.current = setTimeout(() => {
                // Find which collection this request belongs to
                const col = state.collections.find((c) => c.items.some((item) => item.id === nextRequest.id));
                if (col) {
                    updateRequestApi(nextRequest, col.id).catch((err) =>
                        console.error("Failed to save request:", err),
                    );
                }
            }, 600);
        },
        [api, dispatch, request, state.collections],
    );

    const updateParams = useCallback(
        (pairs: KeyValuePair[]) => updateReq({ params: pairs }),
        [updateReq],
    );
    const updateHeaders = useCallback(
        (pairs: KeyValuePair[]) => updateReq({ headers: pairs }),
        [updateReq],
    );
    const updateBodyForm = useCallback(
        (pairs: KeyValuePair[]) =>
            updateReq({ body: { ...request!.body, form: pairs } }),
        [updateReq, request],
    );

    const handleSend = useCallback(async () => {
        if (!request) return;
        dispatch({ type: "SET_LOADING", tabId, loading: true });
        dispatch({ type: "SET_RESPONSE", tabId, response: null });
        try {
            const resolvedUrl = interpolateVariables(request.url, state);
            const resolvedHeaders: Record<string, string> = {};
            for (const h of request.headers) {
                if (h.enabled && h.key) {
                    resolvedHeaders[interpolateVariables(h.key, state)] =
                        interpolateVariables(h.value, state);
                }
            }
            const result = await sendRequest({
                method: request.method,
                url: resolvedUrl,
                headers: resolvedHeaders,
                params: request.params
                    .filter((p) => p.enabled && p.key)
                    .map((p) => ({
                        key: interpolateVariables(p.key, state),
                        value: interpolateVariables(p.value, state),
                    })),
                body: request.body,
            });
            dispatch({ type: "SET_RESPONSE", tabId, response: result });

            // Record to history (fire-and-forget)
            addHistory({
                requestId: request.id,
                method: request.method,
                url: resolvedUrl,
                requestHeaders: JSON.stringify(resolvedHeaders),
                requestBody: request.body.type !== "none" ? (request.body.json || request.body.raw || "") : undefined,
                status: result.status,
                statusText: result.statusText,
                responseHeaders: JSON.stringify(result.headers),
                responseBody: result.body,
                timeMs: result.time,
                sizeBytes: result.size,
            }).catch(() => {});
        } catch (err) {
            dispatch({
                type: "SET_RESPONSE",
                tabId,
                response: {
                    status: 0,
                    statusText: "Error",
                    headers: {},
                    body: String(err),
                    time: 0,
                    size: 0,
                },
            });
        } finally {
            dispatch({ type: "SET_LOADING", tabId, loading: false });
        }
    }, [request, state, dispatch, tabId]);

    if (!request) {
        return <div className="request-editor-empty">No request loaded</div>;
    }

    return (
        <div
            className="request-editor"
            ref={containerRef}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
        >
            {/* URL bar */}
            <div className="url-bar" ref={urlBarRef}>
                <div className="method-dropdown" ref={methodRef}>
                    <button
                        className="method-trigger"
                        style={{ color: METHOD_COLORS[request.method] }}
                        onClick={() => setMethodOpen((o) => !o)}
                    >
                        {request.method}
                        <ChevronDown size={12} />
                    </button>
                    {methodOpen && (
                        <div className="method-menu">
                            {METHODS.map((m) => (
                                <div
                                    key={m}
                                    className={`method-option${m === request.method ? " selected" : ""}`}
                                    style={{ color: METHOD_COLORS[m] }}
                                    onClick={() => {
                                        updateReq({ method: m });
                                        setMethodOpen(false);
                                    }}
                                >
                                    {m}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <input
                    className="url-input"
                    value={request.url}
                    placeholder="Enter URL or paste cURL..."
                    onChange={(e) => updateReq({ url: e.target.value })}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") handleSend();
                    }}
                />
                <button className="send-btn" onClick={handleSend} disabled={loading}>
                    <Send size={14} />
                    Send
                </button>
            </div>

            {/* Request config tabs */}
            <div className="req-section" style={{ flex: `0 0 ${splitRatio * 100}%` }}>
                <div className="req-tabs">
                    <button
                        className={activeTab === "params" ? "active" : ""}
                        onClick={() => setActiveTab("params")}
                    >
                        Params
                        {request.params.filter((p) => p.enabled && p.key).length > 0 && (
                            <span className="badge">
                                {request.params.filter((p) => p.enabled && p.key).length}
                            </span>
                        )}
                    </button>
                    <button
                        className={activeTab === "headers" ? "active" : ""}
                        onClick={() => setActiveTab("headers")}
                    >
                        Headers
                        {request.headers.filter((h) => h.enabled && h.key).length > 0 && (
                            <span className="badge">
                                {request.headers.filter((h) => h.enabled && h.key).length}
                            </span>
                        )}
                    </button>
                    <button
                        className={activeTab === "body" ? "active" : ""}
                        onClick={() => setActiveTab("body")}
                    >
                        Body
                    </button>
                </div>
                <div className="req-tab-content">
                    {activeTab === "params" && (
                        <KeyValueEditor pairs={request.params} onChange={updateParams} />
                    )}
                    {activeTab === "headers" && (
                        <KeyValueEditor
                            pairs={request.headers}
                            onChange={updateHeaders}
                            showHeaderSuggestions
                        />
                    )}
                    {activeTab === "body" && (
                        <div className="body-editor">
                            <div className="body-type-selector">
                                {(["none", "json", "form", "raw"] as BodyType[]).map((t) => (
                                    <label key={t}>
                                        <input
                                            type="radio"
                                            name={`body-type-${tabId}`}
                                            checked={request.body.type === t}
                                            onChange={() =>
                                                updateReq({ body: { ...request.body, type: t } })
                                            }
                                        />
                                        {t === "none" ? "None" : t === "json" ? "JSON" : t === "form" ? "Form" : "Raw"}
                                    </label>
                                ))}
                            </div>
                            {request.body.type === "json" && (
                                <textarea
                                    className="body-textarea"
                                    value={request.body.json}
                                    placeholder='{ "key": "value" }'
                                    onChange={(e) =>
                                        updateReq({
                                            body: { ...request.body, json: e.target.value },
                                        })
                                    }
                                />
                            )}
                            {request.body.type === "form" && (
                                <KeyValueEditor
                                    pairs={request.body.form}
                                    onChange={updateBodyForm}
                                />
                            )}
                            {request.body.type === "raw" && (
                                <textarea
                                    className="body-textarea"
                                    value={request.body.raw}
                                    placeholder="Raw body content..."
                                    onChange={(e) =>
                                        updateReq({
                                            body: { ...request.body, raw: e.target.value },
                                        })
                                    }
                                />
                            )}
                            {request.body.type === "none" && (
                                <div className="body-none">
                                    This request does not have a body
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Resize handle */}
            <div
                className="resize-handle"
                onPointerDown={handleResizePointerDown}
            />

            {/* Response */}
            <div className="response-section" style={{ flex: 1 }}>
                <ResponseViewer response={response} loading={loading} />
            </div>
        </div>
    );
}
