import { MODE_HINT, MODES, type Mode } from "#/workbench/depth";

/** Segmented chat/trace/world depth dial. Mode lives in the URL (useMode wraps the search param). */
export function ModeDial({ mode, setMode }: { mode: Mode; setMode: (mode: Mode) => void }) {
  return (
    <div
      role="group"
      aria-label="View depth"
      title={MODE_HINT[mode]}
      className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5"
    >
      {MODES.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => setMode(value)}
          className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
        >
          {value.charAt(0).toUpperCase() + value.slice(1)}
        </button>
      ))}
    </div>
  );
}
