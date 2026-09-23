/**
 * CHIPS — two components, because round 1 proved they are two things wearing one name.
 *
 * CONSUMERS: `FactChip` — the arming strip's plan hash and count (already, below), soon the
 * master-table header facts; `NarrowChip` — soon, the addressing sentence's narrowing row.
 *
 * RULINGS EMBODIED:
 * - THE ROUND-1 GAP CENSUS: canon `ui/chip` is a STATE FACT — no removal affordance, no count
 *   slot — so a NARROWING chip could not be built from it. Every one of the five builders
 *   hand-rolled the removable form. Splitting them is the fix; merging them would give the fact
 *   chip an `onRemove` nobody fills, which SURFACE-PHILOSOPHY §6 names as the expensive kind of
 *   slot ("a promise in the type that misleads the next reader").
 * - TONE COMES FROM THE MEANING TOKENS and nowhere else. A chip may not mint a hue.
 * - `dashed` IS RESERVED FOR SEAM — typed but unproven, a fixture, a stand-in. The border style
 *   IS that meaning; nothing else in the language may use it.
 * - CHIPS NARROW BUT NEVER HIDE. `NarrowChip`'s count is of rows still in scope, and removing
 *   one widens the view back out — it never reveals rows that were being concealed.
 * - `title` is required on both: a chip states a fact; the title says what the fact means and
 *   what would change it.
 */
import { X } from "lucide-react";

import { tv } from "#/lib/tv";

import "./lang.css";

export const chipRecipe = tv({
  slots: {
    base: "inline-flex h-[18px] max-w-[34ch] items-center gap-[5px] overflow-hidden whitespace-nowrap border border-line px-[5px] t-small face-mono tracking-[0.03em] text-ink-2",
    label: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
    count: "text-ink-2 tabular-nums",
    remove:
      "veil grid size-3 cursor-pointer place-items-center border-0 bg-transparent text-ink-2 focus-visible:outline focus-visible:outline-line-2 [&>svg]:size-[9px]",
    tag: "t-small t-upper tabular-nums",
  },
  variants: {
    tone: {
      meta: {},
      caution: {},
      done: {},
      alarm: {},
      pea: {},
    },
    state: {
      solid: {},
      seam: { base: "seam-border" },
    },
  },
  defaultVariants: { tone: "meta", state: "solid" },
});

/** The meaning roles a fact may wear. No chip-only hues exist, by design. */
type FactTone = "meta" | "caution" | "done" | "alarm" | "pea";

export interface FactChipProps {
  children: React.ReactNode;
  /** `meta` (the default) is the neutral machine-measured fact — most chips are this. */
  tone?: FactTone;
  /** Seam: typed but unproven. Reserved border style; see the header. */
  dashed?: boolean;
  /** Required: what the fact means and what would change it. */
  title: string;
}

/** A state fact, machine-measured, so mono. Not a control — it has no press. */
export function FactChip({ children, tone = "meta", dashed, title }: FactChipProps) {
  const { base, label } = chipRecipe({ tone, state: dashed ? "seam" : "solid" });
  return (
    <span
      className={base()}
      data-tone={tone === "meta" ? undefined : tone}
      data-surface="artifact"
      data-seam={dashed === true ? "" : undefined}
      title={title}
    >
      <span className={label()}>{children}</span>
    </span>
  );
}

export interface NarrowChipProps {
  /** The narrowing itself, e.g. "needs a person" or "type: FDCL-611". */
  label: string;
  /** How many rows this narrowing still admits. Narrowings never hide; they scope. */
  count: number;
  /** Removing widens the view back out. */
  onRemove: () => void;
  /** Required: what this narrowing does to the view. */
  title: string;
  /** A narrowing the grammar could not read: it admits nothing and says so. */
  caution?: boolean;
}

/** A removable narrowing control. Same shell as a fact, one affordance more. */
export function NarrowChip({ label, count, onRemove, title, caution }: NarrowChipProps) {
  const { base, count: countSlot, remove } = chipRecipe({ tone: caution ? "caution" : "meta" });
  return (
    <span
      className={base()}
      data-tone={caution ? "caution" : undefined}
      data-surface="artifact"
      title={title}
    >
      {label}
      <span className={countSlot()}>{count}</span>
      <button
        type="button"
        className={remove()}
        onClick={onRemove}
        title={`Remove the "${label}" narrowing — widens the view back out`}
      >
        <X />
      </button>
    </span>
  );
}

/** The small mono tag that names a state or an object: quiet caption-size caps,
 *  tabular numerals. A phase may tint it inside the arming strip; nowhere else. */
export function Tag({ children }: { children: React.ReactNode }) {
  const { tag } = chipRecipe();
  return <span className={tag()}>{children}</span>;
}
