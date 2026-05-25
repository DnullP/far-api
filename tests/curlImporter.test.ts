import { describe, expect, it } from "vitest";
import { parseCurlCommand, tokenizeShell } from "../src/services/curlImporter";

describe("curlImporter", () => {
    it("tokenizes quoted and multiline shell commands", () => {
        expect(tokenizeShell("curl \\\n  -H 'X-Trace: abc' \"https://example.com/a b\"")).toEqual([
            "curl",
            "-H",
            "X-Trace: abc",
            "https://example.com/a b",
        ]);
    });

    it("parses method, URL params, headers, and JSON body", () => {
        const request = parseCurlCommand(
            "curl -X PATCH 'https://mock.local/users?active=true' -H 'Content-Type: application/json' -H 'X-Trace: abc' --data '{\"name\":\"Kai\"}'",
        );

        expect(request.method).toBe("PATCH");
        expect(request.url).toBe("https://mock.local/users");
        expect(request.params).toEqual([expect.objectContaining({ key: "active", value: "true" })]);
        expect(request.headers).toEqual([
            expect.objectContaining({ key: "Content-Type", value: "application/json" }),
            expect.objectContaining({ key: "X-Trace", value: "abc" }),
        ]);
        expect(request.body).toEqual(expect.objectContaining({
            type: "json",
            json: "{\"name\":\"Kai\"}",
        }));
    });

    it("defaults to POST for data commands and parses form bodies", () => {
        const request = parseCurlCommand(
            "curl 'https://mock.local/login' -H 'Content-Type: application/x-www-form-urlencoded' -d 'name=kai' -d 'team=far'",
        );

        expect(request.method).toBe("POST");
        expect(request.body.type).toBe("form");
        expect(request.body.form).toEqual([
            expect.objectContaining({ key: "name", value: "kai" }),
            expect.objectContaining({ key: "team", value: "far" }),
        ]);
    });

    it("adds basic authorization from user credentials", () => {
        const request = parseCurlCommand("curl -u kai:secret https://mock.local/me");

        expect(request.headers).toEqual([
            expect.objectContaining({ key: "Authorization", value: "Basic a2FpOnNlY3JldA==" }),
        ]);
    });

    it("throws for invalid commands", () => {
        expect(() => parseCurlCommand("wget https://mock.local")).toThrow("Command must start with curl.");
        expect(() => parseCurlCommand("curl -X TRACE https://mock.local")).toThrow("Unsupported HTTP method");
    });
});
