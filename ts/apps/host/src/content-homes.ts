// ponytail: a handoff to writer G2, not a module. Copy-on-write is deleted (ADR 0037 rule 5):
// nothing is copied to the user home any more, and a write lands in the home the thing came from.
// These two names stay alive, inert, only because `pages-route.ts` (G2's file) still imports them
// to place Page state; until G2 moves that state under `state\Pages\<slug>` it sits beside its
// Page in whichever home holds it. Delete this file in the merge that lands G2's `pages-route.ts`.

/** Always null: no path has a user twin. */
export const userTwin = (_path: string): string | null => null;

/** The path unchanged: a write goes where the thing is. */
export const userWritable = (path: string): string => path;
