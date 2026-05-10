/**
 * Tiny theme manager: toggles between 'dark' (default) and 'light' by setting
 * a class on <html>. Theme overrides for hardcoded Tailwind hex backgrounds
 * live in index.css under `html.light`.
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

export function applyTheme(theme) {
  const html = document.documentElement;
  html.classList.remove("light", "dark");
  html.classList.add(theme);
  html.style.colorScheme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
}

export function useTheme() {
  const [theme, setTheme] = useState(() => getInitial());
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  return { theme, setTheme, toggle };
}
