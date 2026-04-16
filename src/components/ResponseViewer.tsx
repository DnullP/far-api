import { useState, useMemo } from "react";
import Prism from "prismjs";
import type { ApiResponse } from "../types/api";
import "./ResponseViewer.css";

// Register JSON grammar (Prism ships with markup, css, js by default)
if (!Prism.languages.json) {
    Prism.languages.json = {
        property: { pattern: /(^|[^\\])"(?:\\.|[^\\"\r\n])*"(?=\s*:)/, lookbehind: true, greedy: true },
        string: { pattern: /(^|[^\\])"(?:\\.|[^\\"\r\n])*"(?!\s*:)/, lookbehind: true, greedy: true },
        comment: { pattern: /\/\/.*|\/\*[\s\S]*?(?:\*\/|$)/, greedy: true },
        number: /-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/i,
        punctuation: /[{}[\],]/,
        operator: /:/,
        boolean: /\b(?:false|true)\b/,
        null: { pattern: /\bnull\b/, alias: "keyword" },
    };
}

function highlight(code: string, lang: string): string | null {
    const grammar = Prism.languages[lang];
    if (!grammar) return null;
    return Prism.highlight(code, grammar, lang);
}

interface Props {
    response: ApiResponse | null;
    loading?: boolean;
}

type ResponseTab = "body" | "headers";

export function ResponseViewer({ response, loading }: Props) {
    const [tab, setTab] = useState<ResponseTab>("body");

    const { formattedBody, highlightedHtml, statusClass } = useMemo(() => {
        if (!response) return { formattedBody: "", highlightedHtml: null, statusClass: "" };

        const sc =
            response.status >= 200 && response.status < 300
                ? "status-ok"
                : response.status >= 400
                  ? "status-error"
                  : "status-warn";

        let body = response.body;
        let lang = "plaintext";
        try {
            body = JSON.stringify(JSON.parse(response.body), null, 2);
            lang = "json";
        } catch {
            const ct = (response.headers["content-type"] ?? "").toLowerCase();
            if (ct.includes("html")) lang = "html";
            else if (ct.includes("xml")) lang = "markup";
            else if (ct.includes("css")) lang = "css";
            else if (ct.includes("javascript")) lang = "javascript";
        }

        return { formattedBody: body, highlightedHtml: highlight(body, lang), statusClass: sc };
    }, [response]);

    if (loading) {
        return (
            <div className="response-viewer response-loading">
                <div className="spinner" />
                <span>Sending request...</span>
            </div>
        );
    }

    if (!response) {
        return (
            <div className="response-viewer response-empty">
                <span>Send a request to see the response</span>
            </div>
        );
    }

    return (
        <div className="response-viewer">
            <div className="response-meta">
                <span className={`response-status ${statusClass}`}>
                    {response.status} {response.statusText}
                </span>
                <span className="response-time">{response.time}ms</span>
                <span className="response-size">
                    {response.size > 1024
                        ? `${(response.size / 1024).toFixed(1)} KB`
                        : `${response.size} B`}
                </span>
            </div>
            <div className="response-tabs">
                <button
                    className={tab === "body" ? "active" : ""}
                    onClick={() => setTab("body")}
                >
                    Body
                </button>
                <button
                    className={tab === "headers" ? "active" : ""}
                    onClick={() => setTab("headers")}
                >
                    Headers
                </button>
            </div>
            <div className="response-content">
                {tab === "body" && (
                    highlightedHtml
                        ? <pre className="response-body"><code dangerouslySetInnerHTML={{ __html: highlightedHtml }} /></pre>
                        : <pre className="response-body">{formattedBody}</pre>
                )}
                {tab === "headers" && (
                    <div className="response-headers-list">
                        {Object.entries(response.headers).map(([k, v]) => (
                            <div className="response-header-row" key={k}>
                                <span className="header-key">{k}</span>
                                <span className="header-value">{v}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
