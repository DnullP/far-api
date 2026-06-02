import { useEffect, type RefObject } from "react";
import { startWindowDrag } from "../api/windowDrag";

const DRAG_REGION_SELECTOR = [
    ".layout-v2-activity-bar",
    ".layout-v2-activity-bar__icon-list",
    ".layout-v2-activity-bar__icon-slot",
    ".layout-v2-activity-bar__tail-drop-target",
    ".layout-v2-panel-section__bar",
    ".layout-v2-panel-section__bar-list",
    ".layout-v2-panel-section__panel-slot",
    ".layout-v2-panel-section__content",
    ".layout-v2-panel-section__content-inner",
    ".layout-v2-panel-section__pane",
    ".layout-v2-panel-section__pane-header",
    ".layout-v2-panel-section__pane-body",
    ".collections-panel",
    ".panel-toolbar",
    ".collections-tree",
    ".env-panel",
    ".env-list",
    ".history-panel",
    ".history-list",
    ".history-empty",
].join(",");

const NO_DRAG_SELECTOR = [
    ".window-no-drag",
    "[data-layout-role='activity-icon']",
    "[data-layout-role='panel']",
    "[role='button']",
    "a",
    "button",
    "input",
    "textarea",
    "select",
    "option",
    "label",
    "[contenteditable='true']",
    ".collection-header",
    ".folder-item",
    ".request-item",
    ".env-item",
    ".history-entry",
    ".history-search",
    ".request-editor",
    ".response-viewer",
    ".settings-modal",
    ".collection-modal",
    ".env-modal",
    ".curl-modal",
    ".context-menu",
].join(",");

export function useWindowDragRegions(rootRef: RefObject<HTMLElement | null>): void {
    useEffect(() => {
        const rootElement = rootRef.current;
        if (!rootElement) {
            return;
        }

        const handlePointerDown = (event: PointerEvent) => {
            if (!rootElement.classList.contains("far-api-shell--tauri")) {
                return;
            }
            if (event.button !== 0 || event.ctrlKey) {
                return;
            }
            if (!(event.target instanceof Element)) {
                return;
            }

            const source = resolveWindowDragSource(event.target);
            if (!source) {
                return;
            }

            startWindowDrag(source);
        };

        rootElement.addEventListener("pointerdown", handlePointerDown, { capture: true });
        return () => {
            rootElement.removeEventListener("pointerdown", handlePointerDown, { capture: true });
        };
    }, [rootRef]);
}

function resolveWindowDragSource(target: Element): string | null {
    if (target.closest(NO_DRAG_SELECTOR)) {
        return null;
    }
    if (!target.closest(DRAG_REGION_SELECTOR)) {
        return null;
    }
    if (target.closest(".layout-v2-activity-bar")) {
        return "activity-bar";
    }
    if (target.closest(".layout-v2-panel-section__bar")) {
        return "panel-bar";
    }
    if (target.closest(".layout-v2-panel-section__content, .collections-panel, .env-panel, .history-panel")) {
        return "sidebar";
    }

    return null;
}
