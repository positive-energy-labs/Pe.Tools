import { useEffect, useState } from "react";
import { Moon, Paintbrush, Sun, SunMoon } from "lucide-react";

import { Press } from "#/components/lang/press";
import {
  applyReskinTheme,
  initialReskinTheme,
  reskinThemes,
  type ReskinTheme,
} from "#/theme/registry";

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

  // data-theme is owned by the reskin-lab registry (src/theme/registry.ts) — it names the
  // direction, never the mode. Mode rides the .dark class + color-scheme; the attribute had
  // zero readers when the reskin seam took the name over.
  document.documentElement.style.colorScheme = resolved;
}

const NEXT: Record<ThemeMode, ThemeMode> = { light: "dark", dark: "auto", auto: "light" };
const ICON = { light: Sun, dark: Moon, auto: SunMoon } as const;
const LABEL = { light: "Light", dark: "Dark", auto: "Auto" } as const;

/** The reskin-lab direction switcher (dev-only): cycles default → each registered direction and
 *  back, persisting for the boot script to re-apply before first paint. Local on purpose — this
 *  is the toggle's dev companion, not kit vocabulary. */
function ReskinSwitcher() {
  const [theme, setTheme] = useState<ReskinTheme | null>(null);

  // Sync to whatever the boot script already applied (avoids a mismatch on first paint).
  useEffect(() => {
    setTheme(initialReskinTheme());
  }, []);

  if (!import.meta.env.DEV) return null;

  function cycle() {
    const at = theme === null ? -1 : reskinThemes.indexOf(theme);
    const next = at + 1 >= reskinThemes.length ? null : reskinThemes[at + 1];
    setTheme(next);
    applyReskinTheme(next);
  }

  const label = `Reskin: ${theme ?? "default"}. Click to cycle directions.`;

  return (
    <Press onClick={cycle} aria-label={label} title={label} size="icon" tone="quiet">
      <Paintbrush className="size-4" strokeWidth={1.5} />
    </Press>
  );
}

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
  // The dev-only reskin switcher renders beside the toggle on every route that mounts one.
  return (
    <>
      {import.meta.env.DEV ? <ReskinSwitcher /> : null}
      <Press onClick={cycle} aria-label={label} title={label} size="icon" tone="quiet">
        <Icon className="size-4" strokeWidth={1.5} />
      </Press>
    </>
  );
}
