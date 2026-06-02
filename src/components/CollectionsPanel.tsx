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
import { type ApiRequest, type Collection, type RequestFolder, isFolder } from "../types/api";
import {
    createCollectionApi,
    createFolderApi,
    createRequestApi,
    deleteCollectionApi,
    deleteFolderApi,
    deleteRequestApi,
    addRunnerReport,
    deleteRunnerReport,
    listRunnerReports,
    moveFolderApi,
    moveRequestApi,
    renameCollectionApi,
    renameFolderApi,
    reorderCollectionsApi,
    updateRequestApi,
    type RunnerReportEntry,
} from "../services/persistence";
import {
    parseApiSpecImportJson,
    type ImportedCollectionDraft,
    type ImportedFolderDraft,
    type ImportedRequestDraft,
    type ParsedApiSpecImport,
} from "../services/apiSpecImporter";
import {
    runCollectionTarget,
    type RunnerReport,
    type RunnerTarget,
} from "../services/collectionRunner";
import { exportCollectionAsPostman } from "../services/apiSpecExporter";
import { ExportJsonModal, type ExportJsonModalArtifact } from "./ExportJsonModal";
import { Download, FileJson, FolderPlus, FolderOpen, LibraryBig, Play, Plus, Trash2, Upload, X } from "lucide-react";
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
    | { kind: "folder"; collectionId: string; folderId: string; x: number; y: number }
    | { kind: "request"; collectionId: string; requestId: string; x: number; y: number };

type RunnerModalState = {
    target: RunnerTarget;
    targetName: string;
};

type DragState =
    | { kind: "collection"; collectionId: string }
    | { kind: "request"; collectionId: string; requestId: string }
    | { kind: "folder"; collectionId: string; folderId: string };

type DropTarget =
    | { kind: "collection"; collectionId: string }
    | { kind: "folder"; collectionId: string; folderId: string }
    | { kind: "request"; collectionId: string; requestId: string };

type RenameTarget =
    | { kind: "collection"; collectionId: string }
    | { kind: "folder"; collectionId: string; folderId: string }
    | { kind: "request"; collectionId: string; requestId: string };

const COLLECTION_TREE_DRAG_TYPE = "application/x-far-api-collection-tree";
const CONTEXT_MENU_WIDTH = 164;
const CONTEXT_MENU_HEIGHT = 156;
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

function findFolder(items: CollectionItem[], folderId: string): RequestFolder | null {
    for (const item of items) {
        if (!isFolder(item)) {
            continue;
        }

        if (item.id === folderId) {
            return item;
        }

        const nested = findFolder(item.children, folderId);
        if (nested) {
            return nested;
        }
    }

    return null;
}

function folderContainsFolder(folder: RequestFolder, targetFolderId: string): boolean {
    return Boolean(findFolder(folder.children, targetFolderId));
}

function folderContainsRequest(folder: RequestFolder, targetRequestId: string): boolean {
    return Boolean(findRequest(folder.children, targetRequestId));
}

function findRequestFolderId(items: CollectionItem[], requestId: string): string | null {
    for (const item of items) {
        if (isFolder(item)) {
            if (findRequest(item.children, requestId)) {
                return item.id;
            }
            continue;
        }

        if (item.id === requestId) {
            return null;
        }
    }

    return null;
}

function collectRequestIds(items: CollectionItem[]): string[] {
    return items.flatMap((item) =>
        isFolder(item) ? collectRequestIds(item.children) : [item.id],
    );
}

function countImportedRequests(draft: ImportedCollectionDraft): number {
    return draft.requests.length + draft.folders.reduce(
        (total, folder) => total + countImportedFolderRequests(folder),
        0,
    );
}

function countImportedFolderRequests(folder: ImportedFolderDraft): number {
    return folder.requests.length + folder.folders.reduce(
        (total, child) => total + countImportedFolderRequests(child),
        0,
    );
}

interface RequestTargetOption {
    id: string;
    collectionId: string;
    folderId: string | null;
    label: string;
}

type FolderTargetOption = RequestTargetOption;

function buildRequestTargetOptions(collections: Collection[]): RequestTargetOption[] {
    const options: RequestTargetOption[] = [];

    const visitFolder = (
        collectionId: string,
        folder: RequestFolder,
        depth: number,
    ) => {
        options.push({
            id: `${collectionId}:${folder.id}`,
            collectionId,
            folderId: folder.id,
            label: `${"  ".repeat(depth)}${folder.name}`,
        });
        for (const item of folder.children) {
            if (isFolder(item)) {
                visitFolder(collectionId, item, depth + 1);
            }
        }
    };

    for (const collection of collections) {
        options.push({
            id: `${collection.id}:root`,
            collectionId: collection.id,
            folderId: null,
            label: collection.name,
        });
        for (const item of collection.items) {
            if (isFolder(item)) {
                visitFolder(collection.id, item, 1);
            }
        }
    }

    return options;
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
    onAddFolder: () => void;
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
    collapsedFolderIds: Set<string>;
    onFolderClick: (folderId: string) => void;
    onFolderDoubleClick: (folder: RequestFolder) => void;
    onFolderContextMenu: (event: ReactMouseEvent<HTMLElement>, folderId: string) => void;
    onFolderDragStart: (event: ReactDragEvent<HTMLElement>, folder: RequestFolder) => void;
    onFolderDragOver: (event: ReactDragEvent<HTMLElement>, folderId: string) => void;
    onFolderDrop: (event: ReactDragEvent<HTMLElement>, folderId: string) => void;
    onFolderAddRequest: (folderId: string) => void;
    onFolderAddFolder: (folderId: string) => void;
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
        onAddFolder,
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
        collapsedFolderIds,
        onFolderClick,
        onFolderDoubleClick,
        onFolderContextMenu,
        onFolderDragStart,
        onFolderDragOver,
        onFolderDrop,
        onFolderAddRequest,
        onFolderAddFolder,
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
                <button
                    className="toolbar-btn small"
                    title="Add Folder"
                    type="button"
                    draggable={false}
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onAddFolder();
                    }}
                    onDoubleClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                    }}
                >
                    <FolderPlus size={12} />
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
                            <FolderNode
                                key={item.id}
                                collectionId={collection.id}
                                folder={item}
                                collapsed={collapsedFolderIds.has(item.id)}
                                collapsedFolderIds={collapsedFolderIds}
                                contextMenu={contextMenu}
                                dragState={dragState}
                                dropTarget={dropTarget}
                                renameTarget={renameTarget}
                                renameDraft={renameDraft}
                                onRenameDraftChange={onRenameDraftChange}
                                onRenameCommit={onRenameCommit}
                                onRenameCancel={onRenameCancel}
                                onClick={() => onFolderClick(item.id)}
                                onDoubleClick={() => onFolderDoubleClick(item)}
                                onContextMenu={(event) => onFolderContextMenu(event, item.id)}
                                onDragOver={(event) => onFolderDragOver(event, item.id)}
                                onDrop={(event) => onFolderDrop(event, item.id)}
                                onAddRequest={() => onFolderAddRequest(item.id)}
                                onAddFolder={() => onFolderAddFolder(item.id)}
                                onRequestOpen={onRequestOpen}
                                onRequestDoubleClick={onRequestDoubleClick}
                                onRequestContextMenu={onRequestContextMenu}
                                onRequestDragStart={onRequestDragStart}
                                onDragEnd={onDragEnd}
                                onRequestDragOver={onRequestDragOver}
                                onRequestDrop={onRequestDrop}
                                onFolderClick={onFolderClick}
                                onFolderDoubleClick={onFolderDoubleClick}
                                onFolderContextMenu={onFolderContextMenu}
                                onFolderDragStart={onFolderDragStart}
                                onFolderDragOver={onFolderDragOver}
                                onFolderDrop={onFolderDrop}
                                onFolderAddRequest={onFolderAddRequest}
                                onFolderAddFolder={onFolderAddFolder}
                            />
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

