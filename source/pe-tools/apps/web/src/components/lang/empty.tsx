/**
 * EMPTY STATE — the labelled empty, as a constructor-enforced primitive.
 *
 * CONSUMERS (waiting at ship time, counted in the families audit): /families ×12, /family ×8,
 * /takeoffs ×4 — every one currently a per-surface `EMPTY_CLASS` constant that enforces nothing.
 *
 * RULINGS EMBODIED (SURFACE-PHILOSOPHY §1 + §4):
 * - "'Not started' is a state, not a zero" — an entity with nothing yet renders as a LABELLED
 *   empty, never as absence, or the untouched half of the project reads as done.
 * - "Design the empty states. Distinguish 'nothing in scope', which is the route's story, from
 *   'filtered to nothing', which is the surface's own. They have different exits." The REQUIRED
 *   `story` discriminant is that distinction; the REQUIRED `exit` is the different exit — the
 *   same constructor-argument enforcement that makes `Verb.reason` work.
 * - The exit renders ON the surface, not in a title: "tooltips deepen; they never rescue" (§0),
 *   and an empty state with a hidden way out is a rescue.
 */
import { tv } from "#/lib/tv";

import "./lang.css";

export const emptyStateRecipe = tv({
  slots: {
    base: "block t-label text-ink-mute italic",
    exit: "text-ink-2 not-italic before:text-ink-mute before:content-['_—_']",
  },
  variants: { state: { scope: {}, filter: {} } },
});

export function EmptyState({
  story,
  exit,
  children,
}: {
  /** Whose emptiness this is: `scope` — the route's story (nothing exists yet); `filter` — the
   * surface's own (rows exist; the narrowing hid them). They have different exits. */
  story: "scope" | "filter";
  /** REQUIRED: the way out — what would fill it ("run capture on this level") or how to widen
   * back out ("clear the room filter"). One sentence, no period needed. */
  exit: string;
  /** What is empty, in the surface's own words — "no zones on this level". */
  children: React.ReactNode;
}) {
  const { base, exit: exitSlot } = emptyStateRecipe({ state: story });
  return (
    <span className={base()} data-story={story}>
      {children}
      <span className={exitSlot()}>{exit}</span>
    </span>
  );
}
