import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { Button } from "#/components/ui/button";

type ThemeMode = "light" | "dark" | "auto";

function getInitialMode(): ThemeMode {
  if (typeof window === "undefined") return "auto";
  const stored = window.localStorage.getItem("theme");
  return stored === "light" || stored === "dark" || stored === "auto" ? stored : "auto";
}

function applyThemeMode(mode: ThemeMode) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = mode === "auto" ? (prefersDark ? "dark" : "light") : mode;

  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(resolved);

  if (mode === "auto") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", mode);
  }
  document.documentElement.style.colorScheme = resolved;
}

const NEXT: Record<ThemeMode, ThemeMode> = { light: "dark", dark: "auto", auto: "light" };
const ICON = { light: Sun, dark: Moon, auto: Monitor } as const;
const LABEL = { light: "Light", dark: "Dark", auto: "Auto" } as const;

export function ThemeToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<ThemeMode>("auto");

  // Sync to whatever the inline root script already applied (avoids a flash / mismatch).
  useEffect(() => {
    setMode(getInitialMode());
  }, []);

  // Track the system theme only while in auto.
  useEffect(() => {
    if (mode !== "auto") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyThemeMode("auto");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [mode]);

  function cycle() {
    const next = NEXT[mode];
    setMode(next);
    applyThemeMode(next);
    window.localStorage.setItem("theme", next);
  }

  const Icon = ICON[mode];
  const label = `Theme: ${LABEL[mode]}${mode === "auto" ? " (system)" : ""}. Click to change.`;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={cycle}
      aria-label={label}
      title={label}
      className={className}
    >
      <Icon className="size-3.5" />
      {LABEL[mode]}
    </Button>
  );
}

export default ThemeToggle;