interface FolderNodeProps {
    collectionId: string;
    folder: RequestFolder;
    collapsed: boolean;
    collapsedFolderIds: Set<string>;
    contextMenu: ContextMenuState | null;
    dragState: DragState | null;
    dropTarget: DropTarget | null;
    renameTarget: RenameTarget | null;
    renameDraft: string;
    onRenameDraftChange: (value: string) => void;
    onRenameCommit: () => void;
    onRenameCancel: () => void;
    onClick: () => void;
    onDoubleClick: () => void;
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
    onDragOver: (event: ReactDragEvent<HTMLElement>) => void;
    onDrop: (event: ReactDragEvent<HTMLElement>) => void;
    onAddRequest: () => void;
    onAddFolder: () => void;
    onRequestOpen: (request: ApiRequest) => void;
    onRequestDoubleClick: (request: ApiRequest) => void;
    onRequestContextMenu: (event: ReactMouseEvent<HTMLElement>, requestId: string) => void;
    onRequestDragStart: (event: ReactDragEvent<HTMLElement>, request: ApiRequest) => void;
    onDragEnd: () => void;
    onRequestDragOver: (event: ReactDragEvent<HTMLElement>, requestId: string) => void;
    onRequestDrop: (event: ReactDragEvent<HTMLElement>, requestId: string) => void;
    onFolderClick: (folderId: string) => void;
    onFolderDoubleClick: (folder: RequestFolder) => void;
    onFolderContextMenu: (event: ReactMouseEvent<HTMLElement>, folderId: string) => void;
    onFolderDragStart: (event: ReactDragEvent<HTMLElement>, folder: RequestFolder) => void;
    onFolderDragOver: (event: ReactDragEvent<HTMLElement>, folderId: string) => void;
    onFolderDrop: (event: ReactDragEvent<HTMLElement>, folderId: string) => void;
    onFolderAddRequest: (folderId: string) => void;
    onFolderAddFolder: (folderId: string) => void;
}

