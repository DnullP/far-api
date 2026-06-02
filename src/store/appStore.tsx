/**
 * App-level state management for far-api using React context + useReducer.
 * On startup, loads persisted data from the Tauri SQLite backend.
 */
import { createContext, useContext, useReducer, useEffect, type Dispatch, type ReactNode } from "react";
import {
    type ApiRequest,
    type ApiResponse,
    type Collection,
    type Environment,
    type RequestFolder,
    createKeyValuePair,
    createRequestAuth,
    createRequestScripts,
    isFolder,
} from "../types/api";
import { createVariableResolver } from "../services/requestResolver";
import {
    fetchCollections,
    fetchEnvironments,
    fetchAllHistory,
    getConfig,
    setConfig,
    createCollectionApi,
    createRequestApi,
    updateRequestApi,
    createEnvironmentApi,
    updateEnvironmentApi,
    type HistoryEntry,
} from "../services/persistence";
import { logger } from "../services/logger";
/* ---------- State shape ---------- */

export interface AppState {
    collections: Collection[];
    environments: Environment[];
    activeEnvironmentId: string | null;
    historyEntries: HistoryEntry[];
    /** tabId → request mapping */
    openRequests: Record<string, ApiRequest>;
    /** tabId → response */
    responses: Record<string, ApiResponse | null>;
    /** tabId → loading */
    loadingRequests: Record<string, boolean>;
}

const initialState: AppState = {
    collections: [],
    environments: [],
    activeEnvironmentId: null,
    historyEntries: [],
    openRequests: {},
    responses: {},
    loadingRequests: {},
};

/* ---------- Actions ---------- */

type Action =
    | { type: "LOAD_COLLECTIONS"; collections: Collection[] }
    | { type: "LOAD_ENVIRONMENTS"; environments: Environment[]; activeEnvironmentId: string | null }
    | { type: "LOAD_HISTORY"; entries: HistoryEntry[] }
    | { type: "ADD_HISTORY_ENTRY"; entry: HistoryEntry }
    | { type: "DELETE_HISTORY_ENTRY"; entryId: string }
    | { type: "CLEAR_HISTORY" }
    | { type: "ADD_COLLECTION"; collection: Collection }
    | { type: "ADD_FOLDER_TO_COLLECTION"; collectionId: string; parentFolderId?: string | null; folder: RequestFolder }
    | { type: "ADD_REQUEST_TO_COLLECTION"; collectionId: string; folderId?: string | null; request: ApiRequest }
    | { type: "OPEN_REQUEST"; tabId: string; request: ApiRequest }
    | { type: "UPDATE_COLLECTION"; collectionId: string; collection: Partial<Collection> }
    | { type: "UPDATE_FOLDER"; collectionId: string; folderId: string; folder: Partial<RequestFolder> }
    | { type: "UPDATE_REQUEST_BY_ID"; requestId: string; request: Partial<ApiRequest> }
    | { type: "REORDER_COLLECTIONS"; collectionIds: string[] }
    | {
        type: "MOVE_REQUEST";
        requestId: string;
        fromCollectionId: string;
        toCollectionId: string;
        toFolderId?: string | null;
        beforeRequestId?: string | null;
    }
    | {
        type: "MOVE_FOLDER";
        folderId: string;
        fromCollectionId: string;
        toCollectionId: string;
        toParentFolderId?: string | null;
        beforeItemId?: string | null;
    }
    | { type: "SET_RESPONSE"; tabId: string; response: ApiResponse | null }
    | { type: "SET_LOADING"; tabId: string; loading: boolean }
    | { type: "SET_ACTIVE_ENVIRONMENT"; envId: string | null }
    | { type: "ADD_ENVIRONMENT"; environment: Environment }
    | { type: "UPDATE_ENVIRONMENT"; envId: string; env: Partial<Environment> }
    | { type: "DELETE_ENVIRONMENT"; envId: string }
    | { type: "REMOVE_TAB"; tabId: string }
    | { type: "DELETE_COLLECTION"; collectionId: string }
    | { type: "DELETE_FOLDER"; collectionId: string; folderId: string }
    | { type: "DELETE_REQUEST"; collectionId: string; requestId: string };

