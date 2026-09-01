import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { Press } from "#/components/lang/press";

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

export function ThemeToggle() {
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

  // `t-value`, not `t-label`: the canonized label bundle carries CASE, so "Auto" read as "AUTO".
  // This is a control's own word, not a section head.
  return (
    <Press onClick={cycle} aria-label={label} title={label} size="value" tone="neutral">
      {/* `Press` is `min-w-0` (it is a flex item wherever it sits), so an icon + word in a header
       * row wrapped to two lines and stood taller than the controls beside it. The glyph and its
       * word are ONE mark: they ride a nowrap inline row. */}
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <Icon className="size-3.5" />
        {LABEL[mode]}
      </span>
    </Press>
  );
}

export default ThemeToggle;
