import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WorkbenchPanelContext } from "layout-v2";
import { CollectionsPanel } from "../src/components/CollectionsPanel";
import type { AppState } from "../src/store/appStore";
import { createRequestAuth, createRequestScripts } from "../src/types/api";
import type { ApiRequest, Collection, RequestFolder } from "../src/types/api";

const storeMocks = vi.hoisted(() => ({
    state: {} as AppState,
    dispatch: vi.fn(),
}));

const persistenceMocks = vi.hoisted(() => ({
    createCollectionApi: vi.fn(),
    createFolderApi: vi.fn(),
    createRequestApi: vi.fn(),
    deleteCollectionApi: vi.fn(),
    deleteFolderApi: vi.fn(),
    deleteRequestApi: vi.fn(),
    addRunnerReport: vi.fn(),
    deleteRunnerReport: vi.fn(),
    listRunnerReports: vi.fn(),
    moveFolderApi: vi.fn(),
    moveRequestApi: vi.fn(),
    renameCollectionApi: vi.fn(),
    renameFolderApi: vi.fn(),
    reorderCollectionsApi: vi.fn(),
    updateRequestApi: vi.fn(),
}));

const runnerMocks = vi.hoisted(() => ({
    runCollectionTarget: vi.fn(),
}));

vi.mock("../src/store/appStore", () => ({
    useAppState: () => storeMocks.state,
    useAppDispatch: () => storeMocks.dispatch,
}));

vi.mock("../src/services/persistence", () => persistenceMocks);
vi.mock("../src/services/collectionRunner", () => runnerMocks);

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
        scripts: createRequestScripts(),
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

