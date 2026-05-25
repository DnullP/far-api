import {
    useEffect,
    useRef,
    useState,
    type DragEvent as ReactDragEvent,
    type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import type { WorkbenchPanelContext } from "layout-v2";
import { useAppState, useAppDispatch } from "../store/appStore";
import { type ApiRequest, type Collection, isFolder } from "../types/api";
import {
    createCollectionApi,
    createRequestApi,
    deleteCollectionApi,
    deleteRequestApi,
    moveRequestApi,
    renameCollectionApi,
    reorderCollectionsApi,
    updateRequestApi,
} from "../services/persistence";
import {
    parseApiSpecImportJson,
    type ImportedCollectionDraft,
    type ParsedApiSpecImport,
} from "../services/apiSpecImporter";
import { FileJson, FolderPlus, FolderOpen, Plus, Upload, X } from "lucide-react";
import "./CollectionsPanel.css";

const METHOD_COLORS: Record<string, string> = {
    GET: "#22c55e",
    POST: "#eab308",
    PUT: "#3b82f6",
    PATCH: "#a855f7",
    DELETE: "#ef4444",
    HEAD: "#06b6d4",
    OPTIONS: "#64748b",
};

interface Props {
    context: WorkbenchPanelContext;
}

type CollectionItem = Collection["items"][number];

type ContextMenuState =
    | { kind: "collection"; collectionId: string; x: number; y: number }
    | { kind: "request"; collectionId: string; requestId: string; x: number; y: number };

type DragState =
    | { kind: "collection"; collectionId: string }
    | { kind: "request"; collectionId: string; requestId: string };

type DropTarget =
    | { kind: "collection"; collectionId: string }
    | { kind: "request"; collectionId: string; requestId: string };

type RenameTarget =
    | { kind: "collection"; collectionId: string }
    | { kind: "request"; collectionId: string; requestId: string };

const COLLECTION_TREE_DRAG_TYPE = "application/x-far-api-collection-tree";
const CONTEXT_MENU_WIDTH = 164;
const CONTEXT_MENU_HEIGHT = 84;
const CLICK_COMMIT_DELAY_MS = 110;

function getRequestTabId(requestId: string): string {
    return `req-${requestId}`;
}

function findRequest(items: CollectionItem[], requestId: string): ApiRequest | null {
    for (const item of items) {
        if (isFolder(item)) {
            const nested = findRequest(item.children, requestId);
            if (nested) {
                return nested;
            }
            continue;
        }

        if (item.id === requestId) {
            return item;
        }
    }

    return null;
}

function collectRequestIds(items: CollectionItem[]): string[] {
    return items.flatMap((item) =>
        isFolder(item) ? collectRequestIds(item.children) : [item.id],
    );
}

function clampContextMenuPosition(x: number, y: number) {
    if (typeof window === "undefined") {
        return { left: x, top: y };
    }

    return {
        left: Math.max(8, Math.min(x, window.innerWidth - CONTEXT_MENU_WIDTH - 8)),
        top: Math.max(8, Math.min(y, window.innerHeight - CONTEXT_MENU_HEIGHT - 8)),
    };
}

function moveIdBefore(ids: string[], sourceId: string, targetId: string): string[] {
    if (sourceId === targetId) {
        return ids;
    }

    const withoutSource = ids.filter((id) => id !== sourceId);
    const targetIndex = withoutSource.indexOf(targetId);
    if (targetIndex < 0) {
        return ids;
    }

    return [
        ...withoutSource.slice(0, targetIndex),
        sourceId,
        ...withoutSource.slice(targetIndex),
    ];
}

function buildDragImage(label: string): HTMLElement | null {
    if (typeof document === "undefined") {
        return null;
    }

    const preview = document.createElement("div");
    preview.className = "collection-drag-preview";
    preview.textContent = label;
    document.body.appendChild(preview);
    window.setTimeout(() => preview.remove(), 0);
    return preview;
}

interface CollectionNodeProps {
    collection: Collection;
    collapsed: boolean;
    contextMenu: ContextMenuState | null;
    dragState: DragState | null;
    dropTarget: DropTarget | null;
    renameTarget: RenameTarget | null;
    renameDraft: string;
    onRenameDraftChange: (value: string) => void;
    onRenameCommit: () => void;
    onRenameCancel: () => void;
    onAddRequest: () => void;
    onCollectionClick: () => void;
    onCollectionDoubleClick: () => void;
    onCollectionContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
    onCollectionDragStart: (event: ReactDragEvent<HTMLElement>) => void;
    onDragEnd: () => void;
    onCollectionDragOver: (event: ReactDragEvent<HTMLElement>) => void;
    onCollectionDrop: (event: ReactDragEvent<HTMLElement>) => void;
    onRequestOpen: (request: ApiRequest) => void;
    onRequestDoubleClick: (request: ApiRequest) => void;
    onRequestContextMenu: (event: ReactMouseEvent<HTMLElement>, requestId: string) => void;
    onRequestDragStart: (event: ReactDragEvent<HTMLElement>, request: ApiRequest) => void;
    onRequestDragOver: (event: ReactDragEvent<HTMLElement>, requestId: string) => void;
    onRequestDrop: (event: ReactDragEvent<HTMLElement>, requestId: string) => void;
}

function CollectionNode(props: CollectionNodeProps) {
    const {
        collection,
        collapsed,
        contextMenu,
        dragState,
        dropTarget,
        renameTarget,
        renameDraft,
        onRenameDraftChange,
        onRenameCommit,
        onRenameCancel,
        onAddRequest,
        onCollectionClick,
        onCollectionDoubleClick,
        onCollectionContextMenu,
        onCollectionDragStart,
        onDragEnd,
        onCollectionDragOver,
        onCollectionDrop,
        onRequestOpen,
        onRequestDoubleClick,
        onRequestContextMenu,
        onRequestDragStart,
        onRequestDragOver,
        onRequestDrop,
    } = props;
    const isRenamingCollection = renameTarget?.kind === "collection" &&
        renameTarget.collectionId === collection.id;

    return (
        <div
            className={`collection-item${dropTarget?.kind === "collection" && dropTarget.collectionId === collection.id ? " drop-target" : ""}`}
        >
            <div
                className={`collection-header${contextMenu?.kind === "collection" && contextMenu.collectionId === collection.id ? " menu-open" : ""}${dragState?.kind === "collection" && dragState.collectionId === collection.id ? " dragging-source" : ""}`}
                draggable={!isRenamingCollection}
                data-collection-id={collection.id}
                onClick={onCollectionClick}
                onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onCollectionDoubleClick();
                }}
                onDragStart={onCollectionDragStart}
                onDragEnd={onDragEnd}
                onDragOver={onCollectionDragOver}
                onDrop={onCollectionDrop}
                onContextMenu={onCollectionContextMenu}
            >
                <span className="collection-disclosure" aria-hidden="true">
                    {collapsed ? "▸" : "▾"}
                </span>
                <FolderOpen size={14} />
                {isRenamingCollection ? (
                    <RenameInput
                        value={renameDraft}
                        ariaLabel="Rename collection"
                        onChange={onRenameDraftChange}
                        onCommit={onRenameCommit}
                        onCancel={onRenameCancel}
                    />
                ) : (
                    <span className="collection-name">{collection.name}</span>
                )}
                <button
                    className="toolbar-btn small"
                    title="Add Request"
                    type="button"
                    draggable={false}
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onAddRequest();
                    }}
                    onDoubleClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                    }}
                >
                    <Plus size={12} />
                </button>
            </div>
            {!collapsed && (
                <div
                    className={`collection-children${dropTarget?.kind === "collection" && dropTarget.collectionId === collection.id ? " drop-target" : ""}`}
                    onDragOver={onCollectionDragOver}
                    onDrop={onCollectionDrop}
                >
                    {collection.items.map((item) =>
                        isFolder(item) ? (
                            <div className="folder-item" key={item.id}>
                                <FolderOpen size={12} />
                                <span>{item.name}</span>
                            </div>
                        ) : (
                            <RequestNode
                                key={item.id}
                                collectionId={collection.id}
                                request={item}
                                contextMenu={contextMenu}
                                dragState={dragState}
                                dropTarget={dropTarget}
                                renameTarget={renameTarget}
                                renameDraft={renameDraft}
                                onRenameDraftChange={onRenameDraftChange}
                                onRenameCommit={onRenameCommit}
                                onRenameCancel={onRenameCancel}
                                onOpen={() => onRequestOpen(item)}
                                onDoubleClick={() => onRequestDoubleClick(item)}
                                onContextMenu={(event) => onRequestContextMenu(event, item.id)}
                                onDragStart={(event) => onRequestDragStart(event, item)}
                                onDragEnd={onDragEnd}
                                onDragOver={(event) => onRequestDragOver(event, item.id)}
                                onDrop={(event) => onRequestDrop(event, item.id)}
                            />
                        ),
                    )}
                </div>
            )}
        </div>
    );
}