type CollectionItem = Collection["items"][number];

function updateRequestItems(
    items: CollectionItem[],
    requestId: string,
    request: Partial<ApiRequest>,
): CollectionItem[] {
    let changed = false;
    const nextItems = items.map((item) => {
        if (isFolder(item)) {
            const nextChildren = updateRequestItems(item.children, requestId, request);
            if (nextChildren !== item.children) {
                changed = true;
                return { ...item, children: nextChildren };
            }
            return item;
        }

        if (item.id !== requestId) {
            return item;
        }

        changed = true;
        return { ...item, ...request };
    });

    return changed ? nextItems : items;
}

function normalizeRequest(request: ApiRequest): ApiRequest {
    return {
        ...request,
        auth: createRequestAuth(request.auth),
        scripts: createRequestScripts(request.scripts),
    };
}

function normalizeItem(item: CollectionItem): CollectionItem {
    return isFolder(item)
        ? { ...item, children: item.children.map(normalizeItem) }
        : normalizeRequest(item);
}

function normalizeCollections(collections: Collection[]): Collection[] {
    return collections.map((collection) => ({
        ...collection,
        items: collection.items.map(normalizeItem),
    }));
}

function removeRequestItems(items: CollectionItem[], requestId: string): CollectionItem[] {
    let changed = false;
    const nextItems: CollectionItem[] = [];

    for (const item of items) {
        if (isFolder(item)) {
            const nextChildren = removeRequestItems(item.children, requestId);
            if (nextChildren !== item.children) {
                changed = true;
                nextItems.push({ ...item, children: nextChildren });
                continue;
            }

            nextItems.push(item);
            continue;
        }

        if (item.id === requestId) {
            changed = true;
            continue;
        }

        nextItems.push(item);
    }

    return changed ? nextItems : items;
}

function collectRequestIds(items: CollectionItem[]): string[] {
    return items.flatMap((item) =>
        isFolder(item) ? collectRequestIds(item.children) : [item.id],
    );
}

function insertFolderItem(
    items: CollectionItem[],
    folder: RequestFolder,
    parentFolderId?: string | null,
    beforeItemId?: string | null,
): CollectionItem[] {
    if (!parentFolderId) {
        if (beforeItemId) {
            const insertAt = items.findIndex((item) => item.id === beforeItemId);
            if (insertAt >= 0) {
                return [
                    ...items.slice(0, insertAt),
                    folder,
                    ...items.slice(insertAt),
                ];
            }
        }
        return [...items, folder];
    }

    let changed = false;
    const nextItems = items.map((item) => {
        if (!isFolder(item)) {
            return item;
        }

        if (item.id === parentFolderId) {
            changed = true;
            return {
                ...item,
                children: insertFolderItem(item.children, folder, null, beforeItemId),
            };
        }

        const nextChildren = insertFolderItem(item.children, folder, parentFolderId, beforeItemId);
        if (nextChildren !== item.children) {
            changed = true;
            return { ...item, children: nextChildren };
        }

        return item;
    });

    return changed ? nextItems : items;
}

function updateFolderItems(
    items: CollectionItem[],
    folderId: string,
    folder: Partial<RequestFolder>,
): CollectionItem[] {
    let changed = false;
    const nextItems = items.map((item) => {
        if (!isFolder(item)) {
            return item;
        }

        if (item.id === folderId) {
            changed = true;
            return { ...item, ...folder };
        }

        const nextChildren = updateFolderItems(item.children, folderId, folder);
        if (nextChildren !== item.children) {
            changed = true;
            return { ...item, children: nextChildren };
        }

        return item;
    });

    return changed ? nextItems : items;
}

