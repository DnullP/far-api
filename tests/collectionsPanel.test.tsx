import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WorkbenchPanelContext } from "layout-v2";
import { CollectionsPanel } from "../src/components/CollectionsPanel";
import type { AppState } from "../src/store/appStore";
import { createRequestAuth } from "../src/types/api";
import type { ApiRequest, Collection } from "../src/types/api";

const storeMocks = vi.hoisted(() => ({
    state: {} as AppState,
    dispatch: vi.fn(),
}));

const persistenceMocks = vi.hoisted(() => ({
    createCollectionApi: vi.fn(),
    createRequestApi: vi.fn(),
    deleteCollectionApi: vi.fn(),
    deleteRequestApi: vi.fn(),
    moveRequestApi: vi.fn(),
    renameCollectionApi: vi.fn(),
    reorderCollectionsApi: vi.fn(),
    updateRequestApi: vi.fn(),
}));

vi.mock("../src/store/appStore", () => ({
    useAppState: () => storeMocks.state,
    useAppDispatch: () => storeMocks.dispatch,
}));

vi.mock("../src/services/persistence", () => persistenceMocks);

function createRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
    return {
        id: "request-1",
        name: "List Users",
        method: "GET",
        url: "https://example.com/users",
        params: [],
        headers: [],
        body: { type: "none", json: "{}", form: [], raw: "" },
        auth: createRequestAuth(),
        ...overrides,
    };
}

function createCollection(overrides: Partial<Collection> = {}): Collection {
    return {
        id: "collection-1",
        name: "Users",
        items: [createRequest()],
        ...overrides,
    };
}

function createState(collections: Collection[]): AppState {
    return {
        collections,
        environments: [],
        activeEnvironmentId: null,
        historyEntries: [],
        openRequests: {},
        responses: {},
        loadingRequests: {},
    };
}

function createContext(): WorkbenchPanelContext {
    return {
        activeTabId: null,
        hostPanelId: "panel-rest-collections",
        openTab: vi.fn(),
        updateTab: vi.fn(),
        closeTab: vi.fn(),
        setActiveTab: vi.fn(),
        activatePanel: vi.fn(),
    };
}

function createDataTransfer(): DataTransfer {
    const data = new Map<string, string>();

    return {
        dropEffect: "move",
        effectAllowed: "move",
        files: [] as unknown as FileList,
        items: [] as unknown as DataTransferItemList,
        types: [],
        clearData: vi.fn((format?: string) => {
            if (format) {
                data.delete(format);
                return;
            }
            data.clear();
        }),
        getData: vi.fn((format: string) => data.get(format) ?? ""),
        setData: vi.fn((format: string, value: string) => {
            data.set(format, value);
        }),
        setDragImage: vi.fn(),
    } as unknown as DataTransfer;
}

