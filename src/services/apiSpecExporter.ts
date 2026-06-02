import { isFolder, type ApiRequest, type Collection, type Environment, type KeyValuePair, type RequestAuth, type RequestBody } from "../types/api";
import { logger } from "./logger";

const POSTMAN_COLLECTION_SCHEMA = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

type PostmanAuth =
    | { type: "noauth" }
    | { type: "bearer"; bearer: Array<{ key: "token"; value: string; type: "string" }> }
    | { type: "basic"; basic: Array<{ key: "username" | "password"; value: string; type: "string" }> }
    | { type: "apikey"; apikey: Array<{ key: "key" | "value" | "in"; value: string; type: "string" }> };

interface PostmanCollectionExport {
    info: {
        name: string;
        schema: string;
        description: string;
    };
    item: PostmanItem[];
}

type PostmanItem = PostmanFolderItem | PostmanRequestItem;

interface PostmanFolderItem {
    name: string;
    item: PostmanItem[];
}

interface PostmanRequestItem {
    name: string;
    request: {
        method: string;
        header: PostmanKeyValue[];
        url: {
            raw: string;
            query?: PostmanKeyValue[];
        };
        auth: PostmanAuth;
        body?: PostmanBody;
    };
    event?: PostmanEvent[];
}

interface PostmanKeyValue {
    key: string;
    value: string;
    disabled?: boolean;
    type?: string;
}

type PostmanBody =
    | { mode: "raw"; raw: string; options?: { raw: { language: string } } }
    | { mode: "urlencoded"; urlencoded: PostmanKeyValue[] };

interface PostmanEvent {
    listen: "prerequest" | "test";
    script: {
        type: "text/javascript";
        exec: string[];
    };
}

interface PostmanEnvironmentExport {
    id: string;
    name: string;
    values: Array<{
        key: string;
        value: string;
        enabled: boolean;
        type: "default";
    }>;
    _postman_variable_scope: "environment";
    _postman_exported_at: string;
    _postman_exported_using: "far-api";
}

export interface ExportArtifact {
    fileName: string;
    json: string;
}

export function exportCollectionAsPostman(collection: Collection): ExportArtifact {
    const document: PostmanCollectionExport = {
        info: {
            name: collection.name,
            schema: POSTMAN_COLLECTION_SCHEMA,
            description: `Exported from far-api collection ${collection.id}`,
        },
        item: collection.items.map(toPostmanItem),
    };

    const artifact = {
        fileName: `${safeFileName(collection.name || "collection")}.postman_collection.json`,
        json: stringifyExport(document),
    };
    logger.info("apiSpecExporter", "collection export prepared", {
        collectionId: collection.id,
        name: collection.name,
        itemCount: document.item.length,
        fileName: artifact.fileName,
    });
    return artifact;
}

export function exportEnvironmentAsPostman(environment: Environment): ExportArtifact {
    const document: PostmanEnvironmentExport = {
        id: environment.id,
        name: environment.name,
        values: environment.variables
            .filter((variable) => variable.key.trim())
            .map((variable) => ({
                key: variable.key.trim(),
                value: variable.value,
                enabled: variable.enabled,
                type: "default",
            })),
        _postman_variable_scope: "environment",
        _postman_exported_at: new Date().toISOString(),
        _postman_exported_using: "far-api",
    };

    const artifact = {
        fileName: `${safeFileName(environment.name || "environment")}.postman_environment.json`,
        json: stringifyExport(document),
    };
    logger.info("apiSpecExporter", "environment export prepared", {
        environmentId: environment.id,
        name: environment.name,
        valueCount: document.values.length,
        fileName: artifact.fileName,
    });
    return artifact;
}

function toPostmanItem(item: Collection["items"][number]): PostmanItem {
    if (isFolder(item)) {
        return {
            name: item.name,
            item: item.children.map(toPostmanItem),
        };
    }

    return requestToPostmanItem(item);
}

function requestToPostmanItem(request: ApiRequest): PostmanRequestItem {
    const query = enabledPairs(request.params);
    const body = bodyToPostman(request.body);
    const item: PostmanRequestItem = {
        name: request.name,
        request: {
            method: request.method,
            header: enabledPairs(request.headers).map(toPostmanPair),
            url: {
                raw: withQueryString(request.url, query),
                ...(query.length > 0 ? { query: query.map(toPostmanPair) } : {}),
            },
            auth: authToPostman(request.auth),
            ...(body ? { body } : {}),
        },
    };

    const events = scriptsToPostmanEvents(request);
    if (events.length > 0) {
        item.event = events;
    }

    return item;
}

function enabledPairs(pairs: KeyValuePair[]): KeyValuePair[] {
    return pairs.filter((pair) => pair.enabled && pair.key.trim());
}

function toPostmanPair(pair: KeyValuePair): PostmanKeyValue {
    return {
        key: pair.key.trim(),
        value: pair.value,
    };
}

function authToPostman(auth: RequestAuth): PostmanAuth {
    if (auth.type === "bearer") {
        return {
            type: "bearer",
            bearer: [{ key: "token", value: auth.bearerToken, type: "string" }],
        };
    }

    if (auth.type === "basic") {
        return {
            type: "basic",
            basic: [
                { key: "username", value: auth.basicUsername, type: "string" },
                { key: "password", value: auth.basicPassword, type: "string" },
            ],
        };
    }

    if (auth.type === "apiKey") {
        return {
            type: "apikey",
            apikey: [
                { key: "key", value: auth.apiKeyName, type: "string" },
                { key: "value", value: auth.apiKeyValue, type: "string" },
                { key: "in", value: auth.apiKeyPlacement === "query" ? "query" : "header", type: "string" },
            ],
        };
    }

    return { type: "noauth" };
}

function bodyToPostman(body: RequestBody): PostmanBody | null {
    if (body.type === "json") {
        return {
            mode: "raw",
            raw: body.json || "{}",
            options: { raw: { language: "json" } },
        };
    }

    if (body.type === "raw") {
        return {
            mode: "raw",
            raw: body.raw,
            options: { raw: { language: "text" } },
        };
    }

    if (body.type === "form") {
        return {
            mode: "urlencoded",
            urlencoded: enabledPairs(body.form).map((pair) => ({
                ...toPostmanPair(pair),
                type: "text",
            })),
        };
    }

    return null;
}

function scriptsToPostmanEvents(request: ApiRequest): PostmanEvent[] {
    const events: PostmanEvent[] = [];
    if (request.scripts.preRequest.trim()) {
        events.push({
            listen: "prerequest",
            script: {
                type: "text/javascript",
                exec: splitScriptLines(request.scripts.preRequest),
            },
        });
    }
    if (request.scripts.postResponse.trim()) {
        events.push({
            listen: "test",
            script: {
                type: "text/javascript",
                exec: splitScriptLines(request.scripts.postResponse),
            },
        });
    }

    return events;
}

function splitScriptLines(script: string): string[] {
    return script.replace(/\r\n/g, "\n").split("\n");
}

function withQueryString(url: string, params: KeyValuePair[]): string {
    if (params.length === 0) {
        return url;
    }

    const query = params.map((pair) =>
        `${encodeURIComponent(pair.key.trim())}=${encodeURIComponent(pair.value)}`,
    ).join("&");
    const joiner = url.includes("?") ? "&" : "?";
    return `${url}${joiner}${query}`;
}

function stringifyExport(document: unknown): string {
    return `${JSON.stringify(document, null, 2)}\n`;
}

function safeFileName(value: string): string {
    const fileName = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "");

    return fileName || "far-api-export";
}
