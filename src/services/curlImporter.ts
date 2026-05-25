import { createKeyValuePair, createRequestAuth, type ApiRequest, type HttpMethod } from "../types/api";

const BODY_FLAGS = new Set(["-d", "--data", "--data-raw", "--data-binary", "--data-ascii", "--data-urlencode"]);
const HEADER_FLAGS = new Set(["-H", "--header"]);
const METHOD_FLAGS = new Set(["-X", "--request"]);
const URL_FLAGS = new Set(["--url"]);
const IGNORED_VALUE_FLAGS = new Set([
    "-A",
    "--user-agent",
    "-b",
    "--cookie",
    "--connect-timeout",
    "--max-time",
    "--request-target",
]);
const IGNORED_BOOLEAN_FLAGS = new Set([
    "-i",
    "--include",
    "-k",
    "--insecure",
    "-L",
    "--location",
    "-s",
    "--silent",
    "-v",
    "--verbose",
    "--compressed",
]);
const HTTP_METHODS = new Set<HttpMethod>(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]);

export interface ParsedCurlRequest {
    method: HttpMethod;
    url: string;
    headers: ApiRequest["headers"];
    params: ApiRequest["params"];
    body: ApiRequest["body"];
    auth: ApiRequest["auth"];
}

export function parseCurlCommand(input: string): ParsedCurlRequest {
    const tokens = tokenizeShell(input);
    if (tokens.length === 0) {
        throw new Error("Paste a cURL command to import.");
    }

    const curlIndex = tokens.findIndex((token) => token === "curl");
    if (curlIndex < 0) {
        throw new Error("Command must start with curl.");
    }

    let method: HttpMethod | null = null;
    let url = "";
    const headerValues: string[] = [];
    const bodyValues: string[] = [];

    for (let index = curlIndex + 1; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (!token) {
            continue;
        }

        const split = splitLongFlagAssignment(token);
        const flag = split?.flag ?? token;
        const inlineValue = split?.value;

        if (METHOD_FLAGS.has(flag)) {
            const value = inlineValue ?? takeNextValue(tokens, index += 1, flag);
            method = normalizeMethod(value);
            continue;
        }

        if (HEADER_FLAGS.has(flag)) {
            const value = inlineValue ?? takeNextValue(tokens, index += 1, flag);
            headerValues.push(value);
            continue;
        }

        if (BODY_FLAGS.has(flag)) {
            const value = inlineValue ?? takeNextValue(tokens, index += 1, flag);
            bodyValues.push(value);
            continue;
        }

        if (URL_FLAGS.has(flag)) {
            const value = inlineValue ?? takeNextValue(tokens, index += 1, flag);
            url = value;
            continue;
        }

        if (flag === "-u" || flag === "--user") {
            const value = inlineValue ?? takeNextValue(tokens, index += 1, flag);
            headerValues.push(`Authorization: Basic ${encodeBasicCredential(value)}`);
            continue;
        }

        if (IGNORED_VALUE_FLAGS.has(flag)) {
            if (inlineValue === undefined) {
                index += 1;
            }
            continue;
        }

        if (IGNORED_BOOLEAN_FLAGS.has(flag) || flag.startsWith("-")) {
            continue;
        }

        if (!url) {
            url = token;
        }
    }

    if (!url) {
        throw new Error("cURL command does not include a URL.");
    }

    const { baseUrl, params } = splitUrlParams(url);
    const headers = parseHeaders(headerValues);
    const body = inferBody(bodyValues, headers);
    const resolvedMethod = method ?? (bodyValues.length > 0 ? "POST" : "GET");

    return {
        method: resolvedMethod,
        url: baseUrl,
        headers: headers.length > 0 ? headers : [createKeyValuePair()],
        params: params.length > 0 ? params : [createKeyValuePair()],
        body,
        auth: createRequestAuth(),
    };
}

function splitLongFlagAssignment(token: string): { flag: string; value: string } | null {
    if (!token.startsWith("--")) {
        return null;
    }

    const equalsIndex = token.indexOf("=");
    if (equalsIndex < 0) {
        return null;
    }

    return {
        flag: token.slice(0, equalsIndex),
        value: token.slice(equalsIndex + 1),
    };
}

