import type { Inspectable } from "#/route/inspect";

export const ARTIFACT: Inspectable = {
  label: (id) => id.split(/[\\/]/).at(-1) ?? id,
  open: { kind: "shell", path: (id) => id },
};

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="t-small t-upper text-ink-2">{children}</span>;
}

// ── route ───────────────────────────────────────────────────────────────────────────────────────
