import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HistoryPanel } from "../src/components/HistoryPanel";
import type { AppState } from "../src/store/appStore";
import type { HistoryEntry } from "../src/services/persistence";

const storeMocks = vi.hoisted(() => ({
    state: {} as AppState,
}));

vi.mock("../src/store/appStore", () => ({
    useAppState: () => storeMocks.state,
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

describe("HistoryPanel", () => {
    beforeEach(() => {
        storeMocks.state = createState([]);
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
});