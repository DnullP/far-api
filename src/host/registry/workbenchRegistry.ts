import {
    createWorkbenchRegistry,
    type WorkbenchActivityContribution,
    type WorkbenchActivityDefinition,
    type WorkbenchPanelContribution,
    type WorkbenchPanelDefinition,
    type WorkbenchTabComponentContribution,
    type WorkbenchTabRenderer,
} from "layout-v2";

export type ActivityContribution = WorkbenchActivityContribution;
export type PanelContribution = WorkbenchPanelContribution;
export type TabComponentContribution = WorkbenchTabComponentContribution;
export type { WorkbenchTabRenderer };

const registry = createWorkbenchRegistry();

export function registerActivity(contribution: ActivityContribution): () => void {
    return registry.registerActivity(contribution);
}

export function registerPanel(contribution: PanelContribution): () => void {
    return registry.registerPanel(contribution);
}

export function registerTabComponent(contribution: TabComponentContribution): () => void {
    return registry.registerTabComponent(contribution);
}

export function subscribeWorkbenchRegistry(listener: () => void): () => void {
    return registry.subscribe(listener);
}

export function getActivitiesSnapshot(): ActivityContribution[] {
    return registry.getActivitiesSnapshot();
}

export function getPanelsSnapshot(): PanelContribution[] {
    return registry.getPanelsSnapshot();
}

export function getTabComponentsSnapshot(): TabComponentContribution[] {
    return registry.getTabComponentsSnapshot();
}

export function getActivityById(activityId: string): ActivityContribution | undefined {
    return registry.getActivityById(activityId);
}

export function getPanelById(panelId: string): PanelContribution | undefined {
    return registry.getPanelById(panelId);
}

export function useActivityDefinitions(): WorkbenchActivityDefinition[] {
    return registry.useActivityDefinitions();
}

export function usePanelDefinitions(): WorkbenchPanelDefinition[] {
    return registry.usePanelDefinitions();
}

export function useTabComponentRenderers(): Record<string, WorkbenchTabRenderer> {
    return registry.useTabComponentRenderers();
}
