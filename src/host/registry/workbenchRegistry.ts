import { useSyncExternalStore, type ReactNode } from "react";
import type {
    WorkbenchActivityDefinition,
    WorkbenchPanelContext,
    WorkbenchPanelDefinition,
    WorkbenchTabApi,
} from "layout-v2";

export type WorkbenchTabRenderer = (props: {
    params: Record<string, unknown>;
    api: WorkbenchTabApi;
}) => ReactNode;

export interface ActivityContribution extends WorkbenchActivityDefinition {
    order?: number;
    onActivate?: (context: WorkbenchPanelContext) => void;
}

export interface PanelContribution extends WorkbenchPanelDefinition {
    render: (context: WorkbenchPanelContext) => ReactNode;
}

export interface TabComponentContribution {
    id: string;
    render: WorkbenchTabRenderer;
}

const activities = new Map<string, ActivityContribution>();
const panels = new Map<string, PanelContribution>();
const tabComponents = new Map<string, TabComponentContribution>();
const listeners = new Set<() => void>();

let activitySnapshot: ActivityContribution[] = [];
let panelSnapshot: PanelContribution[] = [];
let tabComponentSnapshot: TabComponentContribution[] = [];
let activityDefinitionSnapshot: WorkbenchActivityDefinition[] = [];
let panelDefinitionSnapshot: WorkbenchPanelDefinition[] = [];
let tabComponentRendererSnapshot: Record<string, WorkbenchTabRenderer> = {};

function emit(): void {
    activitySnapshot = Array.from(activities.values()).sort((left, right) => {
        const leftOrder = left.order ?? 0;
        const rightOrder = right.order ?? 0;
        if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
        }
        return left.id.localeCompare(right.id);
    });
    panelSnapshot = Array.from(panels.values()).sort((left, right) => {
        const leftOrder = left.order ?? 0;
        const rightOrder = right.order ?? 0;
        if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
        }
        return left.id.localeCompare(right.id);
    });
    tabComponentSnapshot = Array.from(tabComponents.values()).sort((left, right) =>
        left.id.localeCompare(right.id),
    );
    activityDefinitionSnapshot = activitySnapshot.map(toActivityDefinition);
    panelDefinitionSnapshot = panelSnapshot.map(toPanelDefinition);
    tabComponentRendererSnapshot = buildTabComponentRendererMap(tabComponentSnapshot);
    listeners.forEach((listener) => listener());
}

export function registerActivity(contribution: ActivityContribution): () => void {
    activities.set(contribution.id, contribution);
    emit();
    return () => {
        if (activities.get(contribution.id) === contribution) {
            activities.delete(contribution.id);
            emit();
        }
    };
}

export function registerPanel(contribution: PanelContribution): () => void {
    panels.set(contribution.id, contribution);
    emit();
    return () => {
        if (panels.get(contribution.id) === contribution) {
            panels.delete(contribution.id);
            emit();
        }
    };
}

export function registerTabComponent(contribution: TabComponentContribution): () => void {
    tabComponents.set(contribution.id, contribution);
    emit();
    return () => {
        if (tabComponents.get(contribution.id) === contribution) {
            tabComponents.delete(contribution.id);
            emit();
        }
    };
}

export function subscribeWorkbenchRegistry(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getActivitiesSnapshot(): ActivityContribution[] {
    return activitySnapshot;
}

export function getPanelsSnapshot(): PanelContribution[] {
    return panelSnapshot;
}

export function getTabComponentsSnapshot(): TabComponentContribution[] {
    return tabComponentSnapshot;
}

export function getActivityById(activityId: string): ActivityContribution | undefined {
    return activities.get(activityId);
}

export function getPanelById(panelId: string): PanelContribution | undefined {
    return panels.get(panelId);
}

export function useActivityDefinitions(): WorkbenchActivityDefinition[] {
    return useSyncExternalStore(
        subscribeWorkbenchRegistry,
        () => activityDefinitionSnapshot,
        () => activityDefinitionSnapshot,
    );
}

export function usePanelDefinitions(): WorkbenchPanelDefinition[] {
    return useSyncExternalStore(
        subscribeWorkbenchRegistry,
        () => panelDefinitionSnapshot,
        () => panelDefinitionSnapshot,
    );
}

export function useTabComponentRenderers(): Record<string, WorkbenchTabRenderer> {
    return useSyncExternalStore(
        subscribeWorkbenchRegistry,
        () => tabComponentRendererSnapshot,
        () => tabComponentRendererSnapshot,
    );
}

function toActivityDefinition(contribution: ActivityContribution): WorkbenchActivityDefinition {
    const { order: _order, onActivate: _onActivate, ...definition } = contribution;
    return definition;
}

function toPanelDefinition(contribution: PanelContribution): WorkbenchPanelDefinition {
    const { render: _render, ...definition } = contribution;
    return definition;
}

function buildTabComponentRendererMap(
    contributions: TabComponentContribution[],
): Record<string, WorkbenchTabRenderer> {
    return Object.fromEntries(contributions.map((entry) => [entry.id, entry.render]));
}
