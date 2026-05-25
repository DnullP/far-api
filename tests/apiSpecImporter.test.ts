import { describe, expect, it } from "vitest";
import { parseApiSpecImportJson } from "../src/services/apiSpecImporter";

describe("apiSpecImporter", () => {
    it("parses OpenAPI 3 JSON into request drafts", () => {
        const parsed = parseApiSpecImportJson(JSON.stringify({
            openapi: "3.0.3",
            info: { title: "Pet API" },
            servers: [{ url: "https://mock.local/api" }],
            paths: {
                "/pets": {
                    get: {
                        summary: "List pets",
                        parameters: [
                            { name: "limit", in: "query", schema: { type: "integer", default: 10 } },
                            { name: "X-Trace", in: "header", schema: { type: "string" }, example: "abc" },
                        ],
                    },
                    post: {
                        summary: "Create pet",
                        requestBody: {
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object",
                                        properties: {
                                            name: { type: "string", example: "Flora" },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        }));

        expect(parsed.format).toBe("openapi");
        expect(parsed.collection.name).toBe("Pet API");
        expect(parsed.collection.requests).toHaveLength(2);
        expect(parsed.collection.requests[0]).toEqual(expect.objectContaining({
            name: "List pets",
            method: "GET",
            url: "https://mock.local/api/pets",
        }));
        expect(parsed.collection.requests[0].params).toEqual([
            expect.objectContaining({ key: "limit", value: "10" }),
        ]);
        expect(parsed.collection.requests[0].headers).toEqual([
            expect.objectContaining({ key: "X-Trace", value: "abc" }),
        ]);
        expect(parsed.collection.requests[1].body).toEqual(expect.objectContaining({
            type: "json",
            json: "{\n  \"name\": \"Flora\"\n}",
        }));
    });

    it("parses Swagger 2 JSON into request drafts", () => {
        const parsed = parseApiSpecImportJson(JSON.stringify({
            swagger: "2.0",
            info: { title: "Legacy API" },
            schemes: ["https"],
            host: "mock.local",
            basePath: "/v1",
            consumes: ["application/x-www-form-urlencoded"],
            paths: {
                "/login": {
                    post: {
                        summary: "Login",
                        parameters: [
                            { name: "username", in: "formData", type: "string", default: "kai" },
                            { name: "password", in: "formData", type: "string" },
                        ],
                    },
                },
            },
        }));

        expect(parsed.format).toBe("swagger");
        expect(parsed.collection.name).toBe("Legacy API");
        expect(parsed.collection.requests[0]).toEqual(expect.objectContaining({
            name: "Login",
            method: "POST",
            url: "https://mock.local/v1/login",
        }));
        expect(parsed.collection.requests[0].body.form).toEqual([
            expect.objectContaining({ key: "username", value: "kai" }),
            expect.objectContaining({ key: "password", value: "" }),
        ]);
    });

    it("parses Postman Collection JSON into request drafts", () => {
        const parsed = parseApiSpecImportJson(JSON.stringify({
            info: {
                name: "Postman Demo",
                schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
            },
            auth: {
                type: "bearer",
                bearer: [{ key: "token", value: "{{api_token}}" }],
            },
            item: [
                {
                    name: "Echo",
                    request: {
                        method: "POST",
                        url: "https://mock.local/echo?debug=true",
                        header: [{ key: "Content-Type", value: "application/json" }],
                        body: {
                            mode: "raw",
                            raw: "{\"ok\":true}",
                            options: { raw: { language: "json" } },
                        },
                    },
                },
            ],
        }));

        expect(parsed.format).toBe("postman");
        expect(parsed.collection.name).toBe("Postman Demo");
        expect(parsed.collection.requests[0]).toEqual(expect.objectContaining({
            name: "Echo",
            method: "POST",
            url: "https://mock.local/echo",
        }));
        expect(parsed.collection.requests[0].params).toEqual([
            expect.objectContaining({ key: "debug", value: "true" }),
        ]);
        expect(parsed.collection.requests[0].body).toEqual(expect.objectContaining({
            type: "json",
            json: "{\"ok\":true}",
        }));
        expect(parsed.collection.requests[0].auth).toEqual(expect.objectContaining({
            type: "bearer",
            bearerToken: "{{api_token}}",
        }));
    });

    it("rejects unsupported JSON", () => {
        expect(() => parseApiSpecImportJson("{")).toThrow("valid JSON");
        expect(() => parseApiSpecImportJson(JSON.stringify({ info: { title: "Nope" } }))).toThrow("Unsupported");
    });
});
