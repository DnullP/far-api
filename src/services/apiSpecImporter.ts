import {
    createKeyValuePair,
    createRequestAuth,
    type HttpMethod,
    type KeyValuePair,
    type RequestAuth,
    type RequestBody,
} from "../types/api";

const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const OPENAPI_METHOD_KEYS = new Set(HTTP_METHODS.map((method) => method.toLowerCase()));
const JSON_CONTENT_TYPES = ["application/json", "application/*+json"];
const FORM_CONTENT_TYPES = ["application/x-www-form-urlencoded", "multipart/form-data"];

export type ApiSpecFormat = "openapi" | "swagger" | "postman";

export interface ImportedRequestDraft {
    name: string;
    method: HttpMethod;
    url: string;
    params: KeyValuePair[];
    headers: KeyValuePair[];
    body: RequestBody;
    auth: RequestAuth;
}

export interface ImportedCollectionDraft {
    name: string;
    requests: ImportedRequestDraft[];
}

export interface ParsedApiSpecImport {
    format: ApiSpecFormat;
    collection: ImportedCollectionDraft;
}

export function parseApiSpecImportJson(input: string): ParsedApiSpecImport {
    let document: unknown;
    try {
        document = JSON.parse(input);
    } catch {
        throw new Error("Import content must be valid JSON.");
    }

    if (!isRecord(document)) {
        throw new Error("Import content must be a JSON object.");
    }

    if (typeof document.openapi === "string") {
        return {
            format: "openapi",
            collection: parseOpenApi3(document),
        };
    }

    if (document.swagger === "2.0") {
        return {
            format: "swagger",
            collection: parseSwagger2(document),
        };
    }

    if (isRecord(document.info) && Array.isArray(document.item)) {
        return {
            format: "postman",
            collection: parsePostmanCollection(document),
        };
    }

    throw new Error("Unsupported import format. Use OpenAPI 3.x, Swagger 2.0, or Postman Collection JSON.");
}

function parseOpenApi3(document: Record<string, unknown>): ImportedCollectionDraft {
    const name = readInfoTitle(document, "Imported OpenAPI");
    const baseUrl = resolveOpenApiServerUrl(firstRecordArrayItem(document.servers));
    const paths = asRecord(document.paths) ?? {};
    const requests: ImportedRequestDraft[] = [];

    for (const [path, pathItemUnknown] of Object.entries(paths)) {
        const pathItem = asRecord(pathItemUnknown);
        if (!pathItem) {
            continue;
        }
        const pathParameters = asArray(pathItem.parameters);

        for (const [methodKey, operationUnknown] of Object.entries(pathItem)) {
            if (!OPENAPI_METHOD_KEYS.has(methodKey)) {
                continue;
            }

            const operation = asRecord(operationUnknown);
            if (!operation) {
                continue;
            }
            const method = methodKey.toUpperCase() as HttpMethod;
            const parameters = [...pathParameters, ...asArray(operation.parameters)];
            const queryParams = parametersToPairs(parameters, "query");
            const headerParams = parametersToPairs(parameters, "header");
            const body = openApiRequestBody(operation.requestBody, document);
            const headers = withContentType(headerParams, body.contentType);

            requests.push({
                name: readString(operation.summary) || readString(operation.operationId) || `${method} ${path}`,
                method,
                url: joinUrl(baseUrl, path),
                params: withEmptyPairFallback(queryParams),
                headers: withEmptyPairFallback(headers),
                body: body.body,
                auth: createRequestAuth(),
            });
        }
    }

    return collectionWithRequests(name, requests);
}

