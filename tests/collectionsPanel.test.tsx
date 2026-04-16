import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WorkbenchPanelContext } from "layout-v2";
import { CollectionsPanel } from "../src/components/CollectionsPanel";
import type { AppState } from "../src/store/appStore";
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
    renameCollectionApi: vi.fn(),
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

describe("CollectionsPanel context menu", () => {
    beforeEach(() => {
        storeMocks.state = createState([createCollection()]);
        storeMocks.dispatch.mockReset();
        Object.values(persistenceMocks).forEach((mock) => mock.mockReset());
        window.prompt = vi.fn(() => null) as typeof window.prompt;
        window.confirm = vi.fn(() => true) as typeof window.confirm;
    });

    it("renames a collection from the context menu", async () => {
        const context = createContext();
        window.prompt = vi.fn(() => "Renamed Users") as typeof window.prompt;

        render(<CollectionsPanel context={context} />);

        fireEvent.contextMenu(screen.getByText("Users"));
        fireEvent.click(screen.getByRole("button", { name: "Rename" }));

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

    it("renames a request and updates its tab title from the context menu", async () => {
        const context = createContext();
        window.prompt = vi.fn(() => "Fetch Users") as typeof window.prompt;

        render(<CollectionsPanel context={context} />);

        fireEvent.contextMenu(screen.getByText("List Users"));
        fireEvent.click(screen.getByRole("button", { name: "Rename" }));

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
});