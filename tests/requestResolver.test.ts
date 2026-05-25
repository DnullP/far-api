import { describe, expect, it } from "vitest";
import { resolveRequest } from "../src/services/requestResolver";
import { createRequestAuth, type ApiRequest } from "../src/types/api";
import type { AppState } from "../src/store/appStore";

function createState(): AppState {
    return {
        collections: [],
        environments: [
            {
                id: "env-1",
                name: "Development",
                variables: [
                    { id: "var-1", key: "base_url", value: "https://mock.local", enabled: true },
                    { id: "var-2", key: "token", value: "secret-token", enabled: true },
                    { id: "var-3", key: "workspace", value: "dev", enabled: true },
                    { id: "var-4", key: "disabled", value: "hidden", enabled: false },
                ],
            },
        ],
        activeEnvironmentId: "env-1",
        historyEntries: [],
        openRequests: {},
        responses: {},
        loadingRequests: {},
    };
}

function createRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
    return {
        id: "req-1",
        name: "Example",
        method: "POST",
        url: "{{base_url}}/anything",
        params: [{ id: "param-1", key: "from", value: "{{workspace}}", enabled: true }],
        headers: [{ id: "header-1", key: "X-Workspace", value: "{{workspace}}", enabled: true }],
        body: {
            type: "json",
            json: "{\"workspace\":\"{{workspace}}\",\"missing\":\"{{missing}}\"}",
            form: [],
            raw: "",
        },
        auth: createRequestAuth(),
        ...overrides,
    };
}

describe("requestResolver", () => {
    it("resolves URL, params, headers, and body variables", () => {
        const resolved = resolveRequest(createRequest(), createState());

        expect(resolved.url).toBe("https://mock.local/anything");
        expect(resolved.params).toEqual([{ key: "from", value: "dev" }]);
        expect(resolved.headers).toEqual({ "X-Workspace": "dev" });
        expect(resolved.body.json).toBe("{\"workspace\":\"dev\",\"missing\":\"{{missing}}\"}");
    });

    it("applies bearer auth after resolving variables", () => {
        const resolved = resolveRequest(
            createRequest({
                auth: createRequestAuth({ type: "bearer", bearerToken: "{{token}}" }),
            }),
            createState(),
        );

        expect(resolved.headers.Authorization).toBe("Bearer secret-token");
    });

    it("applies API key auth to query params", () => {
        const resolved = resolveRequest(
            createRequest({
                auth: createRequestAuth({
                    type: "apiKey",
                    apiKeyName: "api_key",
                    apiKeyValue: "{{token}}",
                    apiKeyPlacement: "query",
                }),
            }),
            createState(),
        );

        expect(resolved.params).toContainEqual({ key: "api_key", value: "secret-token" });
    });
});