function parseSwagger2(document: Record<string, unknown>): ImportedCollectionDraft {
    const name = readInfoTitle(document, "Imported Swagger");
    const baseUrl = swaggerBaseUrl(document);
    const globalConsumes = stringArray(document.consumes);
    const paths = asRecord(document.paths) ?? {};
    const requests: ImportedRequestDraft[] = [];

    for (const [path, pathItemUnknown] of Object.entries(paths)) {
        const pathItem = asRecord(pathItemUnknown);
        if (!pathItem) {
            continue;
        }
        const pathParameters = asArray(pathItem.parameters);

        for (const [methodKey, operationUnknown] of Object.entries(pathItem)) {
            if (!OPENAPI_METHOD_KEYS.has(methodKey)) {
                continue;
            }

            const operation = asRecord(operationUnknown);
            if (!operation) {
                continue;
            }
            const method = methodKey.toUpperCase() as HttpMethod;
            const parameters = [...pathParameters, ...asArray(operation.parameters)];
            const queryParams = parametersToPairs(parameters, "query");
            const headerParams = parametersToPairs(parameters, "header");
            const consumes = stringArray(operation.consumes);
            const body = swaggerRequestBody(parameters, consumes.length > 0 ? consumes : globalConsumes, document);
            const headers = withContentType(headerParams, body.contentType);

            requests.push({
                name: readString(operation.summary) || readString(operation.operationId) || `${method} ${path}`,
                method,
                url: joinUrl(baseUrl, path),
                params: withEmptyPairFallback(queryParams),
                headers: withEmptyPairFallback(headers),
                body: body.body,
                auth: createRequestAuth(),
            });
        }
    }

    return collectionWithRequests(name, requests);
}

function parsePostmanCollection(document: Record<string, unknown>): ImportedCollectionDraft {
    const name = readInfoTitle(document, "Imported Postman Collection");
    const requests: ImportedRequestDraft[] = [];
    collectPostmanItems(asArray(document.item), requests, postmanAuth(document.auth));
    return collectionWithRequests(name, requests);
}

function collectPostmanItems(
    items: unknown[],
    requests: ImportedRequestDraft[],
    inheritedAuth: RequestAuth,
): void {
    for (const itemUnknown of items) {
        const item = asRecord(itemUnknown);
        if (!item) {
            continue;
        }
        const itemAuth = "auth" in item ? postmanAuth(item.auth) : inheritedAuth;
        if (Array.isArray(item.item)) {
            collectPostmanItems(item.item, requests, itemAuth);
            continue;
        }

        const request = asRecord(item.request);
        if (!request) {
            continue;
        }

        const method = normalizeMethod(readString(request.method) || "GET");
        const { url, params } = postmanUrl(request.url);
        const headers = postmanHeaders(request.header);
        const body = postmanBody(request.body, headers);
        const auth = "auth" in request ? postmanAuth(request.auth) : itemAuth;

        requests.push({
            name: readString(item.name) || `${method} ${url}`,
            method,
            url,
            params: withEmptyPairFallback(params),
            headers: withEmptyPairFallback(headers),
            body,
            auth,
        });
    }
}

function collectionWithRequests(name: string, requests: ImportedRequestDraft[]): ImportedCollectionDraft {
    if (requests.length === 0) {
        throw new Error("Import document does not contain any requests.");
    }

    return { name, requests };
}

function openApiRequestBody(
    requestBodyUnknown: unknown,
    root: Record<string, unknown>,
): { body: RequestBody; contentType?: string } {
    const requestBody = resolveReference(asRecord(requestBodyUnknown), root);
    const content = asRecord(requestBody?.content);
    if (!content) {
        return { body: emptyBody() };
    }

    const contentType = chooseContentType(Object.keys(content));
    if (!contentType) {
        return { body: emptyBody() };
    }

    return {
        body: bodyFromMedia(contentType, content[contentType], root),
        contentType,
    };
}

function swaggerRequestBody(
    parameters: unknown[],
    consumes: string[],
    root: Record<string, unknown>,
): { body: RequestBody; contentType?: string } {
    const formParams = parameters
        .map((parameter) => resolveReference(asRecord(parameter), root))
        .filter((parameter): parameter is Record<string, unknown> => parameter?.in === "formData");
    if (formParams.length > 0) {
        return {
            body: {
                type: "form",
                json: "{}",
                form: formParams.map((parameter) => createKeyValuePair(
                    readString(parameter.name),
                    sampleScalar(parameter.example ?? parameter.default ?? asRecord(parameter.schema)?.default),
                )),
                raw: "",
            },
            contentType: "application/x-www-form-urlencoded",
        };
    }

    const bodyParam = parameters
        .map((parameter) => resolveReference(asRecord(parameter), root))
        .find((parameter) => parameter?.in === "body");
    if (!bodyParam) {
        return { body: emptyBody() };
    }

    const contentType = chooseContentType(consumes) ?? "application/json";
    return {
        body: bodyFromSchema(contentType, bodyParam.schema, root),
        contentType,
    };
}

