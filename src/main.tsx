import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const THEME_STORAGE_KEY = "far-api.theme";

const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
if (storedTheme === "dark" || storedTheme === "light") {
  document.documentElement.setAttribute("data-theme", storedTheme);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
