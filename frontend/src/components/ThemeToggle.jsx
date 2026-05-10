import { Sun, Moon } from "lucide-react";
import { useTheme } from "../lib/theme";

export default function ThemeToggle({ className = "" }) {
  const { theme, toggle } = useTheme();
  const isLight = theme === "light";
  return (
    <button
      onClick={toggle}
      data-testid="theme-toggle"
      aria-label={`Switch to ${isLight ? "dark" : "light"} mode`}
      title={`Switch to ${isLight ? "dark" : "light"} mode`}
      className={`inline-flex items-center justify-center w-9 h-9 border border-white/10 hover:border-white/30 transition-colors ${className}`}
    >
      {isLight ? (
        <Moon className="w-4 h-4" />
      ) : (
        <Sun className="w-4 h-4" />
      )}
    </button>
  );
}