function bodyFromMedia(contentType: string, mediaUnknown: unknown, root: Record<string, unknown>): RequestBody {
    const media = asRecord(mediaUnknown);
    const explicitExample = mediaExample(media);
    if (explicitExample !== undefined) {
        return bodyFromSample(contentType, explicitExample);
    }

    return bodyFromSchema(contentType, media?.schema, root);
}

function bodyFromSchema(contentType: string, schemaUnknown: unknown, root: Record<string, unknown>): RequestBody {
    if (isFormContentType(contentType)) {
        const schema = resolveReference(asRecord(schemaUnknown), root);
        const properties = asRecord(schema?.properties);
        return {
            type: "form",
            json: "{}",
            form: properties
                ? Object.entries(properties).map(([key, value]) =>
                    createKeyValuePair(key, sampleScalar(sampleFromSchema(value, root))),
                )
                : [createKeyValuePair()],
            raw: "",
        };
    }

    const sample = sampleFromSchema(schemaUnknown, root);
    return bodyFromSample(contentType, sample);
}

function bodyFromSample(contentType: string, sample: unknown): RequestBody {
    if (isJsonContentType(contentType)) {
        return {
            type: "json",
            json: JSON.stringify(sample ?? {}, null, 2),
            form: [createKeyValuePair()],
            raw: "",
        };
    }

    if (isFormContentType(contentType) && isRecord(sample)) {
        return {
            type: "form",
            json: "{}",
            form: Object.entries(sample).map(([key, value]) =>
                createKeyValuePair(key, sampleScalar(value)),
            ),
            raw: "",
        };
    }

    return {
        type: "raw",
        json: "{}",
        form: [createKeyValuePair()],
        raw: typeof sample === "string" ? sample : JSON.stringify(sample ?? ""),
    };
}

function sampleFromSchema(schemaUnknown: unknown, root: Record<string, unknown>, depth = 0): unknown {
    if (depth > 4) {
        return {};
    }

    const schema = resolveReference(asRecord(schemaUnknown), root);
    if (!schema) {
        return {};
    }

    if ("example" in schema) return schema.example;
    if ("default" in schema) return schema.default;
    const enumValues = asArray(schema.enum);
    if (enumValues.length > 0) return enumValues[0];

    const type = readString(schema.type) || (asRecord(schema.properties) ? "object" : undefined);
    if (type === "object") {
        const properties = asRecord(schema.properties);
        if (!properties) return {};
        return Object.fromEntries(
            Object.entries(properties).map(([key, value]) => [
                key,
                sampleFromSchema(value, root, depth + 1),
            ]),
        );
    }

    if (type === "array") {
        return [sampleFromSchema(schema.items, root, depth + 1)];
    }

    if (type === "integer" || type === "number") {
        return 0;
    }

    if (type === "boolean") {
        return true;
    }

    return "string";
}

function parametersToPairs(parameters: unknown[], target: "query" | "header"): KeyValuePair[] {
    return parameters
        .map((parameter) => asRecord(parameter))
        .filter((parameter): parameter is Record<string, unknown> => parameter?.in === target)
        .map((parameter) => createKeyValuePair(
            readString(parameter.name),
            sampleScalar(parameter.example ?? parameter.default ?? asRecord(parameter.schema)?.default),
        ))
        .filter((pair) => pair.key);
}

