import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HistoryPanel } from "../src/components/HistoryPanel";
import type { AppState } from "../src/store/appStore";
import type { HistoryEntry } from "../src/services/persistence";
import type { WorkbenchPanelContext } from "layout-v2";

const storeMocks = vi.hoisted(() => ({
    state: {} as AppState,
    dispatch: vi.fn(),
}));

const persistenceMocks = vi.hoisted(() => ({
    clearHistory: vi.fn(),
    deleteHistoryEntry: vi.fn(),
}));

vi.mock("../src/store/appStore", () => ({
    useAppState: () => storeMocks.state,
    useAppDispatch: () => storeMocks.dispatch,
}));

vi.mock("../src/services/persistence", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/services/persistence")>()),
    clearHistory: persistenceMocks.clearHistory,
    deleteHistoryEntry: persistenceMocks.deleteHistoryEntry,
}));

function createHistoryEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
    return {
        id: "history-1",
        requestId: "request-1",
        method: "GET",
        url: "https://example.com/users",
        requestHeaders: "{}",
        requestBody: null,
        status: 200,
        statusText: "OK",
        responseHeaders: "{}",
        responseBody: "{}",
        timeMs: 128,
        sizeBytes: 2048,
        createdAt: "2026-04-17T01:00:00.000Z",
        ...overrides,
    };
}

function createState(historyEntries: HistoryEntry[]): AppState {
    return {
        collections: [],
        environments: [],
        activeEnvironmentId: null,
        historyEntries,
        openRequests: {},
        responses: {},
        loadingRequests: {},
    };
}

function createContext(): WorkbenchPanelContext {
    return {
        activeTabId: null,
        hostPanelId: "panel-rest-history",
        openTab: vi.fn(),
        updateTab: vi.fn(),
        closeTab: vi.fn(),
        setActiveTab: vi.fn(),
        activatePanel: vi.fn(),
    };
}

describe("HistoryPanel", () => {
    beforeEach(() => {
        storeMocks.state = createState([]);
        storeMocks.dispatch.mockReset();
        Object.values(persistenceMocks).forEach((mock) => {
            mock.mockReset();
            mock.mockResolvedValue(undefined);
        });
    });

    it("shows the empty state when there is no request history", () => {
        render(<HistoryPanel />);

        expect(screen.getByText("No request history yet.")).toBeInTheDocument();
    });

    it("renders history entries with request summary data", () => {
        storeMocks.state = createState([
            createHistoryEntry(),
            createHistoryEntry({
                id: "history-2",
                method: "POST",
                url: "https://example.com/users",
                status: 201,
                statusText: "Created",
                timeMs: 64,
                sizeBytes: 512,
                createdAt: "2026-04-17T02:00:00.000Z",
            }),
        ]);

        render(<HistoryPanel />);

        expect(screen.getByText("POST")).toBeInTheDocument();
        expect(screen.getByText("201 Created")).toBeInTheDocument();
        expect(screen.getByText("64 ms")).toBeInTheDocument();
        expect(screen.getAllByText("https://example.com/users")).toHaveLength(2);
        expect(screen.getByText("512 B")).toBeInTheDocument();
        expect(screen.getByText("GET")).toBeInTheDocument();
        expect(screen.getByText("200 OK")).toBeInTheDocument();
        expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    });

    it("filters history entries by search text and clears the query", () => {
        storeMocks.state = createState([
            createHistoryEntry({ id: "history-1", method: "GET", url: "https://example.com/users" }),
            createHistoryEntry({ id: "history-2", method: "POST", url: "https://example.com/orders" }),
        ]);

        render(<HistoryPanel />);

        fireEvent.change(screen.getByLabelText("Search history"), {
            target: { value: "orders" },
        });
        expect(screen.getByText("https://example.com/orders")).toBeInTheDocument();
        expect(screen.queryByText("https://example.com/users")).not.toBeInTheDocument();

        fireEvent.click(screen.getByTitle("Clear Search"));
        expect(screen.getByText("https://example.com/orders")).toBeInTheDocument();
        expect(screen.getByText("https://example.com/users")).toBeInTheDocument();
    });

    it("opens a replay tab from a history entry", () => {
        const context = createContext();
        storeMocks.state = createState([
            createHistoryEntry({
                id: "history-1",
                method: "POST",
                url: "https://example.com/users",
                requestHeaders: "{\"X-Trace\":\"abc\"}",
                requestBody: "{\"ok\":true}",
            }),
        ]);

        render(<HistoryPanel context={context} />);

        fireEvent.click(screen.getByText("https://example.com/users"));

        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "OPEN_REQUEST",
            tabId: "history-replay-history-1",
            request: expect.objectContaining({
                id: "history-history-1",
                method: "POST",
                url: "https://example.com/users",
                headers: [expect.objectContaining({ key: "X-Trace", value: "abc" })],
                body: expect.objectContaining({ type: "raw", raw: "{\"ok\":true}" }),
            }),
        });
        expect(context.openTab).toHaveBeenCalledWith({
            id: "history-replay-history-1",
            title: "POST Replay",
            component: "request-editor",
            params: { tabId: "history-replay-history-1", historyId: "history-1" },
        });
    });

    it("deletes a single history entry", async () => {
        storeMocks.state = createState([createHistoryEntry({ id: "history-1" })]);

        render(<HistoryPanel />);

        fireEvent.click(screen.getByTitle("Delete History Entry"));

        await waitFor(() => {
            expect(persistenceMocks.deleteHistoryEntry).toHaveBeenCalledWith("history-1");
        });
        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "DELETE_HISTORY_ENTRY",
            entryId: "history-1",
        });
    });

    it("clears all history entries", async () => {
        storeMocks.state = createState([createHistoryEntry({ id: "history-1" })]);

        render(<HistoryPanel />);

        fireEvent.click(screen.getByTitle("Clear History"));

        await waitFor(() => {
            expect(persistenceMocks.clearHistory).toHaveBeenCalled();
        });
        expect(storeMocks.dispatch).toHaveBeenCalledWith({ type: "CLEAR_HISTORY" });
    });
});
