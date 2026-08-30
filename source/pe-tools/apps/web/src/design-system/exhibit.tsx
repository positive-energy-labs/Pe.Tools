/**
 * EXHIBIT SCAFFOLDING — the frames the /design-system routes hang specimens in. Not product
 * chrome: page sections are lang/Section, captions are lang/Provenance, tags are lang/Tag
 * (ruled 2026-08-29: the exhibits wear the product's chrome so a regression shows here first).
 */

/** Spec prose on the left, the living component on the right. The scaffold's whole framing. */
export function Demo({
  label,
  spec,
  consumers,
  children,
}: {
  label: string;
  spec: React.ReactNode;
  /** Named inline, always — the index law is enforced by having to write this down. */
  consumers: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 items-start gap-x-8 gap-y-3 py-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="t-label t-upper text-ink">{label}</span>
        <p className="t-prose text-ink-2">{spec}</p>
        <span className="t-caption face-mono text-ink-mute">consumers: {consumers}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </div>
  );
}

/** A recorded gap, said out loud where a reader would otherwise think the demo was finished. */
export function Gap({ children }: { children: React.ReactNode }) {
  return (
    <p className="max-w-[86ch] pl-2 t-caption face-mono text-ink-2">
      <span className="t-upper">gap · </span>
      {children}
    </p>
  );
}

/** The wrong way — a real component, used against its own ruling, struck by its caption.
 *  Never dimmed: opacity is not a de-emphasis mechanism (ruled 2026-08-29). */
export function CounterExample({ why, children }: { why: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="w-fit">{children}</div>
      <span className="t-caption text-ink-2">
        <span className="t-upper">the wrong way</span> — {why}
      </span>
    </div>
  );
}
