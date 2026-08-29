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
    <div className="grid grid-cols-1 items-start gap-x-8 gap-y-3 border-b border-line py-4 last:border-b-0 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="face-mono t-label text-ink">{label}</span>
        <p className="t-prose text-ink-2">{spec}</p>
        <span className="t-caption text-ink-mute">consumers: {consumers}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </div>
  );
}

/** A recorded gap, said out loud where a reader would otherwise think the demo was finished. */
export function Gap({ children }: { children: React.ReactNode }) {
  return (
    <p className="face-mono t-caption max-w-[86ch] border-l border-line-2 pl-2 text-ink-2">
      <span className="text-caution">gap · </span>
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
      <span className="face-mono t-caption text-ink-mute">
        <span className="line-through">the wrong way</span> — {why}
      </span>
    </div>
  );
}
