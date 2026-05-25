import { useRef, useState, useCallback, useMemo, type ReactNode } from "react";
import {
    VSCodeWorkbench,
    type WorkbenchApi,
    type WorkbenchPanelContext,
} from "layout-v2";
import "layout-v2/styles.css";
import { AppStateProvider, useAppDispatch } from "./store/appStore";
import { SettingsModal, type Theme } from "./components/SettingsModal";
import {
    ensureWorkbenchContributionsRegistered,
    renderRegisteredPanel,
} from "./host/contributions/workbenchContributions";
import {
    getActivityById,
    useActivityDefinitions,
    usePanelDefinitions,
    useTabComponentRenderers,
} from "./host/registry";
import "./App.css";

const THEME_STORAGE_KEY = "far-api.theme";

function resolveInitialTheme(): Theme {
    if (typeof window === "undefined") {
        return "dark";
    }

    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === "dark" || storedTheme === "light") {
        return storedTheme;
    }

    const documentTheme = document.documentElement.getAttribute("data-theme");
    return documentTheme === "light" ? "light" : "dark";
}

function isTauriRuntime(): boolean {
    if (typeof window === "undefined") {
        return false;
    }

    const runtimeWindow = window as Window & {
        __TAURI_INTERNALS__?: unknown;
        __TAURI__?: unknown;
    };
    return Boolean(runtimeWindow.__TAURI_INTERNALS__ || runtimeWindow.__TAURI__);
}

function isMacPlatform(): boolean {
    if (typeof navigator === "undefined") {
        return false;
    }

    return `${navigator.userAgent} ${navigator.platform}`.toLowerCase().includes("mac");
}

function resolveShellClassName(): string {
    return [
        "far-api-shell",
        isTauriRuntime() ? "far-api-shell--tauri" : "",
        isMacPlatform() ? "far-api-shell--mac" : "",
    ].filter(Boolean).join(" ");
}

/* ---------- Component ---------- */

function AppContent(): ReactNode {
    ensureWorkbenchContributionsRegistered();
    const apiRef = useRef<WorkbenchApi | null>(null);
    const dispatch = useAppDispatch();
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [theme, setTheme] = useState<Theme>(resolveInitialTheme);
    const shellClassName = useMemo(resolveShellClassName, []);
    const activities = useActivityDefinitions();
    const panels = usePanelDefinitions();
    const tabComponents = useTabComponentRenderers();

    const handleThemeChange = useCallback((t: Theme) => {
        setTheme(t);
        window.localStorage.setItem(THEME_STORAGE_KEY, t);
        document.documentElement.setAttribute("data-theme", t);
    }, []);

    const handleActivateActivity = useCallback(
        (activityId: string, context: WorkbenchPanelContext) => {
            getActivityById(activityId)?.onActivate?.(context);
            if (activityId === "settings") {
                setSettingsOpen(true);
            }
        },
        [],
    );

    return (
        <>
            <div className={shellClassName}>
                <VSCodeWorkbench
                    activities={activities}
                    panels={panels}
                    tabComponents={tabComponents}
                    initialTabs={[
                        { id: "welcome-tab", title: "Welcome", component: "welcome" },
                    ]}
                    hideEmptyPanelBar
                    initialSidebarState={{
                        left: {
                            visible: true,
                            activeActivityId: "protocol-rest",
                            activePanelId: "panel-rest-collections",
                        },
                        right: {
                            visible: false,
                            activeActivityId: null,
                            activePanelId: null,
                        },
                    }}
                    renderActivityIcon={(act) => act.icon ?? <span>{act.label[0]}</span>}
                    renderPanelContent={renderRegisteredPanel}
                    onActivateActivity={handleActivateActivity}
                    onCloseTab={(tabId) => dispatch({ type: "REMOVE_TAB", tabId })}
                    apiRef={apiRef}
                    className="far-api-workbench"
                />
            </div>
            <SettingsModal
                open={settingsOpen}
                theme={theme}
                onThemeChange={handleThemeChange}
                onClose={() => setSettingsOpen(false)}
            />
        </>
    );
}

function App(): ReactNode {
    return (
        <AppStateProvider>
            <AppContent />
        </AppStateProvider>
    );
}

export default App;
