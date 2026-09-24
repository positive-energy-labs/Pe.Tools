import { useEffect, useState } from "react";
import { Moon, Sun, SunMoon } from "lucide-react";

import { Press } from "#/components/lang/press";

type ThemeMode = "light" | "dark" | "auto";

function getInitialMode(): ThemeMode {
  if (typeof window === "undefined") return "auto";
  try {
    const stored = window.localStorage.getItem("theme");
    return stored === "light" || stored === "dark" || stored === "auto" ? stored : "auto";
  } catch {
    return "auto";
  }
}

function applyThemeMode(mode: ThemeMode) {
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
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
const ICON = { light: Sun, dark: Moon, auto: SunMoon } as const;
const LABEL = { light: "Light", dark: "Dark", auto: "Auto" } as const;

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("auto");

  // Sync to whatever the inline root script already applied (avoids a flash / mismatch).
  useEffect(() => {
    setMode(getInitialMode());
  }, []);

  // Track the system theme only while in auto.
  useEffect(() => {
    if (mode !== "auto" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyThemeMode("auto");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [mode]);

  function cycle() {
    const next = NEXT[mode];
    setMode(next);
    applyThemeMode(next);
    try {
      window.localStorage.setItem("theme", next);
    } catch {
      // The theme still applies for this page when storage is unavailable.
    }
  }

  const Icon = ICON[mode];
  const label = `Theme: ${LABEL[mode]}${mode === "auto" ? " (system)" : ""}. Click to change.`;

  // Icon only, like every other control in a head cluster; the mode rides the title.
  return (
    <Press onClick={cycle} aria-label={label} title={label} size="icon" tone="quiet">
      <Icon className="size-4" strokeWidth={1.5} />
    </Press>
  );
}
