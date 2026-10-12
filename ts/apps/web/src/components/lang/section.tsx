/**
 * The page-chrome unit: a head (the `t-small t-upper` role) and a hairline, never a box. HelpTip may
 * sit beside the title and an optional right-aligned aside carries counts and controls.
 */
import { tv } from "#/lib/tv";

import { Rail } from "./rail";

import "./lang.css";

export const sectionRecipe = tv({
  slots: {
    base: "min-w-0",
    label: "m-0 t-small t-upper",
    aside: "ml-auto flex items-center gap-1.5",
    provenance: "mt-1.5 mb-0 t-small face-mono tracking-[0.02em] text-ink-2",
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
      <Rail
        lead={
          <>
            <h2 className={slots.label()}>{label}</h2>
            {help}
          </>
        }
        trail={aside != null ? <div className={slots.aside()}>{aside}</div> : undefined}
      />
      {children}
    </section>
  );
}

/**
 * Provenance: the composed-read honesty line (what was measured, when, what was left out). Mono,
 * secondary ink, never a badge; freshness that matters becomes queue work.
 */
export function Provenance({ children }: { children: React.ReactNode }) {
  const { provenance } = sectionRecipe();
  return <p className={provenance()}>{children}</p>;
}
