import { useEffect, useState } from "react";
import { Clipboard, Download, X } from "lucide-react";
import "./ExportJsonModal.css";

export interface ExportJsonModalArtifact {
    title: string;
    fileName: string;
    json: string;
}

interface Props {
    artifact: ExportJsonModalArtifact;
    onClose: () => void;
}

export function ExportJsonModal({ artifact, onClose }: Props) {
    const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    const copyJson = async () => {
        try {
            await navigator.clipboard.writeText(artifact.json);
            setCopyState("copied");
        } catch {
            setCopyState("failed");
        }
    };

    const downloadJson = () => {
        const blob = new Blob([artifact.json], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = artifact.fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
    };

    return (
        <div className="export-modal-overlay" onClick={onClose}>
            <form
                className="export-modal"
                role="dialog"
                aria-modal="true"
                aria-label={artifact.title}
                onClick={(event) => event.stopPropagation()}
                onSubmit={(event) => event.preventDefault()}
            >
                <div className="export-modal-header">
                    <div className="export-modal-heading">
                        <span className="export-modal-title">{artifact.title}</span>
                        <span className="export-modal-file">{artifact.fileName}</span>
                    </div>
                    <button
                        className="export-modal-icon"
                        type="button"
                        aria-label="Close export modal"
                        onClick={onClose}
                    >
                        <X size={16} />
                    </button>
                </div>
                <textarea
                    className="export-modal-json"
                    aria-label="Export JSON content"
                    readOnly
                    spellCheck={false}
                    value={artifact.json}
                />
                <div className="export-modal-footer">
                    <span className={`export-modal-status export-modal-status--${copyState}`} aria-live="polite">
                        {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : ""}
                    </span>
                    <button type="button" className="export-modal-secondary" onClick={copyJson}>
                        <Clipboard size={14} />
                        <span>Copy</span>
                    </button>
                    <button type="button" className="export-modal-primary" onClick={downloadJson}>
                        <Download size={14} />
                        <span>Download</span>
                    </button>
                </div>
            </form>
        </div>
    );
}
