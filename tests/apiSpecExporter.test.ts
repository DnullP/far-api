import { describe, expect, it, vi } from "vitest";
import { exportCollectionAsPostman, exportEnvironmentAsPostman } from "../src/services/apiSpecExporter";
import { createKeyValuePair, createRequestAuth, createRequestScripts, type Collection, type Environment } from "../src/types/api";

vi.mock("../src/services/logger", () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

describe("apiSpecExporter", () => {
    it("exports nested collections as Postman v2.1 JSON", () => {
        const collection: Collection = {
            id: "col-1",
            name: "Team API",
            items: [
                {
                    id: "folder-1",
                    name: "Admin",
                    children: [
                        {
                            id: "req-1",
                            name: "Create User",
                            method: "POST",
                            url: "https://mock.local/users",
                            params: [createKeyValuePair("debug", "true")],
                            headers: [createKeyValuePair("Content-Type", "application/json")],
                            body: {
                                type: "json",
                                json: "{\"name\":\"Kai\"}",
                                form: [createKeyValuePair()],
                                raw: "",
                            },
                            auth: createRequestAuth({
                                type: "bearer",
                                bearerToken: "{{api_token}}",
                            }),
                            scripts: createRequestScripts({
                                preRequest: "pm.environment.set('trace_id', 'abc');",
                                postResponse: "pm.test('ok', () => pm.response.to.have.status(200));",
                            }),
                        },
                    ],
                },
            ],
        };

        const artifact = exportCollectionAsPostman(collection);
        const document = JSON.parse(artifact.json);

        expect(artifact.fileName).toBe("team-api.postman_collection.json");
        expect(document.info).toEqual(expect.objectContaining({
            name: "Team API",
            schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        }));
        expect(document.item[0].name).toBe("Admin");
        expect(document.item[0].item[0].request).toEqual(expect.objectContaining({
            method: "POST",
            auth: expect.objectContaining({ type: "bearer" }),
        }));
        expect(document.item[0].item[0].request.url.raw).toBe("https://mock.local/users?debug=true");
        expect(document.item[0].item[0].request.body).toEqual(expect.objectContaining({
            mode: "raw",
            raw: "{\"name\":\"Kai\"}",
        }));
        expect(document.item[0].item[0].event.map((event: { listen: string }) => event.listen)).toEqual([
            "prerequest",
            "test",
        ]);
    });

    it("exports environments as Postman environment JSON", () => {
        const environment: Environment = {
            id: "env-1",
            name: "Production",
            variables: [
                { ...createKeyValuePair("base_url", "https://example.com"), enabled: true },
                { ...createKeyValuePair("", "ignored"), enabled: true },
                { ...createKeyValuePair("disabled_key", "secret"), enabled: false },
            ],
        };

        const artifact = exportEnvironmentAsPostman(environment);
        const document = JSON.parse(artifact.json);

        expect(artifact.fileName).toBe("production.postman_environment.json");
        expect(document).toEqual(expect.objectContaining({
            id: "env-1",
            name: "Production",
            _postman_variable_scope: "environment",
            _postman_exported_using: "far-api",
        }));
        expect(document.values).toEqual([
            expect.objectContaining({ key: "base_url", value: "https://example.com", enabled: true }),
            expect.objectContaining({ key: "disabled_key", value: "secret", enabled: false }),
        ]);
    });
});