function postmanUrl(urlUnknown: unknown): { url: string; params: KeyValuePair[] } {
    if (typeof urlUnknown === "string") {
        return splitUrlParams(urlUnknown);
    }

    const url = asRecord(urlUnknown);
    if (!url) {
        return { url: "", params: [createKeyValuePair()] };
    }

    const raw = readString(url.raw);
    if (raw) {
        const split = splitUrlParams(raw);
        const objectQuery = postmanQuery(url.query);
        return {
            url: split.url,
            params: objectQuery.length > 0 ? objectQuery : split.params,
        };
    }

    const protocol = readString(url.protocol) || "https";
    const host = stringOrArray(url.host).join(".");
    const path = stringOrArray(url.path).join("/");
    return {
        url: `${protocol}://${host}${path ? `/${path}` : ""}`,
        params: withEmptyPairFallback(postmanQuery(url.query)),
    };
}

function postmanHeaders(headersUnknown: unknown): KeyValuePair[] {
    return asArray(headersUnknown)
        .map((header) => asRecord(header))
        .filter(isEnabledRecord)
        .map((header) => createKeyValuePair(readString(header.key), readString(header.value)))
        .filter((pair) => pair.key);
}

function postmanQuery(queryUnknown: unknown): KeyValuePair[] {
    return asArray(queryUnknown)
        .map((query) => asRecord(query))
        .filter(isEnabledRecord)
        .map((query) => createKeyValuePair(readString(query.key), readString(query.value)))
        .filter((pair) => pair.key);
}

function postmanBody(bodyUnknown: unknown, headers: KeyValuePair[]): RequestBody {
    const body = asRecord(bodyUnknown);
    if (!body) {
        return emptyBody();
    }

    const mode = readString(body.mode);
    if (mode === "raw") {
        const raw = readString(body.raw);
        const rawLanguage = readString(asRecord(asRecord(body.options)?.raw)?.language);
        const contentType = headers.find((header) => header.key.toLowerCase() === "content-type")?.value ?? "";
        if (rawLanguage === "json" || isJsonContentType(contentType) || looksLikeJson(raw)) {
            return {
                type: "json",
                json: raw || "{}",
                form: [createKeyValuePair()],
                raw: "",
            };
        }

        return {
            type: "raw",
            json: "{}",
            form: [createKeyValuePair()],
            raw,
        };
    }

    if (mode === "urlencoded" || mode === "formdata") {
        const rows = asArray(body[mode])
            .map((row) => asRecord(row))
            .filter(isEnabledRecord)
            .map((row) => createKeyValuePair(readString(row.key), readString(row.value ?? row.src)))
            .filter((pair) => pair.key);
        return {
            type: "form",
            json: "{}",
            form: withEmptyPairFallback(rows),
            raw: "",
        };
    }

    return emptyBody();
}

function postmanAuth(authUnknown: unknown): RequestAuth {
    const auth = asRecord(authUnknown);
    const type = readString(auth?.type);
    if (type === "bearer") {
        return createRequestAuth({
            type: "bearer",
            bearerToken: postmanAuthValue(auth?.bearer, "token"),
        });
    }

    if (type === "basic") {
        return createRequestAuth({
            type: "basic",
            basicUsername: postmanAuthValue(auth?.basic, "username"),
            basicPassword: postmanAuthValue(auth?.basic, "password"),
        });
    }

    if (type === "apikey" || type === "apiKey") {
        return createRequestAuth({
            type: "apiKey",
            apiKeyName: postmanAuthValue(auth?.apikey, "key"),
            apiKeyValue: postmanAuthValue(auth?.apikey, "value"),
            apiKeyPlacement: postmanAuthValue(auth?.apikey, "in") === "query" ? "query" : "header",
        });
    }

    return createRequestAuth();
}

function postmanAuthValue(valueUnknown: unknown, key: string): string {
    const item = asArray(valueUnknown)
        .map((entry) => asRecord(entry))
        .find((entry) => readString(entry?.key) === key);
    return readString(item?.value);
}

function splitUrlParams(rawUrl: string): { url: string; params: KeyValuePair[] } {
    try {
        const parsed = new URL(rawUrl);
        const params = Array.from(parsed.searchParams.entries()).map(([key, value]) =>
            createKeyValuePair(key, value),
        );
        parsed.search = "";
        return { url: parsed.toString(), params };
    } catch {
        const [url, query = ""] = rawUrl.split("?");
        return {
            url,
            params: Array.from(new URLSearchParams(query).entries()).map(([key, value]) =>
                createKeyValuePair(key, value),
            ),
        };
    }
}

