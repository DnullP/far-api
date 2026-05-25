import type { ReactNode } from "react";
import type { WorkbenchPanelContext } from "layout-v2";
import { Braces, FolderOpen, Globe, History, Network, RadioTower, Settings } from "lucide-react";
import {
    getPanelById,
    registerActivity,
    registerPanel,
    registerTabComponent,
    type ActivityContribution,
    type PanelContribution,
} from "../registry";
import { CollectionsPanel } from "../../components/CollectionsPanel";
import { EnvironmentPanel } from "../../components/EnvironmentPanel";
import { HistoryPanel } from "../../components/HistoryPanel";
import { RequestEditor } from "../../components/RequestEditor";
import { WelcomeTab } from "../../components/WelcomeTab";

let bootstrapped = false;

export function ensureWorkbenchContributionsRegistered(): void {
    if (bootstrapped) {
        return;
    }

    bootstrapped = true;
    for (const activity of builtinActivities()) {
        registerActivity(activity);
    }
    for (const panel of builtinPanels()) {
        registerPanel(panel);
    }

    registerTabComponent({
        id: "request-editor",
        render: (props) => <RequestEditor params={props.params} api={props.api} />,
    });
    registerTabComponent({
        id: "welcome",
        render: () => <WelcomeTab />,
    });
}

function builtinActivities(): ActivityContribution[] {
    return [
        {
            id: "protocol-rest",
            label: "REST",
            bar: "left",
            section: "top",
            order: 0,
            icon: <Network size={20} />,
        },
        {
            id: "protocol-graphql",
            label: "GraphQL",
            bar: "left",
            section: "top",
            order: 10,
            icon: <Braces size={20} />,
        },
        {
            id: "protocol-rpc",
            label: "RPC",
            bar: "left",
            section: "top",
            order: 20,
            icon: <RadioTower size={20} />,
        },
        {
            id: "settings",
            label: "Settings",
            bar: "left",
            section: "bottom",
            activationMode: "action",
            order: 1000,
            icon: <Settings size={20} />,
        },
    ];
}

function builtinPanels(): PanelContribution[] {
    return [
        {
            id: "panel-rest-collections",
            label: "Collections",
            icon: <FolderOpen size={16} />,
            activityId: "protocol-rest",
            position: "left",
            order: 0,
            render: (context) => <CollectionsPanel context={context} />,
        },
        {
            id: "panel-rest-env",
            label: "Environments",
            icon: <Globe size={16} />,
            activityId: "protocol-rest",
            position: "left",
            order: 1,
            render: () => <EnvironmentPanel />,
        },
        {
            id: "panel-rest-history",
            label: "History",
            icon: <History size={16} />,
            activityId: "protocol-rest",
            position: "left",
            order: 2,
            render: (context) => <HistoryPanel context={context} />,
        },
        {
            id: "panel-graphql-overview",
            label: "GraphQL",
            icon: <Braces size={16} />,
            activityId: "protocol-graphql",
            position: "left",
            order: 0,
            render: () => (
                <ProtocolPlaceholderPanel
                    protocol="GraphQL"
                    description="GraphQL workspace is reserved and will be implemented after REST."
                />
            ),
        },
        {
            id: "panel-rpc-overview",
            label: "RPC",
            icon: <RadioTower size={16} />,
            activityId: "protocol-rpc",
            position: "left",
            order: 0,
            render: () => (
                <ProtocolPlaceholderPanel
                    protocol="RPC"
                    description="RPC workspace is reserved and will be implemented after REST."
                />
            ),
        },
    ];
}

function ProtocolPlaceholderPanel({
    protocol,
    description,
}: {
    protocol: string;
    description: string;
}): ReactNode {
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

export function renderRegisteredPanel(panelId: string, context: WorkbenchPanelContext): ReactNode {
    return getPanelById(panelId)?.render(context) ?? <div style={{ padding: 16 }}>Panel: {panelId}</div>;
}
