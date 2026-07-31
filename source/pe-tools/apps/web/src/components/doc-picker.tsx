/**
 * DocPicker rows — the one visual vocabulary for picking a document, shared by every
 * mount (the sentence's doc slot, the .rvt/.rfa chips). The look is the poc/chip-a
 * winner: extension chip + name + mono sub-line, optional year band headers, selected
 * marker. Presentation only — each mount owns its own data wiring and action loop.
 */

const EXT_COLOR: Record<string, string> = {
  rvt: "var(--pe-blue)",
  rfa: "var(--cat-kiln)",
};

export function extOf(path: string): string | undefined {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  return match?.[1]?.toLowerCase();
}

/** Year/section band header, e.g. "REVIT 2025 · 4". */
export function DocGroup({ label, aside }: { label: string; aside?: string }) {
  return (
    <div className="flex items-baseline gap-2 px-2 pb-0.5 pt-1.5">
      <span
        className="font-[var(--font-pe-mono)]"
        style={{ fontSize: 8, letterSpacing: "0.06em", color: "var(--foreground)" }}
      >
        {label.toUpperCase()}
      </span>
      {aside ? (
        <span
          className="font-[var(--font-pe-mono)]"
          style={{ fontSize: 8, color: "var(--muted-foreground)" }}
        >
          {aside}
        </span>
      ) : null}
    </div>
  );
}

export function DocRow({
  ext,
  label,
  sub,
  subTone = "muted",
  selected,
  disabled,
  onPick,
}: {
  /** Extension chip ("rvt"/"rfa" get their category hue; anything else renders muted). */
  ext?: string;
  label: string;
  /** Mono sub-line: observed state ("open now"), never a guess. */
  sub?: string;
  subTone?: "muted" | "active";
  selected?: boolean;
  disabled?: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-[var(--pe-blue)]/5 disabled:opacity-40"
      style={{
        borderBottom: "0.5px solid var(--line-soft)",
        background: selected ? "color-mix(in srgb, var(--pe-blue) 5%, transparent)" : undefined,
      }}
    >
      {ext ? (
        <span
          className="font-[var(--font-pe-mono)] px-1"
          style={{
            fontSize: 8,
            letterSpacing: "0.06em",
            borderRadius: 2,
            flexShrink: 0,
            border: `0.5px solid ${EXT_COLOR[ext] ?? "var(--line-2)"}`,
            color: EXT_COLOR[ext] ?? "var(--muted-foreground)",
          }}
        >
          {ext}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate" style={{ fontSize: 11.5, color: "var(--foreground)" }}>
          {label}
        </span>
        {sub ? (
          <span
            className="block truncate font-[var(--font-pe-mono)]"
            style={{
              fontSize: 8,
              letterSpacing: "0.04em",
              color: subTone === "active" ? "var(--cat-kiln)" : "var(--muted-foreground)",
            }}
          >
            {sub}
          </span>
        ) : null}
      </span>
      {selected ? (
        <span
          className="font-[var(--font-pe-mono)]"
          style={{ fontSize: 8, color: "var(--pe-blue)", flexShrink: 0 }}
        >
          ◉
        </span>
      ) : null}
    </button>
  );
}