function swaggerBaseUrl(document: Record<string, unknown>): string {
    const scheme = stringArray(document.schemes).find((item) => item === "https") ??
        stringArray(document.schemes)[0] ??
        "https";
    const host = readString(document.host);
    const basePath = readString(document.basePath);
    return host ? `${scheme}://${host}${basePath}` : basePath;
}

function resolveOpenApiServerUrl(server: Record<string, unknown> | null): string {
    if (!server) {
        return "";
    }

    let url = readString(server.url);
    const variables = asRecord(server.variables);
    if (variables) {
        for (const [key, value] of Object.entries(variables)) {
            url = url.replace(`{${key}}`, readString(asRecord(value)?.default));
        }
    }
    return url;
}

function joinUrl(baseUrl: string, path: string): string {
    if (!baseUrl) {
        return path;
    }
    return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function withContentType(headers: KeyValuePair[], contentType?: string): KeyValuePair[] {
    if (!contentType || headers.some((header) => header.key.toLowerCase() === "content-type")) {
        return headers;
    }

    return [...headers, createKeyValuePair("Content-Type", contentType)];
}

function chooseContentType(contentTypes: string[]): string | undefined {
    return [
        ...JSON_CONTENT_TYPES,
        ...FORM_CONTENT_TYPES,
        "text/plain",
    ].find((candidate) => contentTypes.includes(candidate)) ?? contentTypes[0];
}

function mediaExample(media: Record<string, unknown> | null): unknown {
    if (!media) {
        return undefined;
    }
    if ("example" in media) {
        return media.example;
    }
    const examples = asRecord(media.examples);
    const firstExample = examples ? asRecord(Object.values(examples)[0]) : null;
    return firstExample && "value" in firstExample ? firstExample.value : undefined;
}

function resolveReference(
    value: Record<string, unknown> | null,
    root: Record<string, unknown>,
): Record<string, unknown> | null {
    const ref = readString(value?.$ref);
    if (!ref.startsWith("#/")) {
        return value;
    }

    const resolved = ref.slice(2).split("/").reduce<unknown>((current, part) => {
        if (!isRecord(current)) {
            return null;
        }
        return current[part.replace(/~1/g, "/").replace(/~0/g, "~")];
    }, root);
    return asRecord(resolved) ?? value;
}

function firstRecordArrayItem(value: unknown): Record<string, unknown> | null {
    return asRecord(asArray(value)[0]);
}

function readInfoTitle(document: Record<string, unknown>, fallback: string): string {
    return readString(asRecord(document.info)?.name) || readString(asRecord(document.info)?.title) || fallback;
}

function readString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function normalizeMethod(value: string): HttpMethod {
    const method = value.toUpperCase();
    return HTTP_METHODS.includes(method as HttpMethod) ? method as HttpMethod : "GET";
}

function sampleScalar(value: unknown): string {
    if (value === undefined || value === null) {
        return "";
    }
    return typeof value === "string" ? value : String(value);
}

function withEmptyPairFallback(pairs: KeyValuePair[]): KeyValuePair[] {
    return pairs.length > 0 ? pairs : [createKeyValuePair()];
}

function emptyBody(): RequestBody {
    return {
        type: "none",
        json: "{}",
        form: [createKeyValuePair()],
        raw: "",
    };
}

function isJsonContentType(contentType: string): boolean {
    return contentType.toLowerCase().includes("json");
}

function isFormContentType(contentType: string): boolean {
    const normalized = contentType.toLowerCase();
    return FORM_CONTENT_TYPES.some((item) => normalized.includes(item));
}

function looksLikeJson(value: string): boolean {
    const trimmed = value.trim();
    return (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"));
}

function stringArray(value: unknown): string[] {
    return asArray(value).filter((item): item is string => typeof item === "string");
}

function stringOrArray(value: unknown): string[] {
    if (typeof value === "string") {
        return [value];
    }
    return stringArray(value);
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return isRecord(value) ? value : null;
}

function isEnabledRecord(value: Record<string, unknown> | null): value is Record<string, unknown> {
    return value !== null && value.disabled !== true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
