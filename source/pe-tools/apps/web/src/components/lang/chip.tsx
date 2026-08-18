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

import { cn } from "#/lib/utils";

import "./lang.css";

/** The meaning roles a fact may wear. No chip-only hues exist, by design. */
export type FactTone = "meta" | "caution" | "done" | "alarm" | "pea";

export interface FactChipProps {
  children: React.ReactNode;
  /** `meta` (the default) is the neutral machine-measured fact — most chips are this. */
  tone?: FactTone;
  /** Seam: typed but unproven. Reserved border style; see the header. */
  dashed?: boolean;
  /** Required: what the fact means and what would change it. */
  title: string;
  className?: string;
}

/** A state fact, machine-measured, so mono. Not a control — it has no press. */
export function FactChip({ children, tone = "meta", dashed, title, className }: FactChipProps) {
  return (
    <span
      className={cn("dl-chip", className)}
      data-tone={tone}
      data-seam={dashed === true ? "" : undefined}
      title={title}
    >
      <span className="dl-chip-label">{children}</span>
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
  className?: string;
}

/** A removable narrowing control. Same shell as a fact, one affordance more. */
export function NarrowChip({ label, count, onRemove, title, className }: NarrowChipProps) {
  return (
    <span className={cn("dl-chip", className)} title={title}>
      {label}
      <span className="dl-chip-count">{count}</span>
      <button
        type="button"
        className="dl-chip-x"
        onClick={onRemove}
        title={`Remove the "${label}" narrowing — widens the view back out`}
      >
        <X />
      </button>
    </span>
  );
}
