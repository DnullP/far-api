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
    createKeyValuePair,
    isFolder,
} from "../types/api";
import {
    fetchCollections,
    fetchEnvironments,
    getConfig,
    setConfig,
    createCollectionApi,
    createRequestApi,
    updateRequestApi,
    createEnvironmentApi,
    updateEnvironmentApi,
} from "../services/persistence";
import { logger } from "../services/logger";
/* ---------- State shape ---------- */

export interface AppState {
    collections: Collection[];
    environments: Environment[];
    activeEnvironmentId: string | null;
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
    openRequests: {},
    responses: {},
    loadingRequests: {},
};

/* ---------- Actions ---------- */

type Action =
    | { type: "LOAD_COLLECTIONS"; collections: Collection[] }
    | { type: "LOAD_ENVIRONMENTS"; environments: Environment[]; activeEnvironmentId: string | null }
    | { type: "ADD_COLLECTION"; collection: Collection }
    | { type: "ADD_REQUEST_TO_COLLECTION"; collectionId: string; request: ApiRequest }
    | { type: "OPEN_REQUEST"; tabId: string; request: ApiRequest }
    | { type: "UPDATE_COLLECTION"; collectionId: string; collection: Partial<Collection> }
    | { type: "UPDATE_REQUEST_BY_ID"; requestId: string; request: Partial<ApiRequest> }
    | { type: "SET_RESPONSE"; tabId: string; response: ApiResponse | null }
    | { type: "SET_LOADING"; tabId: string; loading: boolean }
    | { type: "SET_ACTIVE_ENVIRONMENT"; envId: string | null }
    | { type: "ADD_ENVIRONMENT"; environment: Environment }
    | { type: "UPDATE_ENVIRONMENT"; envId: string; env: Partial<Environment> }
    | { type: "DELETE_ENVIRONMENT"; envId: string }
    | { type: "REMOVE_TAB"; tabId: string }
    | { type: "DELETE_COLLECTION"; collectionId: string }
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

function reducer(state: AppState, action: Action): AppState {
    switch (action.type) {
        case "LOAD_COLLECTIONS": {
            return { ...state, collections: action.collections };
        }
        case "LOAD_ENVIRONMENTS": {
            return { ...state, environments: action.environments, activeEnvironmentId: action.activeEnvironmentId };
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
        case "ADD_REQUEST_TO_COLLECTION": {
            return {
                ...state,
                collections: state.collections.map((c) =>
                    c.id === action.collectionId ? { ...c, items: [...c.items, action.request] } : c,
                ),
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
                const [cols, envs, activeEnvId] = await Promise.all([
                    fetchCollections(),
                    fetchEnvironments(),
                    getConfig("activeEnvironmentId"),
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
    const env = state.environments.find((e) => e.id === state.activeEnvironmentId);
    if (!env) return input;
    let result = input;
    for (const v of env.variables) {
        if (v.enabled && v.key) {
            result = result.replaceAll(`{{${v.key}}}`, v.value);
        }
    }
    return result;
}

/* ---------- Helpers ---------- */

export { createKeyValuePair };
