import { describe, expect, it, vi } from "vitest";
import type { AppState } from "../src/store/appStore";
import {
    createKeyValuePair,
    createRequestAuth,
    createRequestScripts,
    type ApiRequest,
    type Collection,
} from "../src/types/api";
import { runCollectionTarget } from "../src/services/collectionRunner";

vi.mock("../src/services/httpClient", () => ({
    sendRequest: vi.fn(async (input) => ({
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: input.url, headers: input.headers }),
        time: 12,
        size: 2,
    })),
}));

function createRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
    return {
        id: "request-1",
        name: "Runner Request",
        method: "GET",
        url: "https://mock.local/{{path}}",
        params: [createKeyValuePair()],
        headers: [createKeyValuePair()],
        body: { type: "none", json: "{}", form: [createKeyValuePair()], raw: "" },
        auth: createRequestAuth(),
        scripts: createRequestScripts({
            preRequest: "pm.variables.set('path', 'runner'); pm.request.headers.upsert({ key: 'X-Runner', value: 'yes' });",
            postResponse: "pm.test('status ok', () => pm.expect(pm.response.code).to.equal(200));",
        }),
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

describe("collectionRunner", () => {
    it("runs a collection for multiple iterations and aggregates tests", async () => {
        const state = createState([
            {
                id: "collection-1",
                name: "Runner Collection",
                items: [createRequest()],
            },
        ]);

        const report = await runCollectionTarget(
            state,
            { kind: "collection", collectionId: "collection-1" },
            2,
        );

        expect(report).toEqual(expect.objectContaining({
            targetName: "Runner Collection",
            iterations: 2,
            totalRequests: 2,
            passedTests: 2,
            failedTests: 0,
        }));
        expect(report.results[0]).toEqual(expect.objectContaining({
            requestName: "Runner Request",
            status: 200,
            statusText: "OK",
        }));
        expect(report.results[0].tests).toEqual([{ name: "status ok", passed: true }]);
    });

    it("runs only requests inside the selected folder", async () => {
        const state = createState([
            {
                id: "collection-1",
                name: "Runner Collection",
                items: [
                    createRequest({ id: "root-request", name: "Root Request" }),
                    {
                        id: "folder-1",
                        name: "Folder",
                        children: [createRequest({ id: "folder-request", name: "Folder Request" })],
                    },
                ],
            },
        ]);

        const report = await runCollectionTarget(
            state,
            { kind: "folder", collectionId: "collection-1", folderId: "folder-1" },
            1,
        );

        expect(report.targetName).toBe("Folder");
        expect(report.totalRequests).toBe(1);
        expect(report.results[0].requestName).toBe("Folder Request");
    });
});