function removeFolderItems(
    items: CollectionItem[],
    folderId: string,
): { items: CollectionItem[]; requestIds: string[]; changed: boolean } {
    let changed = false;
    const requestIds: string[] = [];
    const nextItems: CollectionItem[] = [];

    for (const item of items) {
        if (!isFolder(item)) {
            nextItems.push(item);
            continue;
        }

        if (item.id === folderId) {
            changed = true;
            requestIds.push(...collectRequestIds(item.children));
            continue;
        }

        const childResult = removeFolderItems(item.children, folderId);
        if (childResult.changed) {
            changed = true;
            requestIds.push(...childResult.requestIds);
            nextItems.push({ ...item, children: childResult.items });
            continue;
        }

        nextItems.push(item);
    }

    return { items: changed ? nextItems : items, requestIds, changed };
}

function takeFolderItem(
    items: CollectionItem[],
    folderId: string,
): { items: CollectionItem[]; folder: RequestFolder | null; changed: boolean } {
    let changed = false;
    let foundFolder: RequestFolder | null = null;
    const nextItems: CollectionItem[] = [];

    for (const item of items) {
        if (!isFolder(item)) {
            nextItems.push(item);
            continue;
        }

        if (item.id === folderId) {
            changed = true;
            foundFolder = item;
            continue;
        }

        const childResult = takeFolderItem(item.children, folderId);
        if (childResult.changed) {
            changed = true;
            foundFolder = childResult.folder;
            nextItems.push({ ...item, children: childResult.items });
            continue;
        }

        nextItems.push(item);
    }

    return {
        items: changed ? nextItems : items,
        folder: foundFolder,
        changed,
    };
}

function omitKeys<T>(record: Record<string, T>, keys: Set<string>): Record<string, T> {
    if (keys.size === 0) {
        return record;
    }

    const next = { ...record };
    for (const key of keys) {
        delete next[key];
    }
    return next;
}

function removeRequestStateByIds(state: AppState, requestIds: string[]) {
    if (requestIds.length === 0) {
        return {
            openRequests: state.openRequests,
            responses: state.responses,
            loadingRequests: state.loadingRequests,
        };
    }

    const requestIdSet = new Set(requestIds);
    const tabIds = Object.entries(state.openRequests)
        .filter(([, request]) => requestIdSet.has(request.id))
        .map(([tabId]) => tabId);
    const tabIdSet = new Set(tabIds);

    return {
        openRequests: omitKeys(state.openRequests, tabIdSet),
        responses: omitKeys(state.responses, tabIdSet),
        loadingRequests: omitKeys(state.loadingRequests, tabIdSet),
    };
}

function updateOpenRequestsById(
    openRequests: Record<string, ApiRequest>,
    requestId: string,
    request: Partial<ApiRequest>,
): Record<string, ApiRequest> {
    let changed = false;
    const nextOpenRequests: Record<string, ApiRequest> = {};

    for (const [tabId, openRequest] of Object.entries(openRequests)) {
        if (openRequest.id === requestId) {
            changed = true;
            nextOpenRequests[tabId] = { ...openRequest, ...request };
            continue;
        }

        nextOpenRequests[tabId] = openRequest;
    }

    return changed ? nextOpenRequests : openRequests;
}

function reorderCollectionsById(collections: Collection[], collectionIds: string[]): Collection[] {
    const collectionById = new Map(collections.map((collection) => [collection.id, collection]));
    const ordered: Collection[] = [];
    const seen = new Set<string>();

    for (const id of collectionIds) {
        const collection = collectionById.get(id);
        if (collection) {
            ordered.push(collection);
            seen.add(id);
        }
    }

    for (const collection of collections) {
        if (!seen.has(collection.id)) {
            ordered.push(collection);
        }
    }

    return ordered;
}

function insertRequestItem(
    items: CollectionItem[],
    request: ApiRequest,
    targetFolderId?: string | null,
    beforeRequestId?: string | null,
): CollectionItem[] {
    if (targetFolderId) {
        let changed = false;
        const nextItems = items.map((item) => {
            if (!isFolder(item)) {
                return item;
            }

            if (item.id === targetFolderId) {
                changed = true;
                return {
                    ...item,
                    children: insertRequestItem(item.children, request, null, beforeRequestId),
                };
            }

            const nextChildren = insertRequestItem(
                item.children,
                request,
                targetFolderId,
                beforeRequestId,
            );
            if (nextChildren !== item.children) {
                changed = true;
                return { ...item, children: nextChildren };
            }

            return item;
        });

        return changed ? nextItems : items;
    }

    const nextItems = items.filter((item) => isFolder(item) || item.id !== request.id);
    if (!beforeRequestId) {
        return [...nextItems, request];
    }

    const insertAt = nextItems.findIndex((item) => !isFolder(item) && item.id === beforeRequestId);
    if (insertAt < 0) {
        return [...nextItems, request];
    }

    return [
        ...nextItems.slice(0, insertAt),
        request,
        ...nextItems.slice(insertAt),
    ];
}