function takeNextValue(tokens: string[], index: number, flag: string): string {
    const value = tokens[index];
    if (value === undefined) {
        throw new Error(`Missing value after ${flag}.`);
    }
    return value;
}

function normalizeMethod(value: string): HttpMethod {
    const method = value.trim().toUpperCase();
    if (!HTTP_METHODS.has(method as HttpMethod)) {
        throw new Error(`Unsupported HTTP method: ${value}.`);
    }
    return method as HttpMethod;
}

function splitUrlParams(rawUrl: string): { baseUrl: string; params: ApiRequest["params"] } {
    try {
        const parsed = new URL(rawUrl);
        const params = Array.from(parsed.searchParams.entries()).map(([key, value]) =>
            createKeyValuePair(key, value),
        );
        parsed.search = "";
        return { baseUrl: parsed.toString(), params };
    } catch {
        const [baseUrl, query = ""] = rawUrl.split("?");
        return {
            baseUrl,
            params: Array.from(new URLSearchParams(query).entries()).map(([key, value]) =>
                createKeyValuePair(key, value),
            ),
        };
    }
}

function parseHeaders(values: string[]): ApiRequest["headers"] {
    return values
        .map((header) => {
            const separatorIndex = header.indexOf(":");
            if (separatorIndex <= 0) {
                return null;
            }

            return createKeyValuePair(
                header.slice(0, separatorIndex).trim(),
                header.slice(separatorIndex + 1).trim(),
            );
        })
        .filter((header): header is ApiRequest["headers"][number] => Boolean(header));
}

function inferBody(bodyValues: string[], headers: ApiRequest["headers"]): ApiRequest["body"] {
    if (bodyValues.length === 0) {
        return {
            type: "none",
            json: "{}",
            form: [createKeyValuePair()],
            raw: "",
        };
    }

    const body = bodyValues.join("&");
    const contentType = headers
        .find((header) => header.key.toLowerCase() === "content-type")
        ?.value.toLowerCase() ?? "";

    if (contentType.includes("application/json") || looksLikeJson(body)) {
        return {
            type: "json",
            json: body,
            form: [createKeyValuePair()],
            raw: "",
        };
    }

    if (contentType.includes("application/x-www-form-urlencoded") || looksLikeFormBody(body)) {
        return {
            type: "form",
            json: "{}",
            form: Array.from(new URLSearchParams(body).entries()).map(([key, value]) =>
                createKeyValuePair(key, value),
            ),
            raw: "",
        };
    }

    return {
        type: "raw",
        json: "{}",
        form: [createKeyValuePair()],
        raw: body,
    };
}

function looksLikeJson(value: string): boolean {
    const trimmed = value.trim();
    return (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"));
}

function looksLikeFormBody(value: string): boolean {
    if (!value.includes("=")) {
        return false;
    }

    const params = new URLSearchParams(value);
    return Array.from(params.keys()).some(Boolean);
}

function encodeBasicCredential(value: string): string {
    if (typeof btoa !== "undefined") {
        return btoa(value);
    }
    return value;
}

export function tokenizeShell(input: string): string[] {
    const tokens: string[] = [];
    let current = "";
    let quote: "'" | "\"" | null = null;
    let escaping = false;

    for (let index = 0; index < input.length; index += 1) {
        const char = input[index];

        if (escaping) {
            current += char === "\n" ? "" : char;
            escaping = false;
            continue;
        }

        if (char === "\\") {
            escaping = true;
            continue;
        }

        if (quote) {
            if (char === quote) {
                quote = null;
            } else {
                current += char;
            }
            continue;
        }

        if (char === "'" || char === "\"") {
            quote = char;
            continue;
        }

        if (/\s/.test(char)) {
            if (current) {
                tokens.push(current);
                current = "";
            }
            continue;
        }

        current += char;
    }

    if (escaping) {
        current += "\\";
    }

    if (quote) {
        throw new Error("cURL command has an unfinished quote.");
    }

    if (current) {
        tokens.push(current);
    }

    return tokens;
}
