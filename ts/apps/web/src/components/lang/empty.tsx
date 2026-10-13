/**
 * The labelled empty. `story` (nothing in scope vs filtered to nothing) and `exit` are required,
 * and the exit renders on the surface, not in a title.
 */
import { tv } from "#/lib/tv";

import "./lang.css";

export const emptyStateRecipe = tv({
  slots: {
    // Sentence case in the reading ink: an empty is said, not stamped. The exit is the louder half.
    base: "block whitespace-normal wrap-anywhere t-small text-ink-2 first-letter:uppercase",
    exit: "text-ink before:text-ink-mute before:content-['_—_']",
  },
  variants: { state: { scope: {}, filter: {} } },
});

export const emptyMark = tv({ base: "m-0 t-display face-display" });

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
