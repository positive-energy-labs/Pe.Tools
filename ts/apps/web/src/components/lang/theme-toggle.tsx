import { Moon, Sun, SunMoon } from "lucide-react";
import { Button } from "#/components/lang/button";
import { useThemeMode, writeTheme, type ThemeMode } from "#/settings/option-theme";

const NEXT: Record<ThemeMode, ThemeMode> = { light: "dark", dark: "auto", auto: "light" };
const ICON = { light: Sun, dark: Moon, auto: SunMoon } as const;
const LABEL = { light: "Light", dark: "Dark", auto: "Auto" } as const;

export function ThemeToggle({ labelled = false }: { labelled?: boolean }) {
  const mode = useThemeMode();
  const Icon = ICON[mode];
  const label = `Theme: ${LABEL[mode]}${mode === "auto" ? " (system)" : ""}. Click to change.`;
  return (
    <Button
      onClick={() => writeTheme(NEXT[mode])}
      label={label}
      icon={<Icon strokeWidth={1.5} aria-hidden />}
    >
      {labelled ? `Theme: ${LABEL[mode]}` : undefined}
    </Button>
  );
}
