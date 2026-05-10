import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";
import { applyTheme } from "@/lib/theme";

// Apply theme BEFORE first render to avoid a dark-to-light flash
const saved = localStorage.getItem("vk_theme");
const initial =
  saved === "light" || saved === "dark"
    ? saved
    : window.matchMedia?.("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
applyTheme(initial);

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
