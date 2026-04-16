import React from "react";
import ReactDOM from "react-dom/client";
import { MockApp } from "./mock/MockApp";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <MockApp />
    </React.StrictMode>,
);
