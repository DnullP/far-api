import { useState, useCallback, useRef, useEffect } from "react";
import type { WorkbenchTabApi } from "layout-v2";
import { type HttpMethod, type BodyType, type ApiRequest, type KeyValuePair, type RequestAuth, type Collection } from "../types/api";
import { createRequestAuth, isFolder } from "../types/api";
import { useAppState, useAppDispatch } from "../store/appStore";
import { KeyValueEditor } from "./KeyValueEditor";
import { ResponseViewer } from "./ResponseViewer";
import { sendRequest } from "../services/httpClient";
import { updateRequestApi, addHistory } from "../services/persistence";
import { resolveRequest } from "../services/requestResolver";
import { parseCurlCommand } from "../services/curlImporter";
import {
    runPostResponseScript,
    runPreRequestScript,
    stateWithScriptResult,
    type ScriptExecutionResult,
    type ScriptTestResult,
} from "../services/scriptRunner";
import { Send, ChevronDown, Import, X } from "lucide-react";
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

const CURL_PREFIX_PATTERN = /^\s*(?:curl\s|curl$)/i;

type ReqTab = "params" | "headers" | "auth" | "body" | "scripts";

type CollectionItem = Collection["items"][number];

function findRequestFolderId(items: CollectionItem[], requestId: string): string | null | undefined {
    for (const item of items) {
        if (isFolder(item)) {
            const nested = findRequestFolderId(item.children, requestId);
            if (nested !== undefined) {
                return nested === null ? item.id : nested;
            }
            continue;
        }

        if (item.id === requestId) {
            return null;
        }
    }

    return undefined;
}

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
    const [curlModalOpen, setCurlModalOpen] = useState(false);
    const [curlDraft, setCurlDraft] = useState("");
    const [curlError, setCurlError] = useState("");
    const [scriptResult, setScriptResult] = useState<ScriptExecutionResult | null>(null);
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
                const col = state.collections.find((c) => findRequestFolderId(c.items, nextRequest.id) !== undefined);
                if (col) {
                    updateRequestApi(nextRequest, col.id, findRequestFolderId(col.items, nextRequest.id) ?? null).catch((err) =>
                        console.error("Failed to save request:", err),
                    );
                }
            }, 600);
        },
        [api, dispatch, request, state.collections],
    );

    const importCurl = useCallback(
        (command: string): boolean => {
            if (!request) return false;

            try {
                const parsed = parseCurlCommand(command);
                updateReq(parsed);
                api.setTitle(`${parsed.method} ${request.name}`);
                setCurlError("");
                setCurlModalOpen(false);
                setCurlDraft("");
                return true;
            } catch (error) {
                setCurlError(error instanceof Error ? error.message : "Could not parse cURL command.");
                return false;
            }
        },
        [api, request, updateReq],
    );

    const openCurlModal = useCallback((initialDraft = "") => {
        setCurlDraft(initialDraft);
        setCurlError("");
        setCurlModalOpen(true);
    }, []);

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
    const updateAuth = useCallback(
        (patch: Partial<RequestAuth>) => {
            const currentAuth = createRequestAuth(request?.auth);
            updateReq({ auth: { ...currentAuth, ...patch } });
        },
        [request?.auth, updateReq],
    );

    const updateScripts = useCallback(
        (patch: Partial<ApiRequest["scripts"]>) => {
            const currentScripts = request?.scripts ?? { preRequest: "", postResponse: "" };
            updateReq({ scripts: { ...currentScripts, ...patch } });
        },
        [request?.scripts, updateReq],
    );

    const handleSend = useCallback(async () => {
        if (!request) return;
        dispatch({ type: "SET_LOADING", tabId, loading: true });
        dispatch({ type: "SET_RESPONSE", tabId, response: null });
        setScriptResult(null);
        try {
            const preResult = runPreRequestScript(request, state);
            setScriptResult(preResult);
            if (hasScriptFailures(preResult.tests)) {
                throw new Error(scriptFailureMessage(preResult.tests));
            }

            const scriptState = stateWithScriptResult(state, preResult);
            const resolvedRequest = resolveRequest(preResult.request, scriptState, {
                variables: preResult.variables,
            });
            const result = await sendRequest(resolvedRequest);
            const postResult = runPostResponseScript(preResult.request, result, scriptState);
            setScriptResult({
                request: postResult.request,
                environments: postResult.environments,
                activeEnvironmentId: postResult.activeEnvironmentId,
                variables: { ...preResult.variables, ...postResult.variables },
                tests: [...preResult.tests, ...postResult.tests],
                console: [...preResult.console, ...postResult.console],
            });
            dispatch({ type: "SET_RESPONSE", tabId, response: result });

            // Record to history (fire-and-forget)
            const requestBody = resolvedRequest.body.type === "none"
                ? undefined
                : resolvedRequest.body.type === "json"
                    ? resolvedRequest.body.json
                    : resolvedRequest.body.type === "raw"
                        ? resolvedRequest.body.raw
                        : JSON.stringify(
                            resolvedRequest.body.form
                                .filter((pair) => pair.enabled && pair.key)
                                .map((pair) => ({ key: pair.key, value: pair.value })),
                        );

            addHistory({
                requestId: request.id,
                method: resolvedRequest.method,
                url: resolvedRequest.url,
                requestHeaders: JSON.stringify(resolvedRequest.headers),
                requestBody,
                status: result.status,
                statusText: result.statusText,
                responseHeaders: JSON.stringify(result.headers),
                responseBody: result.body,
                timeMs: result.time,
                sizeBytes: result.size,
            }).then((historyId) => {
                dispatch({
                    type: "ADD_HISTORY_ENTRY",
                    entry: {
                        id: historyId,
                        requestId: request.id,
                        method: resolvedRequest.method,
                        url: resolvedRequest.url,
                        requestHeaders: JSON.stringify(resolvedRequest.headers),
                        requestBody: requestBody ?? null,
                        status: result.status,
                        statusText: result.statusText,
                        responseHeaders: JSON.stringify(result.headers),
                        responseBody: result.body,
                        timeMs: result.time,
                        sizeBytes: result.size,
                        createdAt: new Date().toISOString(),
                    },
                });
            }).catch(() => {});
        } catch (err) {
            const body = err instanceof Error ? err.message : String(err);
            dispatch({
                type: "SET_RESPONSE",
                tabId,
                response: {
                    status: 0,
                    statusText: "Error",
                    headers: {},
                    body,
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
    const auth = createRequestAuth(request.auth);

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
                    onPaste={(event) => {
                        const text = event.clipboardData.getData("text");
                        if (!CURL_PREFIX_PATTERN.test(text)) {
                            return;
                        }

                        event.preventDefault();
                        if (!importCurl(text)) {
                            setCurlDraft(text);
                            setCurlModalOpen(true);
                        }
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") handleSend();
                    }}
                />
                <button
                    className="import-curl-btn"
                    type="button"
                    title="Import cURL"
                    onClick={() => openCurlModal()}
                >
                    <Import size={14} />
                </button>
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
                        className={activeTab === "auth" ? "active" : ""}
                        onClick={() => setActiveTab("auth")}
                    >
                        Auth
                        {auth.type !== "none" && <span className="badge">1</span>}
                    </button>
                    <button
                        className={activeTab === "body" ? "active" : ""}
                        onClick={() => setActiveTab("body")}
                    >
                        Body
                    </button>
                    <button
                        className={activeTab === "scripts" ? "active" : ""}
                        onClick={() => setActiveTab("scripts")}
                    >
                        Scripts
                        {(request.scripts.preRequest.trim() || request.scripts.postResponse.trim()) && (
                            <span className="badge">1</span>
                        )}
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
                    {activeTab === "auth" && (
                        <div className="auth-editor">
                            <div className="auth-row">
                                <label htmlFor={`auth-type-${tabId}`}>Type</label>
                                <select
                                    id={`auth-type-${tabId}`}
                                    aria-label="Auth type"
                                    value={auth.type}
                                    onChange={(event) =>
                                        updateAuth({ type: event.target.value as RequestAuth["type"] })
                                    }
                                >
                                    <option value="none">No Auth</option>
                                    <option value="bearer">Bearer Token</option>
                                    <option value="basic">Basic Auth</option>
                                    <option value="apiKey">API Key</option>
                                </select>
                            </div>
                            {auth.type === "bearer" && (
                                <div className="auth-grid">
                                    <label htmlFor={`auth-bearer-${tabId}`}>Token</label>
                                    <input
                                        id={`auth-bearer-${tabId}`}
                                        aria-label="Bearer token"
                                        value={auth.bearerToken}
                                        placeholder="{{api_token}}"
                                        onChange={(event) =>
                                            updateAuth({ bearerToken: event.target.value })
                                        }
                                    />
                                </div>
                            )}
                            {auth.type === "basic" && (
                                <div className="auth-grid">
                                    <label htmlFor={`auth-basic-username-${tabId}`}>Username</label>
                                    <input
                                        id={`auth-basic-username-${tabId}`}
                                        aria-label="Basic username"
                                        value={auth.basicUsername}
                                        placeholder="{{username}}"
                                        onChange={(event) =>
                                            updateAuth({ basicUsername: event.target.value })
                                        }
                                    />
                                    <label htmlFor={`auth-basic-password-${tabId}`}>Password</label>
                                    <input
                                        id={`auth-basic-password-${tabId}`}
                                        aria-label="Basic password"
                                        type="password"
                                        value={auth.basicPassword}
                                        placeholder="{{password}}"
                                        onChange={(event) =>
                                            updateAuth({ basicPassword: event.target.value })
                                        }
                                    />
                                </div>
                            )}
                            {auth.type === "apiKey" && (
                                <div className="auth-grid">
                                    <label htmlFor={`auth-apikey-name-${tabId}`}>Key</label>
                                    <input
                                        id={`auth-apikey-name-${tabId}`}
                                        aria-label="API key name"
                                        value={auth.apiKeyName}
                                        placeholder="X-API-Key"
                                        onChange={(event) =>
                                            updateAuth({ apiKeyName: event.target.value })
                                        }
                                    />
                                    <label htmlFor={`auth-apikey-value-${tabId}`}>Value</label>
                                    <input
                                        id={`auth-apikey-value-${tabId}`}
                                        aria-label="API key value"
                                        type="password"
                                        value={auth.apiKeyValue}
                                        placeholder="{{api_key}}"
                                        onChange={(event) =>
                                            updateAuth({ apiKeyValue: event.target.value })
                                        }
                                    />
                                    <label htmlFor={`auth-apikey-placement-${tabId}`}>Add to</label>
                                    <select
                                        id={`auth-apikey-placement-${tabId}`}
                                        aria-label="API key placement"
                                        value={auth.apiKeyPlacement}
                                        onChange={(event) =>
                                            updateAuth({
                                                apiKeyPlacement: event.target.value as RequestAuth["apiKeyPlacement"],
                                            })
                                        }
                                    >
                                        <option value="header">Header</option>
                                        <option value="query">Query Param</option>
                                    </select>
                                </div>
                            )}
                            {auth.type === "none" && (
                                <div className="auth-none">This request does not use authentication</div>
                            )}
                        </div>
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
                    {activeTab === "scripts" && (
                        <ScriptEditor
                            preRequest={request.scripts.preRequest}
                            postResponse={request.scripts.postResponse}
                            result={scriptResult}
                            onPreRequestChange={(value) => updateScripts({ preRequest: value })}
                            onPostResponseChange={(value) => updateScripts({ postResponse: value })}
                        />
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
            {curlModalOpen && (
                <CurlImportModal
                    value={curlDraft}
                    error={curlError}
                    onValueChange={(value) => {
                        setCurlDraft(value);
                        if (curlError) {
                            setCurlError("");
                        }
                    }}
                    onCancel={() => {
                        setCurlModalOpen(false);
                        setCurlDraft("");
                        setCurlError("");
                    }}
                    onConfirm={() => importCurl(curlDraft)}
                />
            )}
        </div>
    );
}

function hasScriptFailures(results: ScriptTestResult[]): boolean {
    return results.some((result) => !result.passed);
}

function scriptFailureMessage(results: ScriptTestResult[]): string {
    const firstFailure = results.find((result) => !result.passed);
    return firstFailure?.error ? `Script failed: ${firstFailure.error}` : "Script failed.";
}

function ScriptEditor({
    preRequest,
    postResponse,
    result,
    onPreRequestChange,
    onPostResponseChange,
}: {
    preRequest: string;
    postResponse: string;
    result: ScriptExecutionResult | null;
    onPreRequestChange: (value: string) => void;
    onPostResponseChange: (value: string) => void;
}) {
    return (
        <div className="script-editor">
            <div className="script-grid">
                <label className="script-panel">
                    <span>Pre-request Script</span>
                    <textarea
                        aria-label="Pre-request script"
                        value={preRequest}
                        spellCheck={false}
                        placeholder="pm.request.headers.upsert({ key: 'X-Trace', value: 'trace-dev' });"
                        onChange={(event) => onPreRequestChange(event.target.value)}
                    />
                </label>
                <label className="script-panel">
                    <span>Post-response Script</span>
                    <textarea
                        aria-label="Post-response script"
                        value={postResponse}
                        spellCheck={false}
                        placeholder="pm.test('status is OK', () => pm.expect(pm.response.code).to.equal(200));"
                        onChange={(event) => onPostResponseChange(event.target.value)}
                    />
                </label>
            </div>
            {result && (
                <div className="script-result" aria-live="polite">
                    {result.tests.length > 0 && (
                        <div className="script-tests">
                            {result.tests.map((test, index) => (
                                <div
                                    key={`${test.name}-${index}`}
                                    className={`script-test ${test.passed ? "passed" : "failed"}`}
                                >
                                    <span>{test.passed ? "PASS" : "FAIL"}</span>
                                    <strong>{test.name}</strong>
                                    {test.error && <em>{test.error}</em>}
                                </div>
                            ))}
                        </div>
                    )}
                    {result.console.length > 0 && (
                        <div className="script-console">
                            {result.console.map((entry, index) => (
                                <div key={`${entry.level}-${index}`}>
                                    <span>{entry.level}</span>
                                    <code>{entry.message}</code>
                                </div>
                            ))}
                        </div>
                    )}
                    {result.tests.length === 0 && result.console.length === 0 && (
                        <div className="script-empty-result">Scripts ran without output</div>
                    )}
                </div>
            )}
        </div>
    );
}

function CurlImportModal({
    value,
    error,
    onValueChange,
    onCancel,
    onConfirm,
}: {
    value: string;
    error: string;
    onValueChange: (value: string) => void;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onCancel();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onCancel]);

    return (
        <div className="curl-modal-overlay" onClick={onCancel}>
            <form
                className="curl-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Import cURL"
                onClick={(event) => event.stopPropagation()}
                onSubmit={(event) => {
                    event.preventDefault();
                    onConfirm();
                }}
            >
                <div className="curl-modal-header">
                    <span className="curl-modal-title">Import cURL</span>
                    <button
                        className="curl-modal-close"
                        type="button"
                        aria-label="Close cURL import"
                        onClick={onCancel}
                    >
                        <X size={16} />
                    </button>
                </div>
                <div className="curl-modal-body">
                    <textarea
                        aria-label="cURL command"
                        value={value}
                        autoFocus
                        spellCheck={false}
                        onChange={(event) => onValueChange(event.target.value)}
                    />
                    {error && <div className="curl-modal-error">{error}</div>}
                </div>
                <div className="curl-modal-footer">
                    <button type="button" className="curl-modal-secondary" onClick={onCancel}>
                        Cancel
                    </button>
                    <button type="submit" className="curl-modal-primary">
                        Import
                    </button>
                </div>
            </form>
        </div>
    );
}