function createFolder(overrides: Partial<RequestFolder> = {}): RequestFolder {
    return {
        id: "folder-1",
        name: "Users Folder",
        children: [createRequest({ id: "request-folder", name: "Folder Request" })],
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
        runnerMocks.runCollectionTarget.mockReset();
        persistenceMocks.listRunnerReports.mockResolvedValue([]);
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
        fireEvent.change(screen.getByLabelText("Request location"), {
            target: { value: "collection-2:root" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Create Request" }));

        await waitFor(() => {
            expect(persistenceMocks.createRequestApi).toHaveBeenCalledWith(
                "collection-2",
                "Fetch Teams",
                null,
            );
        });
        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "ADD_REQUEST_TO_COLLECTION",
            collectionId: "collection-2",
            folderId: null,
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
            null,
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
            null,
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

    it("imports Hoppscotch folders into the collection tree", async () => {
        persistenceMocks.createCollectionApi.mockResolvedValue(
            createCollection({ id: "collection-hoppscotch", name: "Hoppscotch API", items: [] }),
        );
        persistenceMocks.createFolderApi.mockResolvedValueOnce(
            createFolder({ id: "folder-hoppscotch", name: "Nested", children: [] }),
        );
        persistenceMocks.createRequestApi.mockResolvedValueOnce(
            createRequest({ id: "request-hoppscotch", name: "Create User", url: "" }),
        );
        const context = createContext();

        render(<CollectionsPanel context={context} />);

        fireEvent.click(screen.getByTitle("Import Collection"));
        fireEvent.change(screen.getByLabelText("Import JSON content"), {
            target: {
                value: JSON.stringify({
                    name: "Hoppscotch API",
                    folders: [
                        {
                            name: "Nested",
                            requests: [
                                {
                                    name: "Create User",
                                    method: "POST",
                                    endpoint: "https://mock.local/users",
                                    body: "{\"name\":\"Kai\"}",
                                },
                            ],
                        },
                    ],
                }),
            },
        });
        expect(screen.getByText("1 requests")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Import" }));

        await waitFor(() => {
            expect(persistenceMocks.createFolderApi).toHaveBeenCalledWith({
                collectionId: "collection-hoppscotch",
                parentFolderId: null,
                name: "Nested",
            });
        });
        expect(persistenceMocks.createRequestApi).toHaveBeenCalledWith(
            "collection-hoppscotch",
            "Create User",
            "folder-hoppscotch",
        );
        expect(persistenceMocks.updateRequestApi).toHaveBeenCalledWith(
            expect.objectContaining({
                id: "request-hoppscotch",
                method: "POST",
                url: "https://mock.local/users",
                body: expect.objectContaining({
                    type: "json",
                    json: "{\"name\":\"Kai\"}",
                }),
            }),
            "collection-hoppscotch",
            "folder-hoppscotch",
        );
        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "ADD_COLLECTION",
            collection: expect.objectContaining({
                id: "collection-hoppscotch",
                items: [
                    expect.objectContaining({
                        id: "folder-hoppscotch",
                        name: "Nested",
                        children: [
                            expect.objectContaining({
                                id: "request-hoppscotch",
                                method: "POST",
                                url: "https://mock.local/users",
                            }),
                        ],
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
                null,
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
                targetFolderId: null,
                beforeRequestId: null,
            });
        });
        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "MOVE_REQUEST",
            requestId: "request-1",
            fromCollectionId: "collection-1",
            toCollectionId: "collection-2",
            toFolderId: null,
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
                targetFolderId: null,
                beforeRequestId: "request-2",
            });
        });
        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "MOVE_REQUEST",
            requestId: "request-1",
            fromCollectionId: "collection-1",
            toCollectionId: "collection-2",
            toFolderId: null,
            beforeRequestId: "request-2",
        });
    });

    it("creates a folder from the toolbar modal in the selected collection", async () => {
        storeMocks.state = createState([
            createCollection({ id: "collection-1", name: "Users", items: [] }),
            createCollection({ id: "collection-2", name: "Teams", items: [] }),
        ]);
        persistenceMocks.createFolderApi.mockResolvedValue(
            createFolder({ id: "folder-2", name: "Team Folder", children: [] }),
        );
        const context = createContext();

        render(<CollectionsPanel context={context} />);

        fireEvent.click(screen.getByTitle("New Folder"));
        fireEvent.change(screen.getByLabelText("Folder name"), {
            target: { value: "Team Folder" },
        });
        fireEvent.change(screen.getByLabelText("Folder location"), {
            target: { value: "collection-2:root" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Create Folder" }));

        await waitFor(() => {
            expect(persistenceMocks.createFolderApi).toHaveBeenCalledWith({
                collectionId: "collection-2",
                parentFolderId: null,
                name: "Team Folder",
            });
        });
        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "ADD_FOLDER_TO_COLLECTION",
            collectionId: "collection-2",
            parentFolderId: null,
            folder: expect.objectContaining({ id: "folder-2", name: "Team Folder" }),
        });
    });

    it("creates a folder in a selected parent folder from the folder modal", async () => {
        storeMocks.state = createState([
            createCollection({
                id: "collection-1",
                name: "Users",
                items: [createFolder({ id: "folder-1", name: "Admin", children: [] })],
            }),
        ]);
        persistenceMocks.createFolderApi.mockResolvedValue(
            createFolder({ id: "folder-child", name: "Nested", children: [] }),
        );
        const context = createContext();

        render(<CollectionsPanel context={context} />);

        fireEvent.click(screen.getByTitle("New Folder"));
        fireEvent.change(screen.getByLabelText("Folder name"), {
            target: { value: "Nested" },
        });
        fireEvent.change(screen.getByLabelText("Folder location"), {
            target: { value: "collection-1:folder-1" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Create Folder" }));

        await waitFor(() => {
            expect(persistenceMocks.createFolderApi).toHaveBeenCalledWith({
                collectionId: "collection-1",
                parentFolderId: "folder-1",
                name: "Nested",
            });
        });
        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "ADD_FOLDER_TO_COLLECTION",
            collectionId: "collection-1",
            parentFolderId: "folder-1",
            folder: expect.objectContaining({ id: "folder-child", name: "Nested" }),
        });
    });

    it("creates a request in a selected folder from the request modal", async () => {
        storeMocks.state = createState([
            createCollection({
                id: "collection-1",
                name: "Users",
                items: [createFolder({ id: "folder-1", name: "Admin", children: [] })],
            }),
        ]);
        persistenceMocks.createRequestApi.mockResolvedValue(
            createRequest({ id: "request-admin", name: "Admin List" }),
        );
        const context = createContext();

        render(<CollectionsPanel context={context} />);

        fireEvent.click(screen.getByTitle("New Request"));
        fireEvent.change(screen.getByLabelText("Request name"), {
            target: { value: "Admin List" },
        });
        fireEvent.change(screen.getByLabelText("Request location"), {
            target: { value: "collection-1:folder-1" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Create Request" }));

        await waitFor(() => {
            expect(persistenceMocks.createRequestApi).toHaveBeenCalledWith(
                "collection-1",
                "Admin List",
                "folder-1",
            );
        });
        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "ADD_REQUEST_TO_COLLECTION",
            collectionId: "collection-1",
            folderId: "folder-1",
            request: expect.objectContaining({ id: "request-admin", name: "Admin List" }),
        });
    });

    it("runs the first collection from the toolbar runner modal", async () => {
        const report = {
            targetName: "Users",
            targetKind: "collection",
            targetId: "collection-1",
            collectionId: "collection-1",
            folderId: null,
            iterations: 2,
            totalRequests: 2,
            passedTests: 2,
            failedTests: 0,
            durationMs: 24,
            results: [
                {
                    requestId: "request-1",
                    requestName: "List Users",
                    method: "GET",
                    url: "https://example.com/users",
                    iteration: 1,
                    status: 200,
                    statusText: "OK",
                    time: 12,
                    tests: [{ name: "status ok", passed: true }],
                    console: [],
                },
            ],
        };
        runnerMocks.runCollectionTarget.mockResolvedValue(report);
        persistenceMocks.addRunnerReport.mockResolvedValue({
            ...report,
            id: "runner-report-1",
            createdAt: "2026-05-28T08:00:00.000Z",
        });
        const context = createContext();

        render(<CollectionsPanel context={context} />);

        fireEvent.click(screen.getByTitle("Run First Collection"));
        fireEvent.change(screen.getByLabelText("Runner iterations"), {
            target: { value: "2" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Run" }));

        await waitFor(() => {
            expect(runnerMocks.runCollectionTarget).toHaveBeenCalledWith(
                storeMocks.state,
                { kind: "collection", collectionId: "collection-1" },
                2,
            );
        });
        await waitFor(() => {
            expect(persistenceMocks.addRunnerReport).toHaveBeenCalledWith(report);
        });
        expect(await screen.findByText("2 requests")).toBeInTheDocument();
        expect(screen.getByText("2 passed")).toBeInTheDocument();
        expect(screen.getByText("PASS status ok")).toBeInTheDocument();
        expect(screen.getByText("Recent Reports")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Open runner report Users" })).toBeInTheDocument();
    });

    it("loads, opens, and deletes a saved runner report", async () => {
        const savedReport = {
            id: "runner-report-1",
            targetName: "Users",
            targetKind: "collection",
            targetId: "collection-1",
            collectionId: "collection-1",
            folderId: null,
            iterations: 1,
            totalRequests: 1,
            passedTests: 1,
            failedTests: 0,
            durationMs: 12,
            createdAt: "2026-05-28T08:00:00.000Z",
            results: [
                {
                    requestId: "request-1",
                    requestName: "List Users",
                    method: "GET",
                    url: "https://example.com/users",
                    iteration: 1,
                    status: 200,
                    statusText: "OK",
                    time: 12,
                    tests: [{ name: "saved status ok", passed: true }],
                    console: [],
                },
            ],
        };
        persistenceMocks.listRunnerReports.mockResolvedValue([savedReport]);
        const context = createContext();

        render(<CollectionsPanel context={context} />);

        fireEvent.click(screen.getByTitle("Run First Collection"));

        await waitFor(() => {
            expect(persistenceMocks.listRunnerReports).toHaveBeenCalledWith(12, 0);
        });
        const openButton = await screen.findByRole("button", { name: "Open runner report Users" });
        fireEvent.click(openButton);

        expect(screen.getByText("PASS saved status ok")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Delete runner report Users" }));
        await waitFor(() => {
            expect(persistenceMocks.deleteRunnerReport).toHaveBeenCalledWith("runner-report-1");
        });
        expect(screen.queryByRole("button", { name: "Open runner report Users" })).not.toBeInTheDocument();
    });

    it("renames and deletes a folder from the context menu", async () => {
        storeMocks.state = createState([
            createCollection({
                id: "collection-1",
                name: "Users",
                items: [createFolder({ id: "folder-1", name: "Admin" })],
            }),
        ]);
        const context = createContext();

        render(<CollectionsPanel context={context} />);

        fireEvent.contextMenu(screen.getByText("Admin"));
        fireEvent.click(screen.getByRole("button", { name: "Rename" }));
        const input = screen.getByLabelText("Rename folder");
        fireEvent.change(input, { target: { value: "Operations" } });
        fireEvent.keyDown(input, { key: "Enter" });

        await waitFor(() => {
            expect(persistenceMocks.renameFolderApi).toHaveBeenCalledWith("folder-1", "Operations");
        });
        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "UPDATE_FOLDER",
            collectionId: "collection-1",
            folderId: "folder-1",
            folder: { name: "Operations" },
        });

        storeMocks.dispatch.mockClear();
        persistenceMocks.renameFolderApi.mockClear();
        fireEvent.contextMenu(screen.getByText("Admin"));
        fireEvent.click(screen.getByRole("button", { name: "Delete" }));

        await waitFor(() => {
            expect(persistenceMocks.deleteFolderApi).toHaveBeenCalledWith("folder-1");
        });
        expect(context.closeTab).toHaveBeenCalledWith("req-request-folder");
        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "DELETE_FOLDER",
            collectionId: "collection-1",
            folderId: "folder-1",
        });
    });

    it("moves a request into a folder by dropping on the folder row", async () => {
        storeMocks.state = createState([
            createCollection({
                id: "collection-1",
                name: "Users",
                items: [
                    createRequest({ id: "request-1", name: "List Users" }),
                    createFolder({ id: "folder-1", name: "Admin", children: [] }),
                ],
            }),
        ]);
        const context = createContext();
        const dataTransfer = createDataTransfer();

        render(<CollectionsPanel context={context} />);

        const source = screen.getByText("List Users").closest("button");
        const target = screen.getByText("Admin").closest(".folder-item");
        expect(source).not.toBeNull();
        expect(target).not.toBeNull();

        fireEvent.dragStart(source as Element, { dataTransfer });
        fireEvent.dragOver(target as Element, { dataTransfer });
        fireEvent.drop(target as Element, { dataTransfer });

        await waitFor(() => {
            expect(persistenceMocks.moveRequestApi).toHaveBeenCalledWith({
                requestId: "request-1",
                targetCollectionId: "collection-1",
                targetFolderId: "folder-1",
                beforeRequestId: null,
            });
        });
        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "MOVE_REQUEST",
            requestId: "request-1",
            fromCollectionId: "collection-1",
            toCollectionId: "collection-1",
            toFolderId: "folder-1",
            beforeRequestId: null,
        });
    });

    it("moves a folder to another collection by dropping on the collection row", async () => {
        storeMocks.state = createState([
            createCollection({
                id: "collection-1",
                name: "Users",
                items: [createFolder({ id: "folder-1", name: "Admin", children: [] })],
            }),
            createCollection({ id: "collection-2", name: "Teams", items: [] }),
        ]);
        const context = createContext();
        const dataTransfer = createDataTransfer();

        render(<CollectionsPanel context={context} />);

        const source = screen.getByText("Admin").closest(".folder-item");
        const target = screen.getByText("Teams").closest(".collection-header");
        expect(source).not.toBeNull();
        expect(target).not.toBeNull();

        fireEvent.dragStart(source as Element, { dataTransfer });
        fireEvent.dragOver(target as Element, { dataTransfer });
        fireEvent.drop(target as Element, { dataTransfer });

        await waitFor(() => {
            expect(persistenceMocks.moveFolderApi).toHaveBeenCalledWith({
                folderId: "folder-1",
                targetCollectionId: "collection-2",
                targetParentFolderId: null,
                beforeItemId: null,
            });
        });
        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "MOVE_FOLDER",
            folderId: "folder-1",
            fromCollectionId: "collection-1",
            toCollectionId: "collection-2",
            toParentFolderId: null,
            beforeItemId: null,
        });
    });

    it("moves a folder into another folder by dropping on the folder row", async () => {
        storeMocks.state = createState([
            createCollection({
                id: "collection-1",
                name: "Users",
                items: [
                    createFolder({ id: "folder-1", name: "Admin", children: [] }),
                    createFolder({ id: "folder-2", name: "Archive", children: [] }),
                ],
            }),
        ]);
        const context = createContext();
        const dataTransfer = createDataTransfer();

        render(<CollectionsPanel context={context} />);

        const source = screen.getByText("Archive").closest(".folder-item");
        const target = screen.getByText("Admin").closest(".folder-item");
        expect(source).not.toBeNull();
        expect(target).not.toBeNull();

        fireEvent.dragStart(source as Element, { dataTransfer });
        fireEvent.dragOver(target as Element, { dataTransfer });
        fireEvent.drop(target as Element, { dataTransfer });

        await waitFor(() => {
            expect(persistenceMocks.moveFolderApi).toHaveBeenCalledWith({
                folderId: "folder-2",
                targetCollectionId: "collection-1",
                targetParentFolderId: "folder-1",
                beforeItemId: null,
            });
        });
        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "MOVE_FOLDER",
            folderId: "folder-2",
            fromCollectionId: "collection-1",
            toCollectionId: "collection-1",
            toParentFolderId: "folder-1",
            beforeItemId: null,
        });
    });

    it("moves a folder before a request by dropping on the request row", async () => {
        storeMocks.state = createState([
            createCollection({
                id: "collection-1",
                name: "Users",
                items: [
                    createFolder({ id: "folder-1", name: "Admin", children: [] }),
                    createRequest({ id: "request-1", name: "List Users" }),
                ],
            }),
        ]);
        const context = createContext();
        const dataTransfer = createDataTransfer();

        render(<CollectionsPanel context={context} />);

        const source = screen.getByText("Admin").closest(".folder-item");
        const target = screen.getByText("List Users").closest("button");
        expect(source).not.toBeNull();
        expect(target).not.toBeNull();

        fireEvent.dragStart(source as Element, { dataTransfer });
        fireEvent.dragOver(target as Element, { dataTransfer });
        fireEvent.drop(target as Element, { dataTransfer });

        await waitFor(() => {
            expect(persistenceMocks.moveFolderApi).toHaveBeenCalledWith({
                folderId: "folder-1",
                targetCollectionId: "collection-1",
                targetParentFolderId: null,
                beforeItemId: "request-1",
            });
        });
        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "MOVE_FOLDER",
            folderId: "folder-1",
            fromCollectionId: "collection-1",
            toCollectionId: "collection-1",
            toParentFolderId: null,
            beforeItemId: "request-1",
        });
    });
});
