/**
 * SECTION — the page-chrome unit (ruled 2026-08-16, ops-pass batch:
 * "every new route hand-rolled the same Section/SectionHead chrome — three near-identical
 * copies — the most visible thing lang/ is missing").
 *
 * CONSUMERS: src/ops/** (44 OpSection sites migrate here); route section heads shed their
 * hand-rolled copies during their passes.
 *
 * The head is SANS small-caps (the 2026-07-13 heads-are-sans ruling; t-upper carries the
 * tracking and the head's semibold), with an optional HelpTip beside the title (the one
 * legal home for region orientation) and an optional right-aligned aside for counts and
 * controls. Plain content is never enclosed — a section is a head and a hairline, not a box.
 */
import { cn } from "#/lib/utils";

import "./lang.css";

export function Section({
  label,
  index,
  note,
  help,
  aside,
  children,
  className,
}: {
  label: string;
  /** Optional numbered section marker for documentation and exhibit heads. */
  index?: string;
  /** Optional one-line orientation note for documentation and exhibit heads. */
  note?: React.ReactNode;
  /** Region orientation — a HelpTip node, beside the title it orients. */
  help?: React.ReactNode;
  /** Right-aligned counts/controls for the head row. */
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("dl-section", className)}>
      <div className="dl-section-head">
        {index != null ? <span className="dl-section-index">{index}</span> : null}
        <h2 className="dl-section-label">{label}</h2>
        {help}
        {note != null ? <span className="dl-section-note">{note}</span> : null}
        {aside != null ? <div className="dl-section-aside">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * PROVENANCE — the composed-read honesty line (ruled 2026-08-16, ops-pass batch): what was
 * measured, when, and what was left out. Machine-measured by definition, so mono; quiet, so
 * secondary ink; never a badge — freshness that matters becomes queue work, this line is the
 * receipt of how the view was assembled (SURFACE-PHILOSOPHY §3).
 */
export function Provenance({ children }: { children: React.ReactNode }) {
  return <p className="dl-provenance">{children}</p>;
}
