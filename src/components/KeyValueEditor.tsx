import { type KeyValuePair, createKeyValuePair, COMMON_HEADERS } from "../types/api";
import "./KeyValueEditor.css";

interface Props {
    pairs: KeyValuePair[];
    onChange: (pairs: KeyValuePair[]) => void;
    showHeaderSuggestions?: boolean;
}

export function KeyValueEditor({ pairs, onChange, showHeaderSuggestions }: Props) {
    const update = (id: string, field: Partial<KeyValuePair>) => {
        const next = pairs.map((p) => (p.id === id ? { ...p, ...field } : p));
        onChange(next);
    };

    const remove = (id: string) => {
        const next = pairs.filter((p) => p.id !== id);
        onChange(next.length === 0 ? [createKeyValuePair()] : next);
    };

    const addRow = () => onChange([...pairs, createKeyValuePair()]);

    const handleKeyChange = (id: string, key: string) => {
        update(id, { key });
        // Auto-add row when typing in last empty row
        const last = pairs[pairs.length - 1];
        if (last && last.id === id && !last.key && !last.value) {
            // already empty last row, don't add another
        }
    };

    return (
        <div className="kv-editor">
            <div className="kv-header">
                <span className="kv-check" />
                <span className="kv-key">Key</span>
                <span className="kv-value">Value</span>
                <span className="kv-actions" />
            </div>
            {pairs.map((p) => (
                <div className="kv-row" key={p.id}>
                    <input
                        type="checkbox"
                        className="kv-check"
                        checked={p.enabled}
                        onChange={(e) => update(p.id, { enabled: e.target.checked })}
                    />
                    <input
                        className="kv-key"
                        value={p.key}
                        placeholder="Key"
                        list={showHeaderSuggestions ? "header-keys" : undefined}
                        onChange={(e) => handleKeyChange(p.id, e.target.value)}
                    />
                    <input
                        className="kv-value"
                        value={p.value}
                        placeholder="Value"
                        onChange={(e) => update(p.id, { value: e.target.value })}
                    />
                    <button className="kv-remove" onClick={() => remove(p.id)} title="Remove">
                        ×
                    </button>
                </div>
            ))}
            <button className="kv-add" onClick={addRow}>
                + Add
            </button>
            {showHeaderSuggestions && (
                <datalist id="header-keys">
                    {COMMON_HEADERS.map((h) => (
                        <option key={h} value={h} />
                    ))}
                </datalist>
            )}
        </div>
    );
}
