import { describe, expect, it } from "vitest";
import type { AppState } from "../src/store/appStore";
import {
    createKeyValuePair,
    createRequestAuth,
    createRequestScripts,
    type ApiRequest,
    type ApiResponse,
} from "../src/types/api";
import { runPostResponseScript, runPreRequestScript } from "../src/services/scriptRunner";

function createState(): AppState {
    return {
        collections: [],
        environments: [
            {
                id: "env-1",
                name: "Development",
                variables: [
                    { id: "var-1", key: "trace", value: "trace-dev", enabled: true },
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
        name: "Scripted",
        method: "GET",
        url: "https://mock.local/anything",
        params: [createKeyValuePair()],
        headers: [createKeyValuePair()],
        body: { type: "none", json: "{}", form: [createKeyValuePair()], raw: "" },
        auth: createRequestAuth(),
        scripts: createRequestScripts(),
        ...overrides,
    };
}

function createResponse(overrides: Partial<ApiResponse> = {}): ApiResponse {
    return {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        body: "{\"ok\":true}",
        time: 42,
        size: 11,
        ...overrides,
    };
}

describe("scriptRunner", () => {
    it("runs pre-request scripts against a mutable pm.request API", () => {
        const result = runPreRequestScript(
            createRequest({
                scripts: createRequestScripts({
                    preRequest: [
                        "pm.request.method = 'POST';",
                        "pm.request.url = 'https://mock.local/scripted';",
                        "pm.request.headers.upsert({ key: 'X-Trace', value: pm.environment.get('trace') });",
                        "pm.request.params.add({ key: 'from', value: 'script' });",
                        "pm.request.body.update({ ok: true });",
                        "console.log('pre ran');",
                    ].join("\n"),
                }),
            }),
            createState(),
        );

        expect(result.request.method).toBe("POST");
        expect(result.request.url).toBe("https://mock.local/scripted");
        expect(result.request.headers).toContainEqual(expect.objectContaining({
            key: "X-Trace",
            value: "trace-dev",
        }));
        expect(result.request.params).toContainEqual(expect.objectContaining({
            key: "from",
            value: "script",
        }));
        expect(result.request.body).toEqual(expect.objectContaining({
            type: "json",
            json: "{\n  \"ok\": true\n}",
        }));
        expect(result.console).toEqual([{ level: "log", message: "pre ran" }]);
    });

    it("runs post-response scripts and records test results", () => {
        const result = runPostResponseScript(
            createRequest({
                scripts: createRequestScripts({
                    postResponse: [
                        "pm.test('status is OK', () => pm.expect(pm.response.code).to.equal(200));",
                        "pm.test('body has ok', () => pm.expect(pm.response.json()).to.have.property('ok', true));",
                    ].join("\n"),
                }),
            }),
            createResponse(),
            createState(),
        );

        expect(result.tests).toEqual([
            { name: "status is OK", passed: true },
            { name: "body has ok", passed: true },
        ]);
    });

    it("records script failures as failed tests", () => {
        const result = runPreRequestScript(
            createRequest({
                scripts: createRequestScripts({
                    preRequest: "throw new Error('nope');",
                }),
            }),
            createState(),
        );

        expect(result.tests).toEqual([
            { name: "pre-request script", passed: false, error: "nope" },
        ]);
    });

    it("returns runtime and environment variables for request resolution", () => {
        const result = runPreRequestScript(
            createRequest({
                url: "https://mock.local/{{runtime_path}}?trace={{trace}}",
                scripts: createRequestScripts({
                    preRequest: [
                        "pm.variables.set('runtime_path', 'from-local');",
                        "pm.environment.set('trace', 'trace-script');",
                    ].join("\n"),
                }),
            }),
            createState(),
        );

        expect(result.variables).toEqual({ runtime_path: "from-local" });
        expect(result.environments[0].variables).toContainEqual(expect.objectContaining({
            key: "trace",
            value: "trace-script",
            enabled: true,
        }));
    });
});