function moveRequest(
    collections: Collection[],
    requestId: string,
    fromCollectionId: string,
    toCollectionId: string,
    toFolderId?: string | null,
    beforeRequestId?: string | null,
): Collection[] {
    const sourceCollection = collections.find((collection) => collection.id === fromCollectionId);
    const request = sourceCollection ? findRequestItems(sourceCollection.items, requestId) : null;
    if (!request) {
        return collections;
    }

    return collections.map((collection) => {
        if (collection.id === fromCollectionId && collection.id !== toCollectionId) {
            return { ...collection, items: removeRequestItems(collection.items, requestId) };
        }

        if (collection.id === toCollectionId) {
            const baseItems = collection.id === fromCollectionId
                ? removeRequestItems(collection.items, requestId)
                : collection.items;
            return {
                ...collection,
                items: insertRequestItem(baseItems, request, toFolderId, beforeRequestId),
            };
        }

        return collection;
    });
}

function moveFolder(
    collections: Collection[],
    folderId: string,
    fromCollectionId: string,
    toCollectionId: string,
    toParentFolderId?: string | null,
    beforeItemId?: string | null,
): Collection[] {
    const sourceCollection = collections.find((collection) => collection.id === fromCollectionId);
    const takeResult = sourceCollection ? takeFolderItem(sourceCollection.items, folderId) : null;
    const folder = takeResult?.folder ?? null;
    if (!folder) {
        return collections;
    }

    return collections.map((collection) => {
        const baseItems = collection.id === fromCollectionId && takeResult?.changed
            ? takeResult.items
            : collection.items;

        if (collection.id === toCollectionId) {
            return {
                ...collection,
                items: insertFolderItem(baseItems, folder, toParentFolderId, beforeItemId),
            };
        }

        if (collection.id === fromCollectionId) {
            return { ...collection, items: baseItems };
        }

        return collection;
    });
}

