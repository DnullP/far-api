import { useCallback, useRef } from "react";
import { useAppState, useAppDispatch } from "../store/appStore";
import { createKeyValuePair } from "../types/api";
import {
    createEnvironmentApi,
    updateEnvironmentApi,
    deleteEnvironmentApi,
    setConfig,
} from "../services/persistence";
import { Plus, Trash2, Check } from "lucide-react";
import "./EnvironmentPanel.css";

export function EnvironmentPanel() {
    const state = useAppState();
    const dispatch = useAppDispatch();
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleAddEnvironment = async () => {
        try {
            const env = await createEnvironmentApi("New Environment");
            dispatch({ type: "ADD_ENVIRONMENT", environment: env });
        } catch (err) {
            console.error("Failed to create environment:", err);
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

    const handleSetActive = async (envId: string | null) => {
        dispatch({ type: "SET_ACTIVE_ENVIRONMENT", envId });
        try {
            await setConfig("activeEnvironmentId", envId ?? "");
        } catch { /* ignore */ }
    };

    /** Debounced save to backend when env variables change */
    const debouncedSaveEnv = useCallback(
        (envId: string, name: string, variables: typeof state.environments[0]["variables"]) => {
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
            }
            saveTimerRef.current = setTimeout(() => {
                updateEnvironmentApi({ id: envId, name, variables }).catch((err) =>
                    console.error("Failed to save environment:", err),
                );
            }, 500);
        },
        [],
    );

    return (
        <div className="env-panel">
            <div className="panel-toolbar">
                <span className="panel-title">Environments</span>
                <button
                    className="toolbar-btn"
                    title="New Environment"
                    onClick={handleAddEnvironment}
                >
                    <Plus size={14} />
                </button>
            </div>
            <div className="env-list">
                {state.environments.map((env) => {
                    const isActive = env.id === state.activeEnvironmentId;
                    return (
                        <div className={`env-item ${isActive ? "active" : ""}`} key={env.id}>
                            <div className="env-header">
                                <button
                                    className={`env-activate ${isActive ? "active" : ""}`}
                                    onClick={() => handleSetActive(isActive ? null : env.id)}
                                    title={isActive ? "Deactivate" : "Activate"}
                                >
                                    <Check size={12} />
                                </button>
                                <span className="env-name">{env.name}</span>
                                <button
                                    className="toolbar-btn small"
                                    title="Delete Environment"
                                    onClick={() => handleDeleteEnvironment(env.id)}
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                            <div className="env-vars">
                                {env.variables.map((v) => (
                                    <div className="env-var-row" key={v.id}>
                                        <input
                                            type="checkbox"
                                            checked={v.enabled}
                                            onChange={(e) => {
                                                const vars = env.variables.map((vv) =>
                                                    vv.id === v.id
                                                        ? { ...vv, enabled: e.target.checked }
                                                        : vv,
                                                );
                                                dispatch({
                                                    type: "UPDATE_ENVIRONMENT",
                                                    envId: env.id,
                                                    env: { variables: vars },
                                                });
                                                debouncedSaveEnv(env.id, env.name, vars);
                                            }}
                                        />
                                        <input
                                            className="var-key"
                                            value={v.key}
                                            placeholder="Variable"
                                            onChange={(e) => {
                                                const vars = env.variables.map((vv) =>
                                                    vv.id === v.id
                                                        ? { ...vv, key: e.target.value }
                                                        : vv,
                                                );
                                                dispatch({
                                                    type: "UPDATE_ENVIRONMENT",
                                                    envId: env.id,
                                                    env: { variables: vars },
                                                });
                                                debouncedSaveEnv(env.id, env.name, vars);
                                            }}
                                        />
                                        <input
                                            className="var-value"
                                            value={v.value}
                                            placeholder="Value"
                                            onChange={(e) => {
                                                const vars = env.variables.map((vv) =>
                                                    vv.id === v.id
                                                        ? { ...vv, value: e.target.value }
                                                        : vv,
                                                );
                                                dispatch({
                                                    type: "UPDATE_ENVIRONMENT",
                                                    envId: env.id,
                                                    env: { variables: vars },
                                                });
                                                debouncedSaveEnv(env.id, env.name, vars);
                                            }}
                                        />
                                    </div>
                                ))}
                                <button
                                    className="add-var-btn"
                                    onClick={() => {
                                        const kv = createKeyValuePair();
                                        const vars = [
                                            ...env.variables,
                                            { id: kv.id, key: kv.key, value: kv.value, enabled: kv.enabled },
                                        ];
                                        dispatch({
                                            type: "UPDATE_ENVIRONMENT",
                                            envId: env.id,
                                            env: { variables: vars },
                                        });
                                        debouncedSaveEnv(env.id, env.name, vars);
                                    }}
                                >
                                    + Add Variable
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
