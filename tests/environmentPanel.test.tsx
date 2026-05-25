import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EnvironmentPanel } from "../src/components/EnvironmentPanel";
import type { AppState } from "../src/store/appStore";
import type { Environment } from "../src/types/api";

const storeMocks = vi.hoisted(() => ({
    state: {} as AppState,
    dispatch: vi.fn(),
}));

const persistenceMocks = vi.hoisted(() => ({
    createEnvironmentApi: vi.fn(),
    deleteEnvironmentApi: vi.fn(),
    setConfig: vi.fn(),
    updateEnvironmentApi: vi.fn(),
}));

vi.mock("../src/store/appStore", () => ({
    useAppState: () => storeMocks.state,
    useAppDispatch: () => storeMocks.dispatch,
}));

vi.mock("../src/services/persistence", () => ({
    ...persistenceMocks,
}));

function createEnvironment(overrides: Partial<Environment> = {}): Environment {
    return {
        id: "env-1",
        name: "Development",
        variables: [
            { id: "var-1", key: "base_url", value: "https://example.com", enabled: true },
        ],
        ...overrides,
    };
}

function createState(environments: Environment[], activeEnvironmentId: string | null = null): AppState {
    return {
        collections: [],
        environments,
        activeEnvironmentId,
        historyEntries: [],
        openRequests: {},
        responses: {},
        loadingRequests: {},
    };
}

describe("EnvironmentPanel", () => {
    beforeEach(() => {
        storeMocks.state = createState([createEnvironment()]);
        storeMocks.dispatch.mockReset();
        Object.values(persistenceMocks).forEach((mock) => mock.mockReset());
    });

    it("creates an environment from the modal", async () => {
        persistenceMocks.createEnvironmentApi.mockResolvedValue({
            id: "env-2",
            name: "Staging",
            variables: [],
        });

        render(<EnvironmentPanel />);

        fireEvent.click(screen.getByTitle("New Environment"));
        fireEvent.change(screen.getByLabelText("Environment name"), {
            target: { value: "Staging" },
        });
        fireEvent.change(screen.getByLabelText("Variable key"), {
            target: { value: "base_url" },
        });
        fireEvent.change(screen.getByLabelText("Variable value"), {
            target: { value: "https://staging.example.com" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => {
            expect(persistenceMocks.createEnvironmentApi).toHaveBeenCalledWith("Staging");
        });
        expect(persistenceMocks.updateEnvironmentApi).toHaveBeenCalledWith(
            expect.objectContaining({
                id: "env-2",
                name: "Staging",
                variables: [expect.objectContaining({ key: "base_url" })],
            }),
        );
        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "ADD_ENVIRONMENT",
            environment: expect.objectContaining({ id: "env-2", name: "Staging" }),
        });
    });

    it("edits an environment from the modal", async () => {
        render(<EnvironmentPanel />);

        fireEvent.click(screen.getByTitle("Edit Environment"));
        fireEvent.change(screen.getByLabelText("Environment name"), {
            target: { value: "Production" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => {
            expect(persistenceMocks.updateEnvironmentApi).toHaveBeenCalledWith(
                expect.objectContaining({ id: "env-1", name: "Production" }),
            );
        });
        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "UPDATE_ENVIRONMENT",
            envId: "env-1",
            env: expect.objectContaining({ name: "Production" }),
        });
    });

    it("activates and deletes environments from the list", async () => {
        render(<EnvironmentPanel />);

        fireEvent.click(screen.getByTitle("Activate Environment"));
        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "SET_ACTIVE_ENVIRONMENT",
            envId: "env-1",
        });
        await waitFor(() => {
            expect(persistenceMocks.setConfig).toHaveBeenCalledWith("activeEnvironmentId", "env-1");
        });

        fireEvent.click(screen.getByTitle("Delete Environment"));
        await waitFor(() => {
            expect(persistenceMocks.deleteEnvironmentApi).toHaveBeenCalledWith("env-1");
        });
        expect(storeMocks.dispatch).toHaveBeenCalledWith({
            type: "DELETE_ENVIRONMENT",
            envId: "env-1",
        });
    });
});