function FolderNode(props: FolderNodeProps) {
    const {
        collectionId,
        folder,
        collapsed,
        collapsedFolderIds,
        contextMenu,
        dragState,
        dropTarget,
        renameTarget,
        renameDraft,
        onRenameDraftChange,
        onRenameCommit,
        onRenameCancel,
        onClick,
        onDoubleClick,
        onContextMenu,
        onDragOver,
        onDrop,
        onAddRequest,
        onAddFolder,
        onRequestOpen,
        onRequestDoubleClick,
        onRequestContextMenu,
        onRequestDragStart,
        onDragEnd,
        onRequestDragOver,
        onRequestDrop,
        onFolderClick,
        onFolderDoubleClick,
        onFolderContextMenu,
        onFolderDragStart,
        onFolderDragOver,
        onFolderDrop,
        onFolderAddRequest,
        onFolderAddFolder,
    } = props;
    const isRenamingFolder = renameTarget?.kind === "folder" &&
        renameTarget.collectionId === collectionId &&
        renameTarget.folderId === folder.id;

    return (
        <div
            className={`folder-node${dropTarget?.kind === "folder" && dropTarget.folderId === folder.id ? " drop-target" : ""}`}
        >
            <div
                className={`folder-item${contextMenu?.kind === "folder" && contextMenu.folderId === folder.id ? " menu-open" : ""}${dragState?.kind === "folder" && dragState.folderId === folder.id ? " dragging-source" : ""}${dropTarget?.kind === "folder" && dropTarget.folderId === folder.id ? " drop-target" : ""}`}
                draggable={!isRenamingFolder}
                data-folder-id={folder.id}
                onClick={onClick}
                onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onDoubleClick();
                }}
                onDragStart={(event) => onFolderDragStart(event, folder)}
                onDragEnd={onDragEnd}
                onDragOver={onDragOver}
                onDrop={onDrop}
                onContextMenu={onContextMenu}
            >
                <span className="collection-disclosure" aria-hidden="true">
                    {collapsed ? "▸" : "▾"}
                </span>
                <FolderOpen size={12} />
                {isRenamingFolder ? (
                    <RenameInput
                        value={renameDraft}
                        ariaLabel="Rename folder"
                        onChange={onRenameDraftChange}
                        onCommit={onRenameCommit}
                        onCancel={onRenameCancel}
                    />
                ) : (
                    <span className="folder-name">{folder.name}</span>
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
                <button
                    className="toolbar-btn small"
                    title="Add Folder"
                    type="button"
                    draggable={false}
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onAddFolder();
                    }}
                    onDoubleClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                    }}
                >
                    <FolderPlus size={12} />
                </button>
            </div>
            {!collapsed && (
                <div className="folder-children">
                    {folder.children.map((item) =>
                        isFolder(item) ? (
                            <FolderNode
                                key={item.id}
                                collectionId={collectionId}
                                folder={item}
                                collapsed={collapsedFolderIds.has(item.id)}
                                collapsedFolderIds={collapsedFolderIds}
                                contextMenu={contextMenu}
                                dragState={dragState}
                                dropTarget={dropTarget}
                                renameTarget={renameTarget}
                                renameDraft={renameDraft}
                                onRenameDraftChange={onRenameDraftChange}
                                onRenameCommit={onRenameCommit}
                                onRenameCancel={onRenameCancel}
                                onClick={() => onFolderClick(item.id)}
                                onDoubleClick={() => onFolderDoubleClick(item)}
                                onContextMenu={(event) => onFolderContextMenu(event, item.id)}
                                onDragOver={(event) => onFolderDragOver(event, item.id)}
                                onDrop={(event) => onFolderDrop(event, item.id)}
                                onAddRequest={() => onFolderAddRequest(item.id)}
                                onAddFolder={() => onFolderAddFolder(item.id)}
                                onRequestOpen={onRequestOpen}
                                onRequestDoubleClick={onRequestDoubleClick}
                                onRequestContextMenu={onRequestContextMenu}
                                onRequestDragStart={onRequestDragStart}
                                onDragEnd={onDragEnd}
                                onRequestDragOver={onRequestDragOver}
                                onRequestDrop={onRequestDrop}
                                onFolderClick={onFolderClick}
                                onFolderDoubleClick={onFolderDoubleClick}
                                onFolderContextMenu={onFolderContextMenu}
                                onFolderDragStart={onFolderDragStart}
                                onFolderDragOver={onFolderDragOver}
                                onFolderDrop={onFolderDrop}
                                onFolderAddRequest={onFolderAddRequest}
                                onFolderAddFolder={onFolderAddFolder}
                            />
                        ) : (
                            <RequestNode
                                key={item.id}
                                collectionId={collectionId}
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
    targetOptions,
    requestName,
    targetId,
    onRequestNameChange,
    onTargetIdChange,
    onCancel,
    onConfirm,
}: {
    targetOptions: RequestTargetOption[];
    requestName: string;
    targetId: string;
    onRequestNameChange: (value: string) => void;
    onTargetIdChange: (value: string) => void;
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
                        <span>Location</span>
                        <select
                            aria-label="Request location"
                            value={targetId}
                            onChange={(event) => onTargetIdChange(event.target.value)}
                        >
                            {targetOptions.map((option) => (
                                <option key={option.id} value={option.id}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    {targetOptions.length === 0 && (
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
                        disabled={targetOptions.length === 0}
                    >
                        Create Request
                    </button>
                </div>
            </form>
        </div>
    );
}

function FolderCreateModal({
    targetOptions,
    folderName,
    targetId,
    onFolderNameChange,
    onTargetIdChange,
    onCancel,
    onConfirm,
}: {
    targetOptions: FolderTargetOption[];
    folderName: string;
    targetId: string;
    onFolderNameChange: (value: string) => void;
    onTargetIdChange: (value: string) => void;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    return (
        <div className="collection-modal-overlay" onClick={onCancel}>
            <form
                className="collection-modal"
                role="dialog"
                aria-modal="true"
                aria-label="New Folder"
                onClick={(event) => event.stopPropagation()}
                onSubmit={(event) => {
                    event.preventDefault();
                    onConfirm();
                }}
            >
                <div className="collection-modal-header">
                    <span className="collection-modal-title">New Folder</span>
                    <button
                        className="collection-modal-close"
                        type="button"
                        aria-label="Close folder modal"
                        onClick={onCancel}
                    >
                        <X size={16} />
                    </button>
                </div>
                <div className="collection-modal-body">
                    <label className="collection-modal-field">
                        <span>Folder name</span>
                        <input
                            aria-label="Folder name"
                            value={folderName}
                            autoFocus
                            onChange={(event) => onFolderNameChange(event.target.value)}
                        />
                    </label>
                    <label className="collection-modal-field">
                        <span>Location</span>
                        <select
                            aria-label="Folder location"
                            value={targetId}
                            onChange={(event) => onTargetIdChange(event.target.value)}
                        >
                            {targetOptions.map((option) => (
                                <option key={option.id} value={option.id}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    {targetOptions.length === 0 && (
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
                        disabled={targetOptions.length === 0}
                    >
                        Create Folder
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
                            <span>{countImportedRequests(parsed.collection)} requests</span>
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

function RunnerModal({
    targetName,
    iterations,
    running,
    saving,
    report,
    recentReports,
    reportsLoading,
    selectedReportId,
    error,
    onIterationsChange,
    onCancel,
    onRun,
    onSelectReport,
    onDeleteReport,
}: {
    targetName: string;
    iterations: number;
    running: boolean;
    saving: boolean;
    report: RunnerReport | null;
    recentReports: RunnerReportEntry[];
    reportsLoading: boolean;
    selectedReportId: string | null;
    error: string;
    onIterationsChange: (value: number) => void;
    onCancel: () => void;
    onRun: () => void;
    onSelectReport: (report: RunnerReportEntry) => void;
    onDeleteReport: (reportId: string) => void;
}) {
    const busy = running || saving;

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !busy) {
                onCancel();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [busy, onCancel]);

    return (
        <div className="collection-modal-overlay" onClick={() => !busy && onCancel()}>
            <form
                className="collection-modal collection-runner-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Run Collection"
                onClick={(event) => event.stopPropagation()}
                onSubmit={(event) => {
                    event.preventDefault();
                    onRun();
                }}
            >
                <div className="collection-modal-header">
                    <span className="collection-modal-title">Run Collection</span>
                    <button
                        className="collection-modal-close"
                        type="button"
                        aria-label="Close runner"
                        disabled={busy}
                        onClick={onCancel}
                    >
                        <X size={16} />
                    </button>
                </div>
                <div className="collection-modal-body">
                    <div className="runner-target">{targetName}</div>
                    <label className="collection-modal-field">
                        <span>Iterations</span>
                        <input
                            aria-label="Runner iterations"
                            type="number"
                            min={1}
                            max={20}
                            value={iterations}
                            disabled={busy}
                            onChange={(event) =>
                                onIterationsChange(Math.max(1, Number(event.target.value) || 1))
                            }
                        />
                    </label>
                    {error && <div className="collection-modal-error">{error}</div>}
                    {saving && <div className="runner-save-status">Saving report...</div>}
                    {report && <RunnerReportView report={report} />}
                    <RunnerReportHistory
                        reports={recentReports}
                        loading={reportsLoading}
                        selectedReportId={selectedReportId}
                        disabled={busy}
                        onSelectReport={onSelectReport}
                        onDeleteReport={onDeleteReport}
                    />
                </div>
                <div className="collection-modal-footer">
                    <button
                        type="button"
                        className="collection-modal-secondary"
                        disabled={busy}
                        onClick={onCancel}
                    >
                        Close
                    </button>
                    <button type="submit" className="collection-modal-primary" disabled={busy}>
                        {running ? "Running" : "Run"}
                    </button>
                </div>
            </form>
        </div>
    );
}

function RunnerReportView({ report }: { report: RunnerReport }) {
    return (
        <div className="runner-report" aria-live="polite">
            <div className="runner-summary">
                <span>{report.totalRequests} requests</span>
                <span>{report.passedTests} passed</span>
                <span>{report.failedTests} failed</span>
                <span>{report.durationMs}ms</span>
            </div>
            <div className="runner-results">
                {report.results.map((result, index) => (
                    <div
                        key={`${result.requestId}-${result.iteration}-${index}`}
                        className={`runner-result${result.error || result.tests.some((test) => !test.passed) ? " failed" : " passed"}`}
                    >
                        <div className="runner-result-main">
                            <span>#{result.iteration}</span>
                            <strong>{result.method} {result.requestName}</strong>
                            <em>{result.status > 0 ? `${result.status} ${result.statusText}` : result.statusText}</em>
                        </div>
                        {result.error && <div className="runner-result-error">{result.error}</div>}
                        {result.tests.length > 0 && (
                            <div className="runner-tests">
                                {result.tests.map((test, testIndex) => (
                                    <span
                                        key={`${test.name}-${testIndex}`}
                                        className={test.passed ? "passed" : "failed"}
                                    >
                                        {test.passed ? "PASS" : "FAIL"} {test.name}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

function RunnerReportHistory({
    reports,
    loading,
    selectedReportId,
    disabled,
    onSelectReport,
    onDeleteReport,
}: {
    reports: RunnerReportEntry[];
    loading: boolean;
    selectedReportId: string | null;
    disabled: boolean;
    onSelectReport: (report: RunnerReportEntry) => void;
    onDeleteReport: (reportId: string) => void;
}) {
    return (
        <div className="runner-history" aria-label="Recent runner reports">
            <div className="runner-history-title">Recent Reports</div>
            {loading && <div className="runner-history-empty">Loading reports...</div>}
            {!loading && reports.length === 0 && (
                <div className="runner-history-empty">No saved runner reports yet.</div>
            )}
            {!loading && reports.map((entry) => (
                <div
                    key={entry.id}
                    className={`runner-history-row${selectedReportId === entry.id ? " active" : ""}`}
                >
                    <button
                        type="button"
                        className="runner-history-select"
                        aria-label={`Open runner report ${entry.targetName}`}
                        disabled={disabled}
                        onClick={() => onSelectReport(entry)}
                    >
                        <span>{entry.targetName}</span>
                        <em>{entry.totalRequests} requests · {entry.failedTests} failed · {formatReportTime(entry.createdAt)}</em>
                    </button>
                    <button
                        type="button"
                        className="runner-history-delete"
                        aria-label={`Delete runner report ${entry.targetName}`}
                        title="Delete report"
                        disabled={disabled}
                        onClick={() => onDeleteReport(entry.id)}
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            ))}
        </div>
    );
}

function formatReportTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
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
    const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(
        () => new Set(),
    );
    const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
    const [renameDraft, setRenameDraft] = useState("");
    const [requestModalOpen, setRequestModalOpen] = useState(false);
    const [requestDraftName, setRequestDraftName] = useState("New Request");
    const [requestDraftTargetId, setRequestDraftTargetId] = useState("");
    const [folderModalOpen, setFolderModalOpen] = useState(false);
    const [folderDraftName, setFolderDraftName] = useState("New Folder");
    const [folderDraftTargetId, setFolderDraftTargetId] = useState("");
    const [importModalOpen, setImportModalOpen] = useState(false);
    const [importDraft, setImportDraft] = useState("");
    const [importError, setImportError] = useState("");
    const [parsedImport, setParsedImport] = useState<ParsedApiSpecImport | null>(null);
    const [importing, setImporting] = useState(false);
    const [runnerModal, setRunnerModal] = useState<RunnerModalState | null>(null);
    const [runnerIterations, setRunnerIterations] = useState(1);
    const [runnerRunning, setRunnerRunning] = useState(false);
    const [runnerSaving, setRunnerSaving] = useState(false);
    const [runnerReport, setRunnerReport] = useState<RunnerReport | null>(null);
    const [runnerReports, setRunnerReports] = useState<RunnerReportEntry[]>([]);
    const [runnerReportsLoading, setRunnerReportsLoading] = useState(false);
    const [selectedRunnerReportId, setSelectedRunnerReportId] = useState<string | null>(null);
    const [runnerError, setRunnerError] = useState("");
    const [exportArtifact, setExportArtifact] = useState<ExportJsonModalArtifact | null>(null);

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

    const toggleFolder = (folderId: string) => {
        setCollapsedFolderIds((prev) => {
            const next = new Set(prev);
            if (next.has(folderId)) {
                next.delete(folderId);
            } else {
                next.add(folderId);
            }
            return next;
        });
    };

    const beginRenameCollection = (collection: Collection) => {
        setContextMenu(null);
        setRenameTarget({ kind: "collection", collectionId: collection.id });
        setRenameDraft(collection.name);
    };

    const beginRenameFolder = (collectionId: string, folder: RequestFolder) => {
        setContextMenu(null);
        setRenameTarget({ kind: "folder", collectionId, folderId: folder.id });
        setRenameDraft(folder.name);
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

    const requestTargetOptions = buildRequestTargetOptions(state.collections);
    const folderTargetOptions: FolderTargetOption[] = requestTargetOptions;

    const getRequestTargetId = (collectionId?: string, folderId?: string | null): string => {
        if (collectionId && folderId) {
            return `${collectionId}:${folderId}`;
        }
        if (collectionId) {
            return `${collectionId}:root`;
        }
        return requestTargetOptions[0]?.id ?? "";
    };

    const resolveRequestTarget = (targetId: string): RequestTargetOption | null =>
        requestTargetOptions.find((option) => option.id === targetId) ?? null;
    const resolveFolderTarget = (targetId: string): FolderTargetOption | null =>
        folderTargetOptions.find((option) => option.id === targetId) ?? null;

    const openRequestCreateModal = (collectionId?: string, folderId?: string | null) => {
        const targetId = resolveRequestTarget(getRequestTargetId(collectionId, folderId))?.id
            ?? requestTargetOptions[0]?.id
            ?? "";
        setContextMenu(null);
        setRequestDraftName("New Request");
        setRequestDraftTargetId(targetId);
        setRequestModalOpen(true);
    };

    const closeRequestCreateModal = () => {
        setRequestModalOpen(false);
        setRequestDraftName("New Request");
        setRequestDraftTargetId("");
    };

    const openFolderCreateModal = (collectionId?: string, parentFolderId?: string | null) => {
        const targetId = resolveFolderTarget(getRequestTargetId(collectionId, parentFolderId))?.id
            ?? folderTargetOptions[0]?.id
            ?? "";
        setContextMenu(null);
        setFolderDraftName("New Folder");
        setFolderDraftTargetId(targetId);
        setFolderModalOpen(true);
    };

    const closeFolderCreateModal = () => {
        setFolderModalOpen(false);
        setFolderDraftName("New Folder");
        setFolderDraftTargetId("");
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

    const openRunnerModal = (nextRunnerModal: RunnerModalState) => {
        setContextMenu(null);
        setRunnerModal(nextRunnerModal);
        setRunnerIterations(1);
        setRunnerReport(null);
        setSelectedRunnerReportId(null);
        setRunnerError("");
        void refreshRunnerReports();
    };

    const closeRunnerModal = () => {
        if (runnerRunning || runnerSaving) {
            return;
        }
        setRunnerModal(null);
        setRunnerReport(null);
        setSelectedRunnerReportId(null);
        setRunnerError("");
    };

    const refreshRunnerReports = async () => {
        setRunnerReportsLoading(true);
        try {
            const reports = await listRunnerReports(12, 0);
            setRunnerReports(reports);
        } catch (error) {
            setRunnerError(error instanceof Error ? error.message : "Failed to load runner reports.");
        } finally {
            setRunnerReportsLoading(false);
        }
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

    const persistImportedRequest = async (
        collectionId: string,
        requestDraft: ImportedRequestDraft,
        folderId: string | null,
    ): Promise<ApiRequest> => {
        const request = await createRequestApi(collectionId, requestDraft.name, folderId);
        const nextRequest: ApiRequest = {
            ...request,
            method: requestDraft.method,
            url: requestDraft.url,
            params: requestDraft.params,
            headers: requestDraft.headers,
            body: requestDraft.body,
            auth: requestDraft.auth,
        };
        await updateRequestApi(nextRequest, collectionId, folderId);
        return nextRequest;
    };

    const persistImportedFolder = async (
        collectionId: string,
        folderDraft: ImportedFolderDraft,
        parentFolderId: string | null,
    ): Promise<RequestFolder> => {
        const folder = await createFolderApi({
            collectionId,
            parentFolderId,
            name: folderDraft.name,
        });
        const children: CollectionItem[] = [];

        for (const requestDraft of folderDraft.requests) {
            children.push(await persistImportedRequest(collectionId, requestDraft, folder.id));
        }
        for (const childFolderDraft of folderDraft.folders) {
            children.push(await persistImportedFolder(collectionId, childFolderDraft, folder.id));
        }

        return { ...folder, children };
    };

    const persistImportedCollection = async (draft: ImportedCollectionDraft) => {
        const collection = await createCollectionApi(draft.name);
        const importedItems: CollectionItem[] = [];
        for (const requestDraft of draft.requests) {
            importedItems.push(await persistImportedRequest(collection.id, requestDraft, null));
        }
        for (const folderDraft of draft.folders) {
            importedItems.push(await persistImportedFolder(collection.id, folderDraft, null));
        }
        dispatch({
            type: "ADD_COLLECTION",
            collection: { ...collection, items: importedItems },
        });

        return { collection, importedItems };
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

    const handleRunTarget = async () => {
        if (!runnerModal || runnerRunning) {
            return;
        }

        setRunnerRunning(true);
        setRunnerError("");
        setRunnerReport(null);
        setSelectedRunnerReportId(null);
        try {
            const report = await runCollectionTarget(
                state,
                runnerModal.target,
                runnerIterations,
            );
            setRunnerReport(report);
            setRunnerSaving(true);
            const savedReport = await addRunnerReport(report);
            setRunnerReports((reports) => [savedReport, ...reports.filter((entry) => entry.id !== savedReport.id)].slice(0, 12));
            setSelectedRunnerReportId(savedReport.id);
        } catch (error) {
            setRunnerError(error instanceof Error ? error.message : "Failed to run collection.");
        } finally {
            setRunnerSaving(false);
            setRunnerRunning(false);
        }
    };

    const selectRunnerReport = (report: RunnerReportEntry) => {
        setRunnerReport(report);
        setSelectedRunnerReportId(report.id);
        setRunnerError("");
    };

    const handleDeleteRunnerReport = async (reportId: string) => {
        if (runnerRunning || runnerSaving) {
            return;
        }
        try {
            await deleteRunnerReport(reportId);
            setRunnerReports((reports) => reports.filter((entry) => entry.id !== reportId));
            if (selectedRunnerReportId === reportId) {
                setSelectedRunnerReportId(null);
                setRunnerReport(null);
            }
        } catch (error) {
            setRunnerError(error instanceof Error ? error.message : "Failed to delete runner report.");
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

        if (target.kind === "folder") {
            const collection = state.collections.find((entry) => entry.id === target.collectionId);
            const folder = collection ? findFolder(collection.items, target.folderId) : null;
            if (!collection || !folder || folder.name === nextName) {
                return;
            }

            try {
                await renameFolderApi(folder.id, nextName);
                dispatch({
                    type: "UPDATE_FOLDER",
                    collectionId: collection.id,
                    folderId: folder.id,
                    folder: { name: nextName },
                });
            } catch (err) {
                console.error("Failed to rename folder:", err);
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
            await updateRequestApi(
                nextRequest,
                collection.id,
                findRequestFolderId(collection.items, request.id) ?? null,
            );
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
            if (
                parsed.kind === "folder" &&
                typeof parsed.collectionId === "string" &&
                typeof parsed.folderId === "string"
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

    const handleFolderDragStart = (
        event: ReactDragEvent<HTMLElement>,
        collection: Collection,
        folder: RequestFolder,
    ) => {
        const nextDragState: DragState = {
            kind: "folder",
            collectionId: collection.id,
            folderId: folder.id,
        };
        setDragState(nextDragState);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(COLLECTION_TREE_DRAG_TYPE, JSON.stringify(nextDragState));

        const preview = buildDragImage(folder.name);
        if (preview) {
            event.dataTransfer.setDragImage(preview, 18, 18);
        }
    };

    const canDropFolderIntoTarget = (sourceFolderId: string, targetFolderId: string | null): boolean => {
        if (!targetFolderId) {
            return true;
        }
        if (sourceFolderId === targetFolderId) {
            return false;
        }

        const sourceCollection = state.collections.find((entry) =>
            Boolean(findFolder(entry.items, sourceFolderId)),
        );
        const sourceFolder = sourceCollection
            ? findFolder(sourceCollection.items, sourceFolderId)
            : null;
        return sourceFolder ? !folderContainsFolder(sourceFolder, targetFolderId) : true;
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
        if (!currentDragState || currentDragState.kind === "collection") {
            return;
        }

        if (currentDragState.kind === "request" && currentDragState.requestId === targetRequestId) {
            return;
        }

        if (currentDragState.kind === "folder") {
            const sourceCollection = state.collections.find((entry) =>
                entry.id === currentDragState.collectionId,
            );
            const sourceFolder = sourceCollection
                ? findFolder(sourceCollection.items, currentDragState.folderId)
                : null;
            if (sourceFolder && folderContainsRequest(sourceFolder, targetRequestId)) {
                return;
            }
            const targetCollection = state.collections.find((entry) => entry.id === targetCollectionId);
            const targetParentFolderId = targetCollection
                ? findRequestFolderId(targetCollection.items, targetRequestId)
                : null;
            if (!canDropFolderIntoTarget(currentDragState.folderId, targetParentFolderId)) {
                return;
            }
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

    const handleDragOverFolder = (
        event: ReactDragEvent<HTMLElement>,
        targetCollectionId: string,
        targetFolderId: string,
    ) => {
        const currentDragState = readDragState(event);
        if (!currentDragState || currentDragState.kind === "collection") {
            return;
        }

        if (
            currentDragState.kind === "folder" &&
            !canDropFolderIntoTarget(currentDragState.folderId, targetFolderId)
        ) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setDropTarget({
            kind: "folder",
            collectionId: targetCollectionId,
            folderId: targetFolderId,
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

            if (currentDragState.kind === "folder") {
                await moveFolderApi({
                    folderId: currentDragState.folderId,
                    targetCollectionId,
                    targetParentFolderId: null,
                    beforeItemId: null,
                });
                dispatch({
                    type: "MOVE_FOLDER",
                    folderId: currentDragState.folderId,
                    fromCollectionId: currentDragState.collectionId,
                    toCollectionId: targetCollectionId,
                    toParentFolderId: null,
                    beforeItemId: null,
                });
                return;
            }

            await moveRequestApi({
                requestId: currentDragState.requestId,
                targetCollectionId,
                targetFolderId: null,
                beforeRequestId: null,
            });
            dispatch({
                type: "MOVE_REQUEST",
                requestId: currentDragState.requestId,
                fromCollectionId: currentDragState.collectionId,
                toCollectionId: targetCollectionId,
                toFolderId: null,
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
        if (!currentDragState || currentDragState.kind === "collection") {
            return;
        }
        if (currentDragState.kind === "request" && currentDragState.requestId === beforeRequestId) {
            clearDragState();
            return;
        }

        const targetCollection = state.collections.find((entry) => entry.id === targetCollectionId);
        const targetFolderId = targetCollection
            ? findRequestFolderId(targetCollection.items, beforeRequestId)
            : null;

        if (
            currentDragState.kind === "folder" &&
            !canDropFolderIntoTarget(currentDragState.folderId, targetFolderId)
        ) {
            clearDragState();
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        clearDragState();

        try {
            if (currentDragState.kind === "folder") {
                await moveFolderApi({
                    folderId: currentDragState.folderId,
                    targetCollectionId,
                    targetParentFolderId: targetFolderId,
                    beforeItemId: beforeRequestId,
                });
                dispatch({
                    type: "MOVE_FOLDER",
                    folderId: currentDragState.folderId,
                    fromCollectionId: currentDragState.collectionId,
                    toCollectionId: targetCollectionId,
                    toParentFolderId: targetFolderId,
                    beforeItemId: beforeRequestId,
                });
                return;
            }

            await moveRequestApi({
                requestId: currentDragState.requestId,
                targetCollectionId,
                targetFolderId,
                beforeRequestId,
            });
            dispatch({
                type: "MOVE_REQUEST",
                requestId: currentDragState.requestId,
                fromCollectionId: currentDragState.collectionId,
                toCollectionId: targetCollectionId,
                toFolderId: targetFolderId,
                beforeRequestId,
            });
        } catch (err) {
            console.error("Failed to move request:", err);
        }
    };

    const commitFolderDrop = async (
        event: ReactDragEvent<HTMLElement>,
        targetCollectionId: string,
        targetFolderId: string,
    ) => {
        const currentDragState = readDragState(event);
        if (!currentDragState || currentDragState.kind === "collection") {
            return;
        }

        if (
            currentDragState.kind === "folder" &&
            !canDropFolderIntoTarget(currentDragState.folderId, targetFolderId)
        ) {
            clearDragState();
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        clearDragState();

        try {
            if (currentDragState.kind === "folder") {
                await moveFolderApi({
                    folderId: currentDragState.folderId,
                    targetCollectionId,
                    targetParentFolderId: targetFolderId,
                    beforeItemId: null,
                });
                dispatch({
                    type: "MOVE_FOLDER",
                    folderId: currentDragState.folderId,
                    fromCollectionId: currentDragState.collectionId,
                    toCollectionId: targetCollectionId,
                    toParentFolderId: targetFolderId,
                    beforeItemId: null,
                });
                return;
            }

            await moveRequestApi({
                requestId: currentDragState.requestId,
                targetCollectionId,
                targetFolderId,
                beforeRequestId: null,
            });
            dispatch({
                type: "MOVE_REQUEST",
                requestId: currentDragState.requestId,
                fromCollectionId: currentDragState.collectionId,
                toCollectionId: targetCollectionId,
                toFolderId: targetFolderId,
                beforeRequestId: null,
            });
        } catch (err) {
            console.error("Failed to move request to folder:", err);
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

    const handleAddFolder = async (
        collectionId: string,
        parentFolderId?: string | null,
        name = "New Folder",
    ): Promise<boolean> => {
        setContextMenu(null);
        try {
            const folder = await createFolderApi({
                collectionId,
                parentFolderId: parentFolderId ?? null,
                name,
            });
            dispatch({
                type: "ADD_FOLDER_TO_COLLECTION",
                collectionId,
                parentFolderId: parentFolderId ?? null,
                folder,
            });
            setCollapsedFolderIds((prev) => {
                const next = new Set(prev);
                if (parentFolderId) {
                    next.delete(parentFolderId);
                }
                return next;
            });
            return true;
        } catch (err) {
            console.error("Failed to create folder:", err);
            return false;
        }
    };

    const handleCreateFolder = async () => {
        const target = resolveFolderTarget(folderDraftTargetId);
        const name = folderDraftName.trim() || "New Folder";
        if (!target) {
            return;
        }

        if (await handleAddFolder(target.collectionId, target.folderId, name)) {
            closeFolderCreateModal();
        }
    };

    const handleCreateRequest = async () => {
        const target = resolveRequestTarget(requestDraftTargetId);
        const name = requestDraftName.trim() || "New Request";
        if (!target) {
            return;
        }

        try {
            const req = await createRequestApi(target.collectionId, name, target.folderId);
            dispatch({
                type: "ADD_REQUEST_TO_COLLECTION",
                collectionId: target.collectionId,
                folderId: target.folderId,
                request: req,
            });
            if (target.folderId) {
                setCollapsedFolderIds((prev) => {
                    const next = new Set(prev);
                    next.delete(target.folderId!);
                    return next;
                });
            }
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

    const handleFolderContextMenu = (
        event: ReactMouseEvent<HTMLElement>,
        collectionId: string,
        folderId: string,
    ) => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenu({
            kind: "folder",
            collectionId,
            folderId,
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

    const handleRenameFolder = async (collectionId: string, folderId: string) => {
        const collection = state.collections.find((entry) => entry.id === collectionId);
        const folder = collection ? findFolder(collection.items, folderId) : null;
        if (!collection || !folder) {
            return;
        }

        beginRenameFolder(collection.id, folder);
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

    const handleDeleteFolder = async (collectionId: string, folderId: string) => {
        setContextMenu(null);

        const collection = state.collections.find((entry) => entry.id === collectionId);
        const folder = collection ? findFolder(collection.items, folderId) : null;
        if (!folder) {
            return;
        }

        try {
            await deleteFolderApi(folder.id);
            for (const requestId of collectRequestIds(folder.children)) {
                context.closeTab(getRequestTabId(requestId));
            }
            dispatch({ type: "DELETE_FOLDER", collectionId, folderId: folder.id });
        } catch (err) {
            console.error("Failed to delete folder:", err);
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

    const handleRunCollection = (collectionId: string) => {
        const collection = state.collections.find((entry) => entry.id === collectionId);
        if (!collection) {
            return;
        }
        openRunnerModal({
            target: { kind: "collection", collectionId },
            targetName: collection.name,
        });
    };

    const handleRunFolder = (collectionId: string, folderId: string) => {
        const collection = state.collections.find((entry) => entry.id === collectionId);
        const folder = collection ? findFolder(collection.items, folderId) : null;
        if (!folder) {
            return;
        }
        openRunnerModal({
            target: { kind: "folder", collectionId, folderId },
            targetName: folder.name,
        });
    };

    const handleExportCollection = (collectionId: string) => {
        const collection = state.collections.find((entry) => entry.id === collectionId);
        if (!collection) {
            return;
        }

        setContextMenu(null);
        const artifact = exportCollectionAsPostman(collection);
        setExportArtifact({
            title: `Export ${collection.name}`,
            fileName: artifact.fileName,
            json: artifact.json,
        });
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
                {contextMenu.kind !== "request" && (
                    <button
                        className="context-menu-item"
                        type="button"
                        onClick={() => {
                            if (contextMenu.kind === "collection") {
                                handleRunCollection(contextMenu.collectionId);
                                return;
                            }

                            handleRunFolder(contextMenu.collectionId, contextMenu.folderId);
                        }}
                    >
                        Run
                    </button>
                )}
                {contextMenu.kind === "collection" && (
                    <button
                        className="context-menu-item"
                        type="button"
                        onClick={() => handleExportCollection(contextMenu.collectionId)}
                    >
                        <Download size={13} />
                        <span>Export</span>
                    </button>
                )}
                <button
                    className="context-menu-item"
                    type="button"
                    onClick={() => {
                        if (contextMenu.kind === "collection") {
                            void handleRenameCollection(contextMenu.collectionId);
                            return;
                        }
                        if (contextMenu.kind === "folder") {
                            void handleRenameFolder(contextMenu.collectionId, contextMenu.folderId);
                            return;
                        }

                        void handleRenameRequest(contextMenu.collectionId, contextMenu.requestId);
                    }}
                >
                    Rename
                </button>
                {contextMenu.kind !== "request" && (
                    <button
                        className="context-menu-item"
                        type="button"
                        onClick={() => {
                            if (contextMenu.kind === "collection") {
                                void handleAddFolder(contextMenu.collectionId, null);
                                return;
                            }

                            void handleAddFolder(contextMenu.collectionId, contextMenu.folderId);
                        }}
                    >
                        New Folder
                    </button>
                )}
                <button
                    className="context-menu-item danger"
                    type="button"
                    onClick={() => {
                        if (contextMenu.kind === "collection") {
                            void handleDeleteCollection(contextMenu.collectionId);
                            return;
                        }
                        if (contextMenu.kind === "folder") {
                            void handleDeleteFolder(contextMenu.collectionId, contextMenu.folderId);
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
                    title="New Folder"
                    type="button"
                    onClick={() => openFolderCreateModal()}
                >
                    <FolderPlus size={14} />
                </button>
                <button
                    className="toolbar-btn"
                    title="New Collection"
                    type="button"
                    onClick={handleAddCollection}
                >
                    <LibraryBig size={14} />
                </button>
                <button
                    className="toolbar-btn"
                    title="Run First Collection"
                    type="button"
                    onClick={() => {
                        const collectionId = state.collections[0]?.id;
                        if (collectionId) {
                            handleRunCollection(collectionId);
                        }
                    }}
                >
                    <Play size={14} />
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
                        onAddFolder={() => {
                            openFolderCreateModal(col.id, null);
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
                        onFolderDragStart={(event, folder) => handleFolderDragStart(event, col, folder)}
                        onRequestDragOver={(event, requestId) =>
                            handleDragOverRequest(event, col.id, requestId)
                        }
                        onRequestDrop={(event, requestId) => {
                            void commitRequestDrop(event, col.id, requestId);
                        }}
                        collapsedFolderIds={collapsedFolderIds}
                        onFolderClick={toggleFolder}
                        onFolderDoubleClick={(folder) => beginRenameFolder(col.id, folder)}
                        onFolderContextMenu={(event, folderId) =>
                            handleFolderContextMenu(event, col.id, folderId)
                        }
                        onFolderDragOver={(event, folderId) =>
                            handleDragOverFolder(event, col.id, folderId)
                        }
                        onFolderDrop={(event, folderId) => {
                            void commitFolderDrop(event, col.id, folderId);
                        }}
                        onFolderAddRequest={(folderId) => openRequestCreateModal(col.id, folderId)}
                        onFolderAddFolder={(folderId) => {
                            openFolderCreateModal(col.id, folderId);
                        }}
                    />
                ))}
            </div>
            {contextMenuPortal}
            {requestModalOpen && typeof document !== "undefined" && createPortal(
                <RequestCreateModal
                    targetOptions={requestTargetOptions}
                    requestName={requestDraftName}
                    targetId={requestDraftTargetId}
                    onRequestNameChange={setRequestDraftName}
                    onTargetIdChange={setRequestDraftTargetId}
                    onCancel={closeRequestCreateModal}
                    onConfirm={() => {
                        void handleCreateRequest();
                    }}
                />,
                document.body,
            )}
            {folderModalOpen && typeof document !== "undefined" && createPortal(
                <FolderCreateModal
                    targetOptions={folderTargetOptions}
                    folderName={folderDraftName}
                    targetId={folderDraftTargetId}
                    onFolderNameChange={setFolderDraftName}
                    onTargetIdChange={setFolderDraftTargetId}
                    onCancel={closeFolderCreateModal}
                    onConfirm={() => {
                        void handleCreateFolder();
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
            {runnerModal && typeof document !== "undefined" && createPortal(
                <RunnerModal
                    targetName={runnerModal.targetName}
                    iterations={runnerIterations}
                    running={runnerRunning}
                    saving={runnerSaving}
                    report={runnerReport}
                    recentReports={runnerReports}
                    reportsLoading={runnerReportsLoading}
                    selectedReportId={selectedRunnerReportId}
                    error={runnerError}
                    onIterationsChange={setRunnerIterations}
                    onCancel={closeRunnerModal}
                    onRun={() => {
                        void handleRunTarget();
                    }}
                    onSelectReport={selectRunnerReport}
                    onDeleteReport={(reportId) => {
                        void handleDeleteRunnerReport(reportId);
                    }}
                />,
                document.body,
            )}
            {exportArtifact && typeof document !== "undefined" && createPortal(
                <ExportJsonModal
                    artifact={exportArtifact}
                    onClose={() => setExportArtifact(null)}
                />,
                document.body,
            )}
        </div>
    );
}
