import { useRef, useState, useCallback, type ReactNode } from "react";
import {
    VSCodeWorkbench,
    type WorkbenchActivityDefinition,
    type WorkbenchPanelDefinition,
    type WorkbenchApi,
    type WorkbenchPanelContext,
} from "layout-v2";
import "layout-v2/styles.css";
import { AppStateProvider, useAppDispatch } from "./store/appStore";
import { RequestEditor } from "./components/RequestEditor";
import { CollectionsPanel } from "./components/CollectionsPanel";
import { EnvironmentPanel } from "./components/EnvironmentPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { WelcomeTab } from "./components/WelcomeTab";
import { SettingsModal, type Theme } from "./components/SettingsModal";
import { Braces, FolderOpen, Globe, History, Network, RadioTower, Settings } from "lucide-react";
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

/* ---------- Layout definitions ---------- */

const activities: WorkbenchActivityDefinition[] = [
    { id: "protocol-rest", label: "REST", bar: "left", section: "top", icon: <Network size={20} /> },
    { id: "protocol-graphql", label: "GraphQL", bar: "left", section: "top", icon: <Braces size={20} /> },
    { id: "protocol-rpc", label: "RPC", bar: "left", section: "top", icon: <RadioTower size={20} /> },
    { id: "settings", label: "Settings", bar: "left", section: "bottom", activationMode: "action", icon: <Settings size={20} /> },
];

const panels: WorkbenchPanelDefinition[] = [
    {
        id: "panel-rest-collections",
        label: "Collections",
        icon: <FolderOpen size={16} />,
        activityId: "protocol-rest",
        position: "left",
        order: 0,
    },
    {
        id: "panel-rest-env",
        label: "Environments",
        icon: <Globe size={16} />,
        activityId: "protocol-rest",
        position: "left",
        order: 1,
    },
    {
        id: "panel-rest-history",
        label: "History",
        icon: <History size={16} />,
        activityId: "protocol-rest",
        position: "left",
        order: 2,
    },
    {
        id: "panel-graphql-overview",
        label: "GraphQL",
        icon: <Braces size={16} />,
        activityId: "protocol-graphql",
        position: "left",
        order: 0,
    },
    {
        id: "panel-rpc-overview",
        label: "RPC",
        icon: <RadioTower size={16} />,
        activityId: "protocol-rpc",
        position: "left",
        order: 0,
    },
];

/* ---------- Component ---------- */

function AppContent(): ReactNode {
    const apiRef = useRef<WorkbenchApi | null>(null);
    const dispatch = useAppDispatch();
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [theme, setTheme] = useState<Theme>(resolveInitialTheme);

    const handleThemeChange = useCallback((t: Theme) => {
        setTheme(t);
        window.localStorage.setItem(THEME_STORAGE_KEY, t);
        document.documentElement.setAttribute("data-theme", t);
    }, []);

    const handleActivateActivity = useCallback(
        (activityId: string) => {
            if (activityId === "settings") {
                setSettingsOpen(true);
            }
        },
        [],
    );

    return (
        <>
            <VSCodeWorkbench
                activities={activities}
                panels={panels}
                tabComponents={{
                    "request-editor": (props) => <RequestEditor params={props.params} api={props.api} />,
                    welcome: () => <WelcomeTab />,
                }}
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
                renderPanelContent={(panelId, context) => (
                    <PanelRouter panelId={panelId} context={context} />
                )}
                onActivateActivity={handleActivateActivity}
                onCloseTab={(tabId) => dispatch({ type: "REMOVE_TAB", tabId })}
                apiRef={apiRef}
                className="far-api-workbench"
            />
            <SettingsModal
                open={settingsOpen}
                theme={theme}
                onThemeChange={handleThemeChange}
                onClose={() => setSettingsOpen(false)}
            />
        </>
    );
}

function PanelRouter({ panelId, context }: { panelId: string; context: WorkbenchPanelContext }): ReactNode {
    switch (panelId) {
        case "panel-rest-collections":
            return <CollectionsPanel context={context} />;
        case "panel-rest-env":
            return <EnvironmentPanel />;
        case "panel-rest-history":
            return <HistoryPanel />;
        case "panel-graphql-overview":
            return <ProtocolPlaceholderPanel protocol="GraphQL" description="GraphQL workspace is reserved and will be implemented after REST." />;
        case "panel-rpc-overview":
            return <ProtocolPlaceholderPanel protocol="RPC" description="RPC workspace is reserved and will be implemented after REST." />;
        default:
            return <div style={{ padding: 16 }}>Panel: {panelId}</div>;
    }
}

function ProtocolPlaceholderPanel({ protocol, description }: { protocol: string; description: string }): ReactNode {
    return (
        <div
            style={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                padding: 20,
                gap: 8,
                color: "var(--text-secondary)",
            }}
        >
            <strong style={{ color: "var(--text-primary)", fontSize: 13 }}>{protocol}</strong>
            <span style={{ fontSize: 12, lineHeight: 1.5 }}>{description}</span>
        </div>
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
