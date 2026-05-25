import { describe, expect, it, vi } from "vitest";
import {
    getActivityById,
    getActivitiesSnapshot,
    getPanelById,
    registerActivity,
    registerPanel,
    registerTabComponent,
    getTabComponentsSnapshot,
} from "../src/host/registry";

describe("workbench registry", () => {
    it("registers and disposes workbench contributions by id", () => {
        const disposeActivity = registerActivity({
            id: "test-activity",
            label: "Test",
            bar: "left",
            section: "top",
            order: -1,
        });
        const disposePanel = registerPanel({
            id: "test-panel",
            label: "Test Panel",
            activityId: "test-activity",
            position: "left",
            order: -1,
            render: () => null,
        });
        const disposeTab = registerTabComponent({
            id: "test-tab",
            render: () => null,
        });

        expect(getActivityById("test-activity")?.label).toBe("Test");
        expect(getPanelById("test-panel")?.activityId).toBe("test-activity");
        expect(getTabComponentsSnapshot().some((entry) => entry.id === "test-tab")).toBe(true);

        disposeTab();
        disposePanel();
        disposeActivity();

        expect(getActivityById("test-activity")).toBeUndefined();
        expect(getPanelById("test-panel")).toBeUndefined();
        expect(getTabComponentsSnapshot().some((entry) => entry.id === "test-tab")).toBe(false);
    });

    it("orders activities by contribution order then id", () => {
        const disposeLater = registerActivity({
            id: "test-order-later",
            label: "Later",
            bar: "left",
            order: 20,
        });
        const disposeEarlier = registerActivity({
            id: "test-order-earlier",
            label: "Earlier",
            bar: "left",
            order: 10,
        });

        const ids = getActivitiesSnapshot()
            .filter((entry) => entry.id.startsWith("test-order-"))
            .map((entry) => entry.id);

        expect(ids).toEqual(["test-order-earlier", "test-order-later"]);

        disposeLater();
        disposeEarlier();
    });

    it("overwrites duplicate activity ids and only disposes the active contribution", () => {
        const firstActivate = vi.fn();
        const secondActivate = vi.fn();
        const disposeFirst = registerActivity({
            id: "test-duplicate",
            label: "First",
            bar: "left",
            onActivate: firstActivate,
        });
        const disposeSecond = registerActivity({
            id: "test-duplicate",
            label: "Second",
            bar: "left",
            onActivate: secondActivate,
        });

        expect(getActivityById("test-duplicate")?.label).toBe("Second");
        disposeFirst();
        expect(getActivityById("test-duplicate")?.label).toBe("Second");
        disposeSecond();
        expect(getActivityById("test-duplicate")).toBeUndefined();
    });
});
