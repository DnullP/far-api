import { Sun, Moon, X } from "lucide-react";
import "./SettingsModal.css";

export type Theme = "dark" | "light";

interface Props {
    open: boolean;
    theme: Theme;
    onThemeChange: (theme: Theme) => void;
    onClose: () => void;
}

export function SettingsModal({ open, theme, onThemeChange, onClose }: Props) {
    if (!open) return null;

    return (
        <div className="settings-overlay" onClick={onClose}>
            <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
                <div className="settings-header">
                    <span className="settings-title">Settings</span>
                    <button className="settings-close" onClick={onClose}>
                        <X size={16} />
                    </button>
                </div>
                <div className="settings-body">
                    <div className="settings-section">
                        <h3 className="section-label">Appearance</h3>
                        <div className="theme-options">
                            <button
                                className={`theme-card ${theme === "light" ? "active" : ""}`}
                                onClick={() => onThemeChange("light")}
                            >
                                <Sun size={24} />
                                <span>Light</span>
                            </button>
                            <button
                                className={`theme-card ${theme === "dark" ? "active" : ""}`}
                                onClick={() => onThemeChange("dark")}
                            >
                                <Moon size={24} />
                                <span>Dark</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