function findRequestItems(items: CollectionItem[], requestId: string): ApiRequest | null {
    for (const item of items) {
        if (isFolder(item)) {
            const nested = findRequestItems(item.children, requestId);
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

function reducer(state: AppState, action: Action): AppState {
    switch (action.type) {
        case "LOAD_COLLECTIONS": {
            return { ...state, collections: normalizeCollections(action.collections) };
        }
        case "LOAD_ENVIRONMENTS": {
            return { ...state, environments: action.environments, activeEnvironmentId: action.activeEnvironmentId };
        }
        case "LOAD_HISTORY": {
            return { ...state, historyEntries: action.entries };
        }
        case "ADD_HISTORY_ENTRY": {
            return { ...state, historyEntries: [action.entry, ...state.historyEntries] };
        }
        case "DELETE_HISTORY_ENTRY": {
            return {
                ...state,
                historyEntries: state.historyEntries.filter((entry) => entry.id !== action.entryId),
            };
        }
        case "CLEAR_HISTORY": {
            return { ...state, historyEntries: [] };
        }
        case "ADD_COLLECTION": {
            return { ...state, collections: [...state.collections, action.collection] };
        }
        case "UPDATE_COLLECTION": {
            return {
                ...state,
                collections: state.collections.map((collection) =>
                    collection.id === action.collectionId
                        ? { ...collection, ...action.collection }
                        : collection,
                ),
            };
        }
        case "ADD_FOLDER_TO_COLLECTION": {
            return {
                ...state,
                collections: state.collections.map((collection) =>
                    collection.id === action.collectionId
                        ? {
                            ...collection,
                            items: insertFolderItem(
                                collection.items,
                                action.folder,
                                action.parentFolderId,
                            ),
                        }
                        : collection,
                ),
            };
        }
        case "ADD_REQUEST_TO_COLLECTION": {
            return {
                ...state,
                collections: state.collections.map((c) =>
                    c.id === action.collectionId
                        ? { ...c, items: insertRequestItem(c.items, action.request, action.folderId, null) }
                        : c,
                ),
            };
        }
        case "UPDATE_FOLDER": {
            return {
                ...state,
                collections: state.collections.map((collection) => {
                    if (collection.id !== action.collectionId) {
                        return collection;
                    }

                    const nextItems = updateFolderItems(
                        collection.items,
                        action.folderId,
                        action.folder,
                    );
                    return nextItems === collection.items
                        ? collection
                        : { ...collection, items: nextItems };
                }),
            };
        }
        case "UPDATE_REQUEST_BY_ID": {
            return {
                ...state,
                collections: state.collections.map((collection) => {
                    const nextItems = updateRequestItems(
                        collection.items,
                        action.requestId,
                        action.request,
                    );

                    return nextItems === collection.items
                        ? collection
                        : { ...collection, items: nextItems };
                }),
                openRequests: updateOpenRequestsById(
                    state.openRequests,
                    action.requestId,
                    action.request,
                ),
            };
        }
        case "REORDER_COLLECTIONS": {
            return {
                ...state,
                collections: reorderCollectionsById(state.collections, action.collectionIds),
            };
        }
        case "MOVE_REQUEST": {
            return {
                ...state,
                collections: moveRequest(
                    state.collections,
                    action.requestId,
                    action.fromCollectionId,
                    action.toCollectionId,
                    action.toFolderId,
                    action.beforeRequestId,
                ),
            };
        }
        case "MOVE_FOLDER": {
            return {
                ...state,
                collections: moveFolder(
                    state.collections,
                    action.folderId,
                    action.fromCollectionId,
                    action.toCollectionId,
                    action.toParentFolderId,
                    action.beforeItemId,
                ),
            };
        }
        case "DELETE_COLLECTION": {
            const collection = state.collections.find((c) => c.id === action.collectionId);
            const requestState = removeRequestStateByIds(
                state,
                collection ? collectRequestIds(collection.items) : [],
            );

            return {
                ...state,
                collections: state.collections.filter((c) => c.id !== action.collectionId),
                ...requestState,
            };
        }
        case "DELETE_FOLDER": {
            const collection = state.collections.find((c) => c.id === action.collectionId);
            const folderResult = collection
                ? removeFolderItems(collection.items, action.folderId)
                : { items: [], requestIds: [], changed: false };
            const requestState = removeRequestStateByIds(state, folderResult.requestIds);

            return {
                ...state,
                collections: state.collections.map((c) =>
                    c.id === action.collectionId && folderResult.changed
                        ? { ...c, items: folderResult.items }
                        : c,
                ),
                ...requestState,
            };
        }
        case "DELETE_REQUEST": {
            const requestState = removeRequestStateByIds(state, [action.requestId]);

            return {
                ...state,
                collections: state.collections.map((c) =>
                    c.id === action.collectionId
                        ? { ...c, items: removeRequestItems(c.items, action.requestId) }
                        : c,
                ),
                ...requestState,
            };
        }
        case "OPEN_REQUEST": {
            return {
                ...state,
                openRequests: { ...state.openRequests, [action.tabId]: action.request },
            };
        }
        case "SET_RESPONSE": {
            return { ...state, responses: { ...state.responses, [action.tabId]: action.response } };
        }
        case "SET_LOADING": {
            return { ...state, loadingRequests: { ...state.loadingRequests, [action.tabId]: action.loading } };
        }
        case "SET_ACTIVE_ENVIRONMENT": {
            return { ...state, activeEnvironmentId: action.envId };
        }
        case "ADD_ENVIRONMENT": {
            return { ...state, environments: [...state.environments, action.environment] };
        }
        case "UPDATE_ENVIRONMENT": {
            return {
                ...state,
                environments: state.environments.map((e) =>
                    e.id === action.envId ? { ...e, ...action.env } : e,
                ),
            };
        }
        case "DELETE_ENVIRONMENT": {
            return {
                ...state,
                environments: state.environments.filter((e) => e.id !== action.envId),
                activeEnvironmentId:
                    state.activeEnvironmentId === action.envId ? null : state.activeEnvironmentId,
            };
        }
        case "REMOVE_TAB": {
            const { [action.tabId]: _req, ...openRequests } = state.openRequests;
            const { [action.tabId]: _res, ...responses } = state.responses;
            const { [action.tabId]: _load, ...loadingRequests } = state.loadingRequests;
            return { ...state, openRequests, responses, loadingRequests };
        }
        default:
            return state;
    }
}

/* ---------- Context ---------- */

const AppStateCtx = createContext<AppState>(initialState);
const AppDispatchCtx = createContext<Dispatch<Action>>(() => {});

/** Whether the backend (Tauri) is available */
function isTauri(): boolean {
    return "__TAURI_INTERNALS__" in window;
}

export function AppStateProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(reducer, initialState);

    // Load persisted data on mount
    useEffect(() => {
        if (!isTauri()) return;

        (async () => {
            try {
                logger.info('appStore', 'loading persisted data');
                const [cols, envs, activeEnvId, historyEntries] = await Promise.all([
                    fetchCollections(),
                    fetchEnvironments(),
                    getConfig("activeEnvironmentId"),
                    fetchAllHistory().catch((err) => {
                        logger.warn('appStore', 'failed to load history', err);
                        return [];
                    }),
                ]);

                // If DB is empty, seed defaults
                if (cols.length === 0) {
                    const defaultCol = await createCollectionApi("My Collection");
                    const defaultReq = await createRequestApi(defaultCol.id, "Example Request");
                    // Set a default URL
                    defaultReq.url = "https://httpbin.org/get";
                    await updateRequestApi(defaultReq, defaultCol.id);
                    defaultCol.items = [defaultReq];
                    dispatch({ type: "LOAD_COLLECTIONS", collections: [defaultCol] });
                } else {
                    dispatch({ type: "LOAD_COLLECTIONS", collections: cols });
                }
                logger.info('appStore', `loaded ${cols.length} collections`);

                if (envs.length === 0) {
                    const defaultEnv = await createEnvironmentApi("Development");
                    const envWithVars = { ...defaultEnv, variables: [
                        { id: crypto.randomUUID(), key: "base_url", value: "https://httpbin.org", enabled: true },
                        { id: crypto.randomUUID(), key: "api_key", value: "", enabled: true },
                    ]};
                    await updateEnvironmentApi(envWithVars);
                    dispatch({ type: "LOAD_ENVIRONMENTS", environments: [envWithVars], activeEnvironmentId: envWithVars.id });
                    await setConfig("activeEnvironmentId", envWithVars.id);
                } else {
                    dispatch({ type: "LOAD_ENVIRONMENTS", environments: envs, activeEnvironmentId: activeEnvId ?? envs[0]?.id ?? null });
                }
                logger.info('appStore', `loaded ${envs.length} environments`);
                dispatch({ type: "LOAD_HISTORY", entries: historyEntries });
                logger.info('appStore', `loaded ${historyEntries.length} history entries`);
            } catch (err) {
                logger.warn('appStore', 'failed to load from backend, using defaults', err);
            }
        })();
    }, []);

    return (
        <AppStateCtx.Provider value={state}>
            <AppDispatchCtx.Provider value={dispatch}>{children}</AppDispatchCtx.Provider>
        </AppStateCtx.Provider>
    );
}

export function useAppState() {
    return useContext(AppStateCtx);
}

export function useAppDispatch() {
    return useContext(AppDispatchCtx);
}

/* ---------- Variable interpolation ---------- */

export function interpolateVariables(input: string, state: AppState): string {
    return createVariableResolver(state)(input);
}

/* ---------- Helpers ---------- */

export { createKeyValuePair };
