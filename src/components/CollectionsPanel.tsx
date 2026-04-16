import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { WorkbenchPanelContext } from "layout-v2";
import { useAppState, useAppDispatch } from "../store/appStore";
import { type ApiRequest, type Collection, isFolder } from "../types/api";
import {
    createCollectionApi,
    createRequestApi,
    deleteCollectionApi,
    deleteRequestApi,
    renameCollectionApi,
    updateRequestApi,
} from "../services/persistence";
import { FolderOpen, Plus } from "lucide-react";
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

const CONTEXT_MENU_WIDTH = 164;
const CONTEXT_MENU_HEIGHT = 84;

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

export function CollectionsPanel({ context }: Props) {
    const state = useAppState();
    const dispatch = useAppDispatch();
    const menuRef = useRef<HTMLDivElement>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

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

    const openRequest = (req: ApiRequest) => {
        const tabId = getRequestTabId(req.id);
        // Register request in store
        dispatch({ type: "OPEN_REQUEST", tabId, request: req });
        // Open tab in workbench
        context.openTab({
            id: tabId,
            title: `${req.method} ${req.name}`,
            component: "request-editor",
            params: { tabId, requestId: req.id },
        });
    };

    const handleAddCollection = async () => {
        try {
            const col = await createCollectionApi("New Collection");
            dispatch({ type: "ADD_COLLECTION", collection: col });
        } catch (err) {
            console.error("Failed to create collection:", err);
        }
    };

    const handleAddRequest = async (collectionId: string) => {
        try {
            const req = await createRequestApi(collectionId, "New Request");
            dispatch({ type: "ADD_REQUEST_TO_COLLECTION", collectionId, request: req });
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
        setContextMenu(null);

        const collection = state.collections.find((entry) => entry.id === collectionId);
        if (!collection) {
            return;
        }

        const nextName = window.prompt("Rename collection", collection.name)?.trim();
        if (!nextName || nextName === collection.name) {
            return;
        }

        try {
            await renameCollectionApi(collection.id, nextName);
            dispatch({ type: "UPDATE_COLLECTION", collectionId: collection.id, collection: { name: nextName } });
        } catch (err) {
            console.error("Failed to rename collection:", err);
        }
    };

    const handleDeleteCollection = async (collectionId: string) => {
        setContextMenu(null);

        const collection = state.collections.find((entry) => entry.id === collectionId);
        if (!collection) {
            return;
        }

        const confirmed = window.confirm(`Delete \"${collection.name}\" and all requests inside it?`);
        if (!confirmed) {
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
        setContextMenu(null);

        const collection = state.collections.find((entry) => entry.id === collectionId);
        const request = collection ? findRequest(collection.items, requestId) : null;
        if (!collection || !request) {
            return;
        }

        const nextName = window.prompt("Rename request", request.name)?.trim();
        if (!nextName || nextName === request.name) {
            return;
        }

        const nextRequest = { ...request, name: nextName };

        try {
            await updateRequestApi(nextRequest, collection.id);
            dispatch({ type: "UPDATE_REQUEST_BY_ID", requestId: request.id, request: { name: nextName } });
            context.updateTab(getRequestTabId(request.id), {
                title: `${nextRequest.method} ${nextRequest.name}`,
            });
        } catch (err) {
            console.error("Failed to rename request:", err);
        }
    };

    const handleDeleteRequest = async (collectionId: string, requestId: string) => {
        setContextMenu(null);

        const collection = state.collections.find((entry) => entry.id === collectionId);
        const request = collection ? findRequest(collection.items, requestId) : null;
        if (!request) {
            return;
        }

        const confirmed = window.confirm(`Delete \"${request.name}\"?`);
        if (!confirmed) {
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

    return (
        <div className="collections-panel">
            <div className="panel-toolbar">
                <span className="panel-title">Collections</span>
                <button
                    className="toolbar-btn"
                    title="New Collection"
                    onClick={handleAddCollection}
                >
                    <Plus size={14} />
                </button>
            </div>
            <div className="collections-tree">
                {state.collections.map((col) => (
                    <div className="collection-item" key={col.id}>
                        <div
                            className={`collection-header${contextMenu?.kind === "collection" && contextMenu.collectionId === col.id ? " menu-open" : ""}`}
                            onContextMenu={(event) => handleCollectionContextMenu(event, col.id)}
                        >
                            <FolderOpen size={14} />
                            <span className="collection-name">{col.name}</span>
                            <button
                                className="toolbar-btn small"
                                title="Add Request"
                                onClick={() => handleAddRequest(col.id)}
                            >
                                <Plus size={12} />
                            </button>
                        </div>
                        <div className="collection-children">
                            {col.items.map((item) =>
                                isFolder(item) ? (
                                    <div className="folder-item" key={item.id}>
                                        <FolderOpen size={12} />
                                        <span>{item.name}</span>
                                    </div>
                                ) : (
                                    <button
                                        className={`request-item${contextMenu?.kind === "request" && contextMenu.requestId === item.id ? " menu-open" : ""}`}
                                        key={item.id}
                                        onClick={() => openRequest(item)}
                                        onContextMenu={(event) =>
                                            handleRequestContextMenu(event, col.id, item.id)
                                        }
                                    >
                                        <span
                                            className="method-badge"
                                            style={{ color: METHOD_COLORS[item.method] }}
                                        >
                                            {item.method.substring(0, 3)}
                                        </span>
                                        <span className="request-name">{item.name}</span>
                                    </button>
                                ),
                            )}
                        </div>
                    </div>
                ))}
            </div>
            {contextMenu && menuPosition && (
                <div
                    className="context-menu"
                    ref={menuRef}
                    role="menu"
                    style={menuPosition}
                >
                    <button
                        className="context-menu-item"
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
                </div>
            )}
        </div>
    );
}
