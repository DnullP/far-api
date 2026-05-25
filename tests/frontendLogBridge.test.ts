import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    buildConsoleLogEntry,
    setupFrontendLogBridge,
    stringifyLogArgs,
} from "../src/api/frontendLogBridge";
import { safeStringify } from "../src/api/logSanitizer";

const tauriClientMocks = vi.hoisted(() => ({
    invokeCommand: vi.fn(),
}));

vi.mock("../src/api/tauriClient", () => ({
    invokeCommand: tauriClientMocks.invokeCommand,
}));

describe("frontend log bridge helpers", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-05-26T00:00:00.000Z"));
        window.history.replaceState(null, "", "/log-test");
        tauriClientMocks.invokeCommand.mockReset();
        tauriClientMocks.invokeCommand.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("formats console placeholders and trailing objects", () => {
        expect(stringifyLogArgs(["saved %s in %dms", "request", 12, { ok: true }]))
            .toBe("saved request in 12ms {\"ok\":true}");
    });

    it("serializes errors with useful fields", () => {
        const message = stringifyLogArgs(["failed", new Error("boom")]);

        expect(message).toContain("failed");
        expect(message).toContain("\"name\":\"Error\"");
        expect(message).toContain("\"message\":\"boom\"");
    });

    it("builds a structured frontend_log entry with page context", () => {
        const entry = buildConsoleLogEntry("warn", ["probe", { id: "abc" }]);

        expect(entry).toEqual({
            level: "warn",
            module: "console",
            message: "probe {\"id\":\"abc\"}",
            href: "http://localhost:3000/log-test",
            ts: 1_779_753_600_000,
        });
    });

    it("redacts sensitive fields before stringifying logs", () => {
        const payload = safeStringify({
            headers: {
                Authorization: "Bearer secret",
                Cookie: "session=secret",
            },
            password: "p",
            nested: { apiKey: "k", visible: "ok" },
        });

        expect(payload).toContain("\"Authorization\":\"[redacted]\"");
        expect(payload).toContain("\"Cookie\":\"[redacted]\"");
        expect(payload).toContain("\"password\":\"[redacted]\"");
        expect(payload).toContain("\"apiKey\":\"[redacted]\"");
        expect(payload).toContain("\"visible\":\"ok\"");
        expect(payload).not.toContain("Bearer secret");
        expect(payload).not.toContain("session=secret");
    });

    it("does not drop rapid consecutive console logs while forwarding is pending", () => {
        const neverSettles = new Promise<void>(() => {});
        tauriClientMocks.invokeCommand.mockReturnValue(neverSettles);

        setupFrontendLogBridge();
        console.info("first bridge line");
        console.info("second bridge line");

        expect(tauriClientMocks.invokeCommand).toHaveBeenCalledTimes(2);
        expect(tauriClientMocks.invokeCommand.mock.calls[0][1]).toMatchObject({
            entry: { module: "console", message: "first bridge line" },
        });
        expect(tauriClientMocks.invokeCommand.mock.calls[1][1]).toMatchObject({
            entry: { module: "console", message: "second bridge line" },
        });
    });
});