describe("CollectionsPanel context menu", () => {
    beforeEach(() => {
        storeMocks.state = createState([createCollection()]);
        storeMocks.dispatch.mockReset();
        Object.values(persistenceMocks).forEach((mock) => mock.mockReset());
    });

    it("renames a collection from the context menu", async () => {
        const context = createContext();

        render(<CollectionsPanel context={context} />);

        fireEvent.contextMenu(screen.getByText("Users"));
        fireEvent.click(screen.getByRole("button", { name: "Rename" }));
        const input = screen.getByLabelText("Rename collection");
        fireEvent.change(input, { target: { value: "Renamed Users" } });
        fireEvent.keyDown(input, { key: "Enter" });

        await waitFor(() => {
            expect(persistenceMocks.renameCollectionApi).toHaveBeenCalledWith(
                "collection-1",
                "Renamed Users",
            );
        });

        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "UPDATE_COLLECTION",
            collectionId: "collection-1",
            collection: { name: "Renamed Users" },
        });
    });

    it("creates a request from the toolbar modal in the selected collection", async () => {
        storeMocks.state = createState([
            createCollection({ id: "collection-1", name: "Users", items: [] }),
            createCollection({ id: "collection-2", name: "Teams", items: [] }),
        ]);
        persistenceMocks.createRequestApi.mockResolvedValue(
            createRequest({ id: "request-2", name: "Fetch Teams" }),
        );
        const context = createContext();

        render(<CollectionsPanel context={context} />);

        fireEvent.click(screen.getByTitle("New Request"));
        fireEvent.change(screen.getByLabelText("Request name"), {
            target: { value: "Fetch Teams" },
        });
        fireEvent.change(screen.getByLabelText("Request collection"), {
            target: { value: "collection-2" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Create Request" }));

        await waitFor(() => {
            expect(persistenceMocks.createRequestApi).toHaveBeenCalledWith(
                "collection-2",
                "Fetch Teams",
            );
        });
        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "ADD_REQUEST_TO_COLLECTION",
            collectionId: "collection-2",
            request: expect.objectContaining({ id: "request-2", name: "Fetch Teams" }),
        });
    });

    it("imports an OpenAPI collection from the import modal", async () => {
        persistenceMocks.createCollectionApi.mockResolvedValue(
            createCollection({ id: "collection-imported", name: "Imported API", items: [] }),
        );
        persistenceMocks.createRequestApi.mockResolvedValueOnce(
            createRequest({ id: "request-imported", name: "Created Request", url: "" }),
        );
        const context = createContext();

        render(<CollectionsPanel context={context} />);

        fireEvent.click(screen.getByTitle("Import Collection"));
        fireEvent.change(screen.getByLabelText("Import JSON content"), {
            target: {
                value: JSON.stringify({
                    openapi: "3.0.3",
                    info: { title: "Imported API" },
                    servers: [{ url: "https://mock.local" }],
                    paths: {
                        "/users": {
                            post: {
                                summary: "Create User",
                                requestBody: {
                                    content: {
                                        "application/json": {
                                            example: { name: "Kai" },
                                        },
                                    },
                                },
                            },
                        },
                    },
                }),
            },
        });
        expect(screen.getByText("1 requests")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Import" }));

        await waitFor(() => {
            expect(persistenceMocks.createCollectionApi).toHaveBeenCalledWith("Imported API");
        });
        expect(persistenceMocks.createRequestApi).toHaveBeenCalledWith(
            "collection-imported",
            "Create User",
        );
        expect(persistenceMocks.updateRequestApi).toHaveBeenCalledWith(
            expect.objectContaining({
                id: "request-imported",
                name: "Created Request",
                method: "POST",
                url: "https://mock.local/users",
                body: expect.objectContaining({
                    type: "json",
                    json: "{\n  \"name\": \"Kai\"\n}",
                }),
            }),
            "collection-imported",
        );
        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "ADD_COLLECTION",
            collection: expect.objectContaining({
                id: "collection-imported",
                items: [
                    expect.objectContaining({
                        id: "request-imported",
                        method: "POST",
                        url: "https://mock.local/users",
                    }),
                ],
            }),
        });
    });

    it("renames a request and updates its tab title from the context menu", async () => {
        const context = createContext();

        render(<CollectionsPanel context={context} />);

        fireEvent.contextMenu(screen.getByText("List Users"));
        fireEvent.click(screen.getByRole("button", { name: "Rename" }));
        const input = screen.getByLabelText("Rename request");
        fireEvent.change(input, { target: { value: "Fetch Users" } });
        fireEvent.keyDown(input, { key: "Enter" });

        await waitFor(() => {
            expect(persistenceMocks.updateRequestApi).toHaveBeenCalledWith(
                expect.objectContaining({ id: "request-1", name: "Fetch Users", method: "GET" }),
                "collection-1",
            );
        });

        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "UPDATE_REQUEST_BY_ID",
            requestId: "request-1",
            request: { name: "Fetch Users" },
        });
        expect(context.updateTab).toHaveBeenCalledWith("req-request-1", {
            title: "GET Fetch Users",
        });
    });

    it("deletes a request from the context menu", async () => {
        const context = createContext();

        render(<CollectionsPanel context={context} />);

        fireEvent.contextMenu(screen.getByText("List Users"));
        fireEvent.click(screen.getByRole("button", { name: "Delete" }));

        await waitFor(() => {
            expect(persistenceMocks.deleteRequestApi).toHaveBeenCalledWith("request-1");
        });

        expect(context.closeTab).toHaveBeenCalledWith("req-request-1");
        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "DELETE_REQUEST",
            collectionId: "collection-1",
            requestId: "request-1",
        });
    });

    it("deletes a collection and closes all request tabs from the context menu", async () => {
        const context = createContext();

        render(<CollectionsPanel context={context} />);

        fireEvent.contextMenu(screen.getByText("Users"));
        fireEvent.click(screen.getByRole("button", { name: "Delete" }));

        await waitFor(() => {
            expect(persistenceMocks.deleteCollectionApi).toHaveBeenCalledWith("collection-1");
        });

        expect(context.closeTab).toHaveBeenCalledWith("req-request-1");
        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "DELETE_COLLECTION",
            collectionId: "collection-1",
        });
    });

    it("reorders collections by dropping one collection on another", async () => {
        storeMocks.state = createState([
            createCollection({ id: "collection-1", name: "Users", items: [] }),
            createCollection({ id: "collection-2", name: "Teams", items: [] }),
        ]);
        const context = createContext();
        const dataTransfer = createDataTransfer();

        render(<CollectionsPanel context={context} />);

        const source = screen.getByText("Teams").closest(".collection-header");
        const target = screen.getByText("Users").closest(".collection-header");
        expect(source).not.toBeNull();
        expect(target).not.toBeNull();

        fireEvent.dragStart(source as Element, { dataTransfer });
        fireEvent.dragOver(target as Element, { dataTransfer });
        fireEvent.drop(target as Element, { dataTransfer });

        await waitFor(() => {
            expect(persistenceMocks.reorderCollectionsApi).toHaveBeenCalledWith([
                "collection-2",
                "collection-1",
            ]);
        });
        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "REORDER_COLLECTIONS",
            collectionIds: ["collection-2", "collection-1"],
        });
    });

    it("moves a request to the end of another collection by dropping on the collection", async () => {
        storeMocks.state = createState([
            createCollection({
                id: "collection-1",
                name: "Users",
                items: [createRequest({ id: "request-1", name: "List Users" })],
            }),
            createCollection({
                id: "collection-2",
                name: "Teams",
                items: [createRequest({ id: "request-2", name: "List Teams" })],
            }),
        ]);
        const context = createContext();
        const dataTransfer = createDataTransfer();

        render(<CollectionsPanel context={context} />);

        const source = screen.getByText("List Users").closest("button");
        const target = screen.getByText("Teams").closest(".collection-header");
        expect(source).not.toBeNull();
        expect(target).not.toBeNull();

        fireEvent.dragStart(source as Element, { dataTransfer });
        fireEvent.dragOver(target as Element, { dataTransfer });
        fireEvent.drop(target as Element, { dataTransfer });

        await waitFor(() => {
            expect(persistenceMocks.moveRequestApi).toHaveBeenCalledWith({
                requestId: "request-1",
                targetCollectionId: "collection-2",
                beforeRequestId: null,
            });
        });
        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "MOVE_REQUEST",
            requestId: "request-1",
            fromCollectionId: "collection-1",
            toCollectionId: "collection-2",
            beforeRequestId: null,
        });
    });

    it("moves a request before another request by dropping on the target request", async () => {
        storeMocks.state = createState([
            createCollection({
                id: "collection-1",
                name: "Users",
                items: [createRequest({ id: "request-1", name: "List Users" })],
            }),
            createCollection({
                id: "collection-2",
                name: "Teams",
                items: [createRequest({ id: "request-2", name: "List Teams" })],
            }),
        ]);
        const context = createContext();
        const dataTransfer = createDataTransfer();

        render(<CollectionsPanel context={context} />);

        const source = screen.getByText("List Users").closest("button");
        const target = screen.getByText("List Teams").closest("button");
        expect(source).not.toBeNull();
        expect(target).not.toBeNull();

        fireEvent.dragStart(source as Element, { dataTransfer });
        fireEvent.dragOver(target as Element, { dataTransfer });
        fireEvent.drop(target as Element, { dataTransfer });

        await waitFor(() => {
            expect(persistenceMocks.moveRequestApi).toHaveBeenCalledWith({
                requestId: "request-1",
                targetCollectionId: "collection-2",
                beforeRequestId: "request-2",
            });
        });
        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "MOVE_REQUEST",
            requestId: "request-1",
            fromCollectionId: "collection-1",
            toCollectionId: "collection-2",
            beforeRequestId: "request-2",
        });
    });
});
