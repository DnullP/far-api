import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useAppDispatch, useAppState } from "../store/appStore";
import { createKeyValuePair, type Environment, type EnvironmentVariable } from "../types/api";
import {
    createEnvironmentApi,
    deleteEnvironmentApi,
    setConfig,
    updateEnvironmentApi,
} from "../services/persistence";
import "./EnvironmentPanel.css";

function cloneVariables(variables: EnvironmentVariable[]): EnvironmentVariable[] {
    return variables.map((variable) => ({ ...variable }));
}

function createDraftEnvironment(env?: Environment): Environment {
    if (env) {
        return {
            ...env,
            variables: cloneVariables(env.variables),
        };
    }

    return {
        id: "",
        name: "New Environment",
        variables: [createKeyValuePair()],
    };
}

function EnvironmentEditorModal({
    mode,
    draft,
    onDraftChange,
    onCancel,
    onConfirm,
}: {
    mode: "create" | "edit";
    draft: Environment;
    onDraftChange: (draft: Environment) => void;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    const title = mode === "create" ? "New Environment" : "Edit Environment";

    const updateVariable = (
        variableId: string,
        variable: Partial<EnvironmentVariable>,
    ) => {
        onDraftChange({
            ...draft,
            variables: draft.variables.map((entry) =>
                entry.id === variableId ? { ...entry, ...variable } : entry,
            ),
        });
    };

    return (
        <div className="env-modal-overlay" onClick={onCancel}>
            <form
                className="env-modal"
                role="dialog"
                aria-modal="true"
                aria-label={title}
                onClick={(event) => event.stopPropagation()}
                onSubmit={(event) => {
                    event.preventDefault();
                    onConfirm();
                }}
            >
                <div className="env-modal-header">
                    <span className="env-modal-title">{title}</span>
                    <button
                        className="env-modal-close"
                        type="button"
                        aria-label="Close environment modal"
                        onClick={onCancel}
                    >
                        <X size={16} />
                    </button>
                </div>
                <div className="env-modal-body">
                    <label className="env-modal-field">
                        <span>Name</span>
                        <input
                            aria-label="Environment name"
                            value={draft.name}
                            autoFocus
                            onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
                        />
                    </label>
                    <div className="env-modal-vars">
                        <div className="env-modal-section-title">Variables</div>
                        {draft.variables.map((variable) => (
                            <div className="env-modal-var-row" key={variable.id}>
                                <input
                                    aria-label={`Enable ${variable.key || "variable"}`}
                                    type="checkbox"
                                    checked={variable.enabled}
                                    onChange={(event) =>
                                        updateVariable(variable.id, { enabled: event.target.checked })
                                    }
                                />
                                <input
                                    aria-label="Variable key"
                                    className="env-modal-var-key"
                                    value={variable.key}
                                    placeholder="key"
                                    onChange={(event) =>
                                        updateVariable(variable.id, { key: event.target.value })
                                    }
                                />
                                <input
                                    aria-label="Variable value"
                                    className="env-modal-var-value"
                                    value={variable.value}
                                    placeholder="value"
                                    onChange={(event) =>
                                        updateVariable(variable.id, { value: event.target.value })
                                    }
                                />
                                <button
                                    className="env-modal-icon-btn"
                                    type="button"
                                    title="Remove Variable"
                                    onClick={() =>
                                        onDraftChange({
                                            ...draft,
                                            variables: draft.variables.filter((entry) => entry.id !== variable.id),
                                        })
                                    }
                                >
                                    <Trash2 size={13} />
                                </button>
                            </div>
                        ))}
                        <button
                            className="env-add-var-btn"
                            type="button"
                            onClick={() =>
                                onDraftChange({
                                    ...draft,
                                    variables: [...draft.variables, createKeyValuePair()],
                                })
                            }
                        >
                            <Plus size={13} />
                            <span>Add Variable</span>
                        </button>
                    </div>
                </div>
                <div className="env-modal-footer">
                    <button type="button" className="env-modal-secondary" onClick={onCancel}>
                        Cancel
                    </button>
                    <button type="submit" className="env-modal-primary">
                        Save
                    </button>
                </div>
            </form>
        </div>
    );
}

export function EnvironmentPanel() {
    const state = useAppState();
    const dispatch = useAppDispatch();
    const [editingEnvId, setEditingEnvId] = useState<string | null>(null);
    const [draftEnv, setDraftEnv] = useState<Environment | null>(null);

    useEffect(() => {
        if (!draftEnv) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setDraftEnv(null);
                setEditingEnvId(null);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [draftEnv]);

    const beginCreateEnvironment = () => {
        setEditingEnvId(null);
        setDraftEnv(createDraftEnvironment());
    };

    const beginEditEnvironment = (env: Environment) => {
        setEditingEnvId(env.id);
        setDraftEnv(createDraftEnvironment(env));
    };

    const handleSetActive = async (envId: string | null) => {
        dispatch({ type: "SET_ACTIVE_ENVIRONMENT", envId });
        try {
            await setConfig("activeEnvironmentId", envId ?? "");
        } catch {
            // Active environment selection should remain responsive if config persistence fails.
        }
    };

    const handleDeleteEnvironment = async (envId: string) => {
        try {
            await deleteEnvironmentApi(envId);
            dispatch({ type: "DELETE_ENVIRONMENT", envId });
        } catch (err) {
            console.error("Failed to delete environment:", err);
        }
    };

    const handleConfirmDraft = async () => {
        if (!draftEnv) {
            return;
        }

        const name = draftEnv.name.trim() || "New Environment";
        const variables = draftEnv.variables.map((variable) => ({
            ...variable,
            key: variable.key.trim(),
        }));

        try {
            if (editingEnvId) {
                const nextEnv = { ...draftEnv, id: editingEnvId, name, variables };
                await updateEnvironmentApi(nextEnv);
                dispatch({
                    type: "UPDATE_ENVIRONMENT",
                    envId: editingEnvId,
                    env: { name: nextEnv.name, variables: nextEnv.variables },
                });
            } else {
                const created = await createEnvironmentApi(name);
                const nextEnv = { ...created, name, variables };
                await updateEnvironmentApi(nextEnv);
                dispatch({ type: "ADD_ENVIRONMENT", environment: nextEnv });
            }
            setDraftEnv(null);
            setEditingEnvId(null);
        } catch (err) {
            console.error("Failed to save environment:", err);
        }
    };

    return (
        <div className="env-panel">
            <div className="panel-toolbar">
                <span className="panel-title">Environments</span>
                <button
                    className="toolbar-btn"
                    title="New Environment"
                    type="button"
                    onClick={beginCreateEnvironment}
                >
                    <Plus size={14} />
                </button>
            </div>
            <div className="env-list">
                {state.environments.map((env) => {
                    const isActive = env.id === state.activeEnvironmentId;
                    return (
                        <div className={`env-item${isActive ? " active" : ""}`} key={env.id}>
                            <button
                                className="env-name-button"
                                type="button"
                                onClick={() => handleSetActive(isActive ? null : env.id)}
                                title={isActive ? "Deactivate Environment" : "Activate Environment"}
                            >
                                <span className="env-active-dot" aria-hidden="true">
                                    {isActive ? <Check size={12} /> : null}
                                </span>
                                <span className="env-name">{env.name}</span>
                            </button>
                            <button
                                className="env-action-btn"
                                type="button"
                                title="Edit Environment"
                                onClick={() => beginEditEnvironment(env)}
                            >
                                <Pencil size={13} />
                            </button>
                            <button
                                className="env-action-btn danger"
                                type="button"
                                title="Delete Environment"
                                onClick={() => handleDeleteEnvironment(env.id)}
                            >
                                <Trash2 size={13} />
                            </button>
                        </div>
                    );
                })}
            </div>
            {draftEnv && typeof document !== "undefined" && createPortal(
                <EnvironmentEditorModal
                    mode={editingEnvId ? "edit" : "create"}
                    draft={draftEnv}
                    onDraftChange={setDraftEnv}
                    onCancel={() => {
                        setDraftEnv(null);
                        setEditingEnvId(null);
                    }}
                    onConfirm={() => {
                        void handleConfirmDraft();
                    }}
                />,
                document.body,
            )}
        </div>
    );
}
