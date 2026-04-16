import { Zap, Globe, Variable, Layers } from "lucide-react";
import "./WelcomeTab.css";

export function WelcomeTab() {
    return (
        <div className="welcome-tab">
            <h1 className="welcome-title">Far API</h1>
            <p className="welcome-subtitle">Local-first API management</p>
            <div className="welcome-features">
                <div className="feature-card">
                    <Globe size={24} />
                    <h3>RESTful Requests</h3>
                    <p>Support for GET, POST, PUT, PATCH, DELETE and more HTTP methods</p>
                </div>
                <div className="feature-card">
                    <Variable size={24} />
                    <h3>Environment Variables</h3>
                    <p>Use {"{{variables}}"} in URLs and headers, switch environments easily</p>
                </div>
                <div className="feature-card">
                    <Layers size={24} />
                    <h3>Collections</h3>
                    <p>Organize your API requests into collections and folders</p>
                </div>
                <div className="feature-card">
                    <Zap size={24} />
                    <h3>Offline First</h3>
                    <p>Everything runs locally with Tauri — no account required</p>
                </div>
            </div>
            <p className="welcome-hint">Open a request from the sidebar to get started</p>
        </div>
    );
}