interface RequestNodeProps {
    collectionId: string;
    request: ApiRequest;
    contextMenu: ContextMenuState | null;
    dragState: DragState | null;
    dropTarget: DropTarget | null;
    renameTarget: RenameTarget | null;
    renameDraft: string;
    onRenameDraftChange: (value: string) => void;
    onRenameCommit: () => void;
    onRenameCancel: () => void;
    onOpen: () => void;
    onDoubleClick: () => void;
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
    onDragStart: (event: ReactDragEvent<HTMLElement>) => void;
    onDragEnd: () => void;
    onDragOver: (event: ReactDragEvent<HTMLElement>) => void;
    onDrop: (event: ReactDragEvent<HTMLElement>) => void;
}

function RequestNode(props: RequestNodeProps) {
    const {
        collectionId,
        request,
        contextMenu,
        dragState,
        dropTarget,
        renameTarget,
        renameDraft,
        onRenameDraftChange,
        onRenameCommit,
        onRenameCancel,
        onOpen,
        onDoubleClick,
        onContextMenu,
        onDragStart,
        onDragEnd,
        onDragOver,
        onDrop,
    } = props;
    const isRenamingRequest = renameTarget?.kind === "request" &&
        renameTarget.collectionId === collectionId &&
        renameTarget.requestId === request.id;

    if (isRenamingRequest) {
        return (
            <div className="request-item request-item-editing">
                <span
                    className="method-badge"
                    style={{ color: METHOD_COLORS[request.method] }}
                >
                    {request.method.substring(0, 3)}
                </span>
                <RenameInput
                    value={renameDraft}
                    ariaLabel="Rename request"
                    onChange={onRenameDraftChange}
                    onCommit={onRenameCommit}
                    onCancel={onRenameCancel}
                />
            </div>
        );
    }

    return (
        <button
            className={`request-item${contextMenu?.kind === "request" && contextMenu.requestId === request.id ? " menu-open" : ""}${dragState?.kind === "request" && dragState.requestId === request.id ? " dragging-source" : ""}${dropTarget?.kind === "request" && dropTarget.requestId === request.id ? " drop-target" : ""}`}
            type="button"
            draggable
            data-request-id={request.id}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onClick={onOpen}
            onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDoubleClick();
            }}
            onContextMenu={onContextMenu}
        >
            <span
                className="method-badge"
                style={{ color: METHOD_COLORS[request.method] }}
            >
                {request.method.substring(0, 3)}
            </span>
            <span className="request-name">{request.name}</span>
        </button>
    );
}

