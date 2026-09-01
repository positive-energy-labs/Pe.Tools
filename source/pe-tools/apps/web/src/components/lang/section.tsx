/**
 * SECTION — the page-chrome unit (ruled 2026-08-16, ops-pass batch:
 * "every new route hand-rolled the same Section/SectionHead chrome — three near-identical
 * copies — the most visible thing lang/ is missing").
 *
 * CONSUMERS: src/ops/** (44 OpSection sites migrate here); route section heads shed their
 * hand-rolled copies during their passes.
 *
 * The head is the t-label ROLE (C2, 2026-09-01): upper + tracking + medium + ink-2 in one word;
 * the tier owns the whole look, so the call site names no case, weight or ink. HelpTip may sit
 * beside the title (the one legal home for region orientation) and an optional right-aligned
 * aside carries counts and controls. Plain content is never enclosed — a section is a head
 * and a hairline, not a box.
 */
import { tv } from "#/lib/tv";

import "./lang.css";

export const sectionRecipe = tv({
  slots: {
    base: "min-w-0",
    head: "mb-1.5 flex items-baseline gap-2 border-b border-line pb-[3px]",
    label: "m-0 t-label",
    aside: "ml-auto flex items-center gap-1.5",
    provenance: "mt-1.5 mb-0 face-mono t-caption tracking-[0.02em] text-ink-2",
  },
});

export function Section({
  label,
  help,
  aside,
  children,
}: {
  label: string;
  /** Region orientation — a HelpTip node, beside the title it orients. */
  help?: React.ReactNode;
  /** Right-aligned counts/controls for the head row. */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const slots = sectionRecipe();
  return (
    <section className={slots.base()}>
      <div className={slots.head()}>
        <h2 className={slots.label()}>{label}</h2>
        {help}
        {aside != null ? <div className={slots.aside()}>{aside}</div> : null}
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
  const { provenance } = sectionRecipe();
  return <p className={provenance()}>{children}</p>;
}
