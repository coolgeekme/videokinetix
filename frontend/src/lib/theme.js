/**
 * Tiny theme manager: toggles between 'dark' (default) and 'light' by setting
 * a class on <html>. Theme overrides for hardcoded Tailwind hex backgrounds
 * live in index.css under `html.light`.
 *
 * Uses module-level state + subscribers so every component that calls
 * `useTheme` re-renders when the theme changes anywhere in the app.
 */
import { useEffect, useState } from "react";

const KEY = "vk_theme";

function getInitial() {
  if (typeof window === "undefined") return "dark";
  const saved = localStorage.getItem(KEY);
  if (saved === "light" || saved === "dark") return saved;
  // Respect OS preference on first visit
  return window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

const listeners = new Set();
let current = typeof window !== "undefined" ? getInitial() : "dark";

function applyToDom(theme) {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  html.classList.remove("light", "dark");
  html.classList.add(theme);
  html.style.colorScheme = theme;
}

export function setTheme(theme) {
  if (theme !== "light" && theme !== "dark") return;
  current = theme;
  applyToDom(theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l(theme));
}

export function getTheme() {
  return current;
}

// Apply on first import (covers SSR-less Create-React-App)
if (typeof window !== "undefined") {
  applyToDom(current);
}

export function useTheme() {
  const [theme, set] = useState(current);
  useEffect(() => {
    const l = (t) => set(t);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  const toggle = () => setTheme(current === "dark" ? "light" : "dark");
  return { theme, setTheme, toggle };
}