function RenameInput({
    value,
    ariaLabel,
    onChange,
    onCommit,
    onCancel,
}: {
    value: string;
    ariaLabel: string;
    onChange: (value: string) => void;
    onCommit: () => void;
    onCancel: () => void;
}) {
    return (
        <input
            className="collection-rename-input"
            value={value}
            aria-label={ariaLabel}
            autoFocus
            ref={(input) => {
                input?.select();
            }}
            onChange={(event) => onChange(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
            onBlur={onCommit}
            onKeyDown={(event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    onCommit();
                    return;
                }
                if (event.key === "Escape") {
                    event.preventDefault();
                    onCancel();
                }
            }}
        />
    );
}

function RequestCreateModal({
    collections,
    requestName,
    collectionId,
    onRequestNameChange,
    onCollectionIdChange,
    onCancel,
    onConfirm,
}: {
    collections: Collection[];
    requestName: string;
    collectionId: string;
    onRequestNameChange: (value: string) => void;
    onCollectionIdChange: (value: string) => void;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    return (
        <div className="collection-modal-overlay" onClick={onCancel}>
            <form
                className="collection-modal"
                role="dialog"
                aria-modal="true"
                aria-label="New Request"
                onClick={(event) => event.stopPropagation()}
                onSubmit={(event) => {
                    event.preventDefault();
                    onConfirm();
                }}
            >
                <div className="collection-modal-header">
                    <span className="collection-modal-title">New Request</span>
                    <button
                        className="collection-modal-close"
                        type="button"
                        aria-label="Close request modal"
                        onClick={onCancel}
                    >
                        <X size={16} />
                    </button>
                </div>
                <div className="collection-modal-body">
                    <label className="collection-modal-field">
                        <span>Request name</span>
                        <input
                            aria-label="Request name"
                            value={requestName}
                            autoFocus
                            onChange={(event) => onRequestNameChange(event.target.value)}
                        />
                    </label>
                    <label className="collection-modal-field">
                        <span>Collection</span>
                        <select
                            aria-label="Request collection"
                            value={collectionId}
                            onChange={(event) => onCollectionIdChange(event.target.value)}
                        >
                            {collections.map((collection) => (
                                <option key={collection.id} value={collection.id}>
                                    {collection.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    {collections.length === 0 && (
                        <div className="collection-modal-empty">No collections available.</div>
                    )}
                </div>
                <div className="collection-modal-footer">
                    <button type="button" className="collection-modal-secondary" onClick={onCancel}>
                        Cancel
                    </button>
                    <button
                        type="submit"
                        className="collection-modal-primary"
                        disabled={collections.length === 0}
                    >
                        Create Request
                    </button>
                </div>
            </form>
        </div>
    );
}

function ImportCollectionModal({
    value,
    error,
    parsed,
    importing,
    onValueChange,
    onFileChange,
    onCancel,
    onConfirm,
}: {
    value: string;
    error: string;
    parsed: ParsedApiSpecImport | null;
    importing: boolean;
    onValueChange: (value: string) => void;
    onFileChange: (file: File) => void;
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
        <div className="collection-modal-overlay" onClick={onCancel}>
            <form
                className="collection-modal collection-import-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Import Collection"
                onClick={(event) => event.stopPropagation()}
                onSubmit={(event) => {
                    event.preventDefault();
                    onConfirm();
                }}
            >
                <div className="collection-modal-header">
                    <span className="collection-modal-title">Import Collection</span>
                    <button
                        className="collection-modal-close"
                        type="button"
                        aria-label="Close import modal"
                        onClick={onCancel}
                    >
                        <X size={16} />
                    </button>
                </div>
                <div className="collection-modal-body">
                    <label className="collection-modal-field">
                        <span>JSON file</span>
                        <input
                            aria-label="Import JSON file"
                            type="file"
                            accept=".json,application/json"
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) {
                                    onFileChange(file);
                                }
                            }}
                        />
                    </label>
                    <label className="collection-modal-field">
                        <span>JSON content</span>
                        <textarea
                            aria-label="Import JSON content"
                            value={value}
                            spellCheck={false}
                            onChange={(event) => onValueChange(event.target.value)}
                        />
                    </label>
                    {parsed && (
                        <div className="collection-import-summary" aria-live="polite">
                            <FileJson size={14} />
                            <span>{parsed.collection.name}</span>
                            <span>{parsed.format}</span>
                            <span>{parsed.collection.requests.length} requests</span>
                        </div>
                    )}
                    {error && <div className="collection-modal-error">{error}</div>}
                </div>
                <div className="collection-modal-footer">
                    <button type="button" className="collection-modal-secondary" onClick={onCancel}>
                        Cancel
                    </button>
                    <button
                        type="submit"
                        className="collection-modal-primary"
                        disabled={importing || !parsed}
                    >
                        {importing ? "Importing" : "Import"}
                    </button>
                </div>
            </form>
        </div>
    );
}

export function CollectionsPanel({ context }: Props) {
    const state = useAppState();
    const dispatch = useAppDispatch();
    const menuRef = useRef<HTMLDivElement>(null);
    const collectionClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const requestClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [dragState, setDragState] = useState<DragState | null>(null);
    const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
    const [collapsedCollectionIds, setCollapsedCollectionIds] = useState<Set<string>>(
        () => new Set(),
    );
    const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
    const [renameDraft, setRenameDraft] = useState("");
    const [requestModalOpen, setRequestModalOpen] = useState(false);
    const [requestDraftName, setRequestDraftName] = useState("New Request");
    const [requestDraftCollectionId, setRequestDraftCollectionId] = useState("");
    const [importModalOpen, setImportModalOpen] = useState(false);
    const [importDraft, setImportDraft] = useState("");
    const [importError, setImportError] = useState("");
    const [parsedImport, setParsedImport] = useState<ParsedApiSpecImport | null>(null);
    const [importing, setImporting] = useState(false);

    useEffect(() => {
        if (!contextMenu) {
            return;
        }

        const handlePointerDown = (event: MouseEvent) => {
            if (menuRef.current?.contains(event.target as Node)) {
                return;
            }

            setContextMenu(null);
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setContextMenu(null);
            }
        };

        const closeMenu = () => setContextMenu(null);

        window.addEventListener("mousedown", handlePointerDown);
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("resize", closeMenu);
        window.addEventListener("scroll", closeMenu, true);

        return () => {
            window.removeEventListener("mousedown", handlePointerDown);
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("resize", closeMenu);
            window.removeEventListener("scroll", closeMenu, true);
        };
    }, [contextMenu]);

    useEffect(() => () => {
        if (collectionClickTimerRef.current) {
            clearTimeout(collectionClickTimerRef.current);
        }
        if (requestClickTimerRef.current) {
            clearTimeout(requestClickTimerRef.current);
        }
    }, []);

    const openRequest = (req: ApiRequest) => {
        const tabId = getRequestTabId(req.id);
        dispatch({ type: "OPEN_REQUEST", tabId, request: req });
        context.openTab({
            id: tabId,
            title: `${req.method} ${req.name}`,
            component: "request-editor",
            params: { tabId, requestId: req.id },
        });
    };

    const scheduleOpenRequest = (req: ApiRequest) => {
        if (requestClickTimerRef.current) {
            clearTimeout(requestClickTimerRef.current);
        }

        requestClickTimerRef.current = setTimeout(() => {
            requestClickTimerRef.current = null;
            openRequest(req);
        }, CLICK_COMMIT_DELAY_MS);
    };

    const toggleCollection = (collectionId: string) => {
        setCollapsedCollectionIds((prev) => {
            const next = new Set(prev);
            if (next.has(collectionId)) {
                next.delete(collectionId);
            } else {
                next.add(collectionId);
            }
            return next;
        });
    };

    const scheduleToggleCollection = (collectionId: string) => {
        if (collectionClickTimerRef.current) {
            clearTimeout(collectionClickTimerRef.current);
        }

        collectionClickTimerRef.current = setTimeout(() => {
            collectionClickTimerRef.current = null;
            toggleCollection(collectionId);
        }, CLICK_COMMIT_DELAY_MS);
    };

    const beginRenameCollection = (collection: Collection) => {
        setContextMenu(null);
        setRenameTarget({ kind: "collection", collectionId: collection.id });
        setRenameDraft(collection.name);
    };

    const beginRenameRequest = (collectionId: string, request: ApiRequest) => {
        setContextMenu(null);
        setRenameTarget({ kind: "request", collectionId, requestId: request.id });
        setRenameDraft(request.name);
    };

    const cancelRename = () => {
        setRenameTarget(null);
        setRenameDraft("");
    };

    const openRequestCreateModal = (collectionId?: string) => {
        const targetCollection = collectionId && state.collections.some((collection) => collection.id === collectionId)
            ? collectionId
            : state.collections[0]?.id ?? "";
        setContextMenu(null);
        setRequestDraftName("New Request");
        setRequestDraftCollectionId(targetCollection);
        setRequestModalOpen(true);
    };

    const closeRequestCreateModal = () => {
        setRequestModalOpen(false);
        setRequestDraftName("New Request");
        setRequestDraftCollectionId("");
    };

    const openImportModal = () => {
        setContextMenu(null);
        setImportModalOpen(true);
        setImportDraft("");
        setImportError("");
        setParsedImport(null);
    };

    const closeImportModal = () => {
        if (importing) {
            return;
        }
        setImportModalOpen(false);
        setImportDraft("");
        setImportError("");
        setParsedImport(null);
    };

    const updateImportDraft = (value: string) => {
        setImportDraft(value);
        if (!value.trim()) {
            setImportError("");
            setParsedImport(null);
            return;
        }

        try {
            const parsed = parseApiSpecImportJson(value);
            setParsedImport(parsed);
            setImportError("");
        } catch (error) {
            setParsedImport(null);
            setImportError(error instanceof Error ? error.message : "Could not parse import JSON.");
        }
    };

    const handleImportFile = (file: File) => {
        file.text()
            .then(updateImportDraft)
            .catch((error) => {
                setImportError(error instanceof Error ? error.message : "Could not read import file.");
                setParsedImport(null);
            });
    };

    const persistImportedCollection = async (draft: ImportedCollectionDraft) => {
        const collection = await createCollectionApi(draft.name);
        const importedRequests: ApiRequest[] = [];
        for (const requestDraft of draft.requests) {
            const request = await createRequestApi(collection.id, requestDraft.name);
            const nextRequest: ApiRequest = {
                ...request,
                method: requestDraft.method,
                url: requestDraft.url,
                params: requestDraft.params,
                headers: requestDraft.headers,
                body: requestDraft.body,
                auth: requestDraft.auth,
            };
            await updateRequestApi(nextRequest, collection.id);
            importedRequests.push(nextRequest);
        }
        dispatch({
            type: "ADD_COLLECTION",
            collection: { ...collection, items: importedRequests },
        });

        return { collection, importedRequests };
    };

    const confirmImport = async () => {
        if (!parsedImport || importing) {
            return;
        }

        setImporting(true);
        try {
            await persistImportedCollection(parsedImport.collection);
            setImportModalOpen(false);
            setImportDraft("");
            setImportError("");
            setParsedImport(null);
        } catch (error) {
            setImportError(error instanceof Error ? error.message : "Failed to import collection.");
        } finally {
            setImporting(false);
        }
    };

    const commitRename = async () => {
        const target = renameTarget;
        if (!target) {
            return;
        }

        const nextName = renameDraft.trim();
        setRenameTarget(null);
        setRenameDraft("");

        if (!nextName) {
            return;
        }

        if (target.kind === "collection") {
            const collection = state.collections.find((entry) => entry.id === target.collectionId);
            if (!collection || collection.name === nextName) {
                return;
            }

            try {
                await renameCollectionApi(collection.id, nextName);
                dispatch({
                    type: "UPDATE_COLLECTION",
                    collectionId: collection.id,
                    collection: { name: nextName },
                });
            } catch (err) {
                console.error("Failed to rename collection:", err);
            }
            return;
        }

        const collection = state.collections.find((entry) => entry.id === target.collectionId);
        const request = collection ? findRequest(collection.items, target.requestId) : null;
        if (!collection || !request || request.name === nextName) {
            return;
        }

        const nextRequest = { ...request, name: nextName };
        try {
            await updateRequestApi(nextRequest, collection.id);
            dispatch({
                type: "UPDATE_REQUEST_BY_ID",
                requestId: request.id,
                request: { name: nextName },
            });
            context.updateTab(getRequestTabId(request.id), {
                title: `${nextRequest.method} ${nextRequest.name}`,
            });
        } catch (err) {
            console.error("Failed to rename request:", err);
        }
    };

    const readDragState = (event: ReactDragEvent<HTMLElement>): DragState | null => {
        if (dragState) {
            return dragState;
        }

        const rawPayload = event.dataTransfer.getData(COLLECTION_TREE_DRAG_TYPE);
        if (!rawPayload) {
            return null;
        }

        try {
            const parsed = JSON.parse(rawPayload) as DragState;
            if (parsed.kind === "collection" && typeof parsed.collectionId === "string") {
                return parsed;
            }
            if (
                parsed.kind === "request" &&
                typeof parsed.collectionId === "string" &&
                typeof parsed.requestId === "string"
            ) {
                return parsed;
            }
        } catch {
            return null;
        }

        return null;
    };

    const clearDragState = () => {
        setDragState(null);
        setDropTarget(null);
    };

    const handleCollectionDragStart = (
        event: ReactDragEvent<HTMLElement>,
        collection: Collection,
    ) => {
        const nextDragState: DragState = { kind: "collection", collectionId: collection.id };
        setDragState(nextDragState);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(COLLECTION_TREE_DRAG_TYPE, JSON.stringify(nextDragState));

        const preview = buildDragImage(collection.name);
        if (preview) {
            event.dataTransfer.setDragImage(preview, 18, 18);
        }
    };

    const handleRequestDragStart = (
        event: ReactDragEvent<HTMLElement>,
        collection: Collection,
        request: ApiRequest,
    ) => {
        const nextDragState: DragState = {
            kind: "request",
            collectionId: collection.id,
            requestId: request.id,
        };
        setDragState(nextDragState);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(COLLECTION_TREE_DRAG_TYPE, JSON.stringify(nextDragState));

        const preview = buildDragImage(`${request.method} ${request.name}`);
        if (preview) {
            event.dataTransfer.setDragImage(preview, 18, 18);
        }
    };

    const handleDragOverCollection = (
        event: ReactDragEvent<HTMLElement>,
        targetCollectionId: string,
    ) => {
        const currentDragState = readDragState(event);
        if (!currentDragState) {
            return;
        }

        if (
            currentDragState.kind === "collection" &&
            currentDragState.collectionId === targetCollectionId
        ) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setDropTarget({ kind: "collection", collectionId: targetCollectionId });
    };

    const handleDragOverRequest = (
        event: ReactDragEvent<HTMLElement>,
        targetCollectionId: string,
        targetRequestId: string,
    ) => {
        const currentDragState = readDragState(event);
        if (!currentDragState || currentDragState.kind !== "request") {
            return;
        }

        if (currentDragState.requestId === targetRequestId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setDropTarget({
            kind: "request",
            collectionId: targetCollectionId,
            requestId: targetRequestId,
        });
    };

    const commitCollectionDrop = async (
        event: ReactDragEvent<HTMLElement>,
        targetCollectionId: string,
    ) => {
        const currentDragState = readDragState(event);
        if (!currentDragState) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        clearDragState();

        try {
            if (currentDragState.kind === "collection") {
                const collectionIds = moveIdBefore(
                    state.collections.map((collection) => collection.id),
                    currentDragState.collectionId,
                    targetCollectionId,
                );
                if (collectionIds.join("\0") !== state.collections.map((collection) => collection.id).join("\0")) {
                    await reorderCollectionsApi(collectionIds);
                    dispatch({ type: "REORDER_COLLECTIONS", collectionIds });
                }
                return;
            }

            await moveRequestApi({
                requestId: currentDragState.requestId,
                targetCollectionId,
                beforeRequestId: null,
            });
            dispatch({
                type: "MOVE_REQUEST",
                requestId: currentDragState.requestId,
                fromCollectionId: currentDragState.collectionId,
                toCollectionId: targetCollectionId,
                beforeRequestId: null,
            });
        } catch (err) {
            console.error("Failed to move collection tree item:", err);
        }
    };

    const commitRequestDrop = async (
        event: ReactDragEvent<HTMLElement>,
        targetCollectionId: string,
        beforeRequestId: string,
    ) => {
        const currentDragState = readDragState(event);
        if (!currentDragState || currentDragState.kind !== "request") {
            return;
        }
        if (currentDragState.requestId === beforeRequestId) {
            clearDragState();
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        clearDragState();

        try {
            await moveRequestApi({
                requestId: currentDragState.requestId,
                targetCollectionId,
                beforeRequestId,
            });
            dispatch({
                type: "MOVE_REQUEST",
                requestId: currentDragState.requestId,
                fromCollectionId: currentDragState.collectionId,
                toCollectionId: targetCollectionId,
                beforeRequestId,
            });
        } catch (err) {
            console.error("Failed to move request:", err);
        }
    };

    const handleAddCollection = async () => {
        try {
            const col = await createCollectionApi("New Collection");
            dispatch({ type: "ADD_COLLECTION", collection: col });
        } catch (err) {
            console.error("Failed to create collection:", err);
        }
    };

    const handleCreateRequest = async () => {
        const collectionId = requestDraftCollectionId;
        const name = requestDraftName.trim() || "New Request";
        if (!collectionId) {
            return;
        }

        try {
            const req = await createRequestApi(collectionId, name);
            dispatch({ type: "ADD_REQUEST_TO_COLLECTION", collectionId, request: req });
            closeRequestCreateModal();
        } catch (err) {
            console.error("Failed to create request:", err);
        }
    };

    const handleCollectionContextMenu = (
        event: ReactMouseEvent<HTMLElement>,
        collectionId: string,
    ) => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenu({ kind: "collection", collectionId, x: event.clientX, y: event.clientY });
    };

    const handleRequestContextMenu = (
        event: ReactMouseEvent<HTMLElement>,
        collectionId: string,
        requestId: string,
    ) => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenu({
            kind: "request",
            collectionId,
            requestId,
            x: event.clientX,
            y: event.clientY,
        });
    };

    const handleRenameCollection = async (collectionId: string) => {
        const collection = state.collections.find((entry) => entry.id === collectionId);
        if (!collection) {
            return;
        }

        beginRenameCollection(collection);
    };

    const handleDeleteCollection = async (collectionId: string) => {
        setContextMenu(null);

        const collection = state.collections.find((entry) => entry.id === collectionId);
        if (!collection) {
            return;
        }

        try {
            await deleteCollectionApi(collection.id);
            for (const requestId of collectRequestIds(collection.items)) {
                context.closeTab(getRequestTabId(requestId));
            }
            dispatch({ type: "DELETE_COLLECTION", collectionId: collection.id });
        } catch (err) {
            console.error("Failed to delete collection:", err);
        }
    };

    const handleRenameRequest = async (collectionId: string, requestId: string) => {
        const collection = state.collections.find((entry) => entry.id === collectionId);
        const request = collection ? findRequest(collection.items, requestId) : null;
        if (!collection || !request) {
            return;
        }

        beginRenameRequest(collection.id, request);
    };

    const handleDeleteRequest = async (collectionId: string, requestId: string) => {
        setContextMenu(null);

        const collection = state.collections.find((entry) => entry.id === collectionId);
        const request = collection ? findRequest(collection.items, requestId) : null;
        if (!request) {
            return;
        }

        try {
            await deleteRequestApi(request.id);
            context.closeTab(getRequestTabId(request.id));
            dispatch({ type: "DELETE_REQUEST", collectionId, requestId: request.id });
        } catch (err) {
            console.error("Failed to delete request:", err);
        }
    };

    const menuPosition = contextMenu
        ? clampContextMenuPosition(contextMenu.x, contextMenu.y)
        : null;
    const contextMenuPortal = contextMenu && menuPosition && typeof document !== "undefined"
        ? createPortal(
            <div
                className="context-menu"
                ref={menuRef}
                role="menu"
                style={menuPosition}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <button
                    className="context-menu-item"
                    type="button"
                    onClick={() => {
                        if (contextMenu.kind === "collection") {
                            void handleRenameCollection(contextMenu.collectionId);
                            return;
                        }

                        void handleRenameRequest(contextMenu.collectionId, contextMenu.requestId);
                    }}
                >
                    Rename
                </button>
                <button
                    className="context-menu-item danger"
                    type="button"
                    onClick={() => {
                        if (contextMenu.kind === "collection") {
                            void handleDeleteCollection(contextMenu.collectionId);
                            return;
                        }

                        void handleDeleteRequest(contextMenu.collectionId, contextMenu.requestId);
                    }}
                >
                    Delete
                </button>
            </div>,
            document.body,
        )
        : null;

    return (
        <div className="collections-panel">
            <div className="panel-toolbar">
                <span className="panel-title">Collections</span>
                <button
                    className="toolbar-btn"
                    title="New Request"
                    type="button"
                    onClick={() => openRequestCreateModal()}
                >
                    <Plus size={14} />
                </button>
                <button
                    className="toolbar-btn"
                    title="New Collection"
                    type="button"
                    onClick={handleAddCollection}
                >
                    <FolderPlus size={14} />
                </button>
                <button
                    className="toolbar-btn"
                    title="Import Collection"
                    type="button"
                    onClick={openImportModal}
                >
                    <Upload size={14} />
                </button>
            </div>
            <div
                className="collections-tree"
                onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setDropTarget(null);
                    }
                }}
            >
                {state.collections.map((col) => (
                    <CollectionNode
                        key={col.id}
                        collection={col}
                        collapsed={collapsedCollectionIds.has(col.id)}
                        contextMenu={contextMenu}
                        dragState={dragState}
                        dropTarget={dropTarget}
                        renameTarget={renameTarget}
                        renameDraft={renameDraft}
                        onRenameDraftChange={setRenameDraft}
                        onRenameCommit={() => {
                            void commitRename();
                        }}
                        onRenameCancel={cancelRename}
                        onAddRequest={() => {
                            openRequestCreateModal(col.id);
                        }}
                        onCollectionClick={() => scheduleToggleCollection(col.id)}
                        onCollectionDoubleClick={() => {
                            if (collectionClickTimerRef.current) {
                                clearTimeout(collectionClickTimerRef.current);
                                collectionClickTimerRef.current = null;
                            }
                            beginRenameCollection(col);
                        }}
                        onCollectionContextMenu={(event) => handleCollectionContextMenu(event, col.id)}
                        onCollectionDragStart={(event) => handleCollectionDragStart(event, col)}
                        onDragEnd={clearDragState}
                        onCollectionDragOver={(event) => handleDragOverCollection(event, col.id)}
                        onCollectionDrop={(event) => {
                            void commitCollectionDrop(event, col.id);
                        }}
                        onRequestOpen={(request) => scheduleOpenRequest(request)}
                        onRequestDoubleClick={(request) => {
                            if (requestClickTimerRef.current) {
                                clearTimeout(requestClickTimerRef.current);
                                requestClickTimerRef.current = null;
                            }
                            beginRenameRequest(col.id, request);
                        }}
                        onRequestContextMenu={(event, requestId) =>
                            handleRequestContextMenu(event, col.id, requestId)
                        }
                        onRequestDragStart={(event, request) => handleRequestDragStart(event, col, request)}
                        onRequestDragOver={(event, requestId) =>
                            handleDragOverRequest(event, col.id, requestId)
                        }
                        onRequestDrop={(event, requestId) => {
                            void commitRequestDrop(event, col.id, requestId);
                        }}
                    />
                ))}
            </div>
            {contextMenuPortal}
            {requestModalOpen && typeof document !== "undefined" && createPortal(
                <RequestCreateModal
                    collections={state.collections}
                    requestName={requestDraftName}
                    collectionId={requestDraftCollectionId}
                    onRequestNameChange={setRequestDraftName}
                    onCollectionIdChange={setRequestDraftCollectionId}
                    onCancel={closeRequestCreateModal}
                    onConfirm={() => {
                        void handleCreateRequest();
                    }}
                />,
                document.body,
            )}
            {importModalOpen && typeof document !== "undefined" && createPortal(
                <ImportCollectionModal
                    value={importDraft}
                    error={importError}
                    parsed={parsedImport}
                    importing={importing}
                    onValueChange={updateImportDraft}
                    onFileChange={handleImportFile}
                    onCancel={closeImportModal}
                    onConfirm={() => {
                        void confirmImport();
                    }}
                />,
                document.body,
            )}
        </div>
    );
}
