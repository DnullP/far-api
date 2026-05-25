export const FAR_API_COMMANDS = {
    httpRequest: "http_request",
    frontendLog: "frontend_log",

    listCollections: "list_collections",
    createCollection: "create_collection",
    deleteCollection: "delete_collection",
    renameCollection: "rename_collection",
    reorderCollections: "reorder_collections",
    createRequest: "create_request",
    updateRequest: "update_request",
    deleteRequest: "delete_request",
    moveRequest: "move_request",

    listEnvironments: "list_environments",
    createEnvironment: "create_environment",
    updateEnvironment: "update_environment",
    deleteEnvironment: "delete_environment",

    getConfig: "get_config",
    setConfig: "set_config",
    getAllConfig: "get_all_config",

    addHistory: "add_history",
    listHistory: "list_history",
    clearHistory: "clear_history",
    deleteHistoryEntry: "delete_history_entry",
} as const;

export type FarApiCommandId = (typeof FAR_API_COMMANDS)[keyof typeof FAR_API_COMMANDS];
