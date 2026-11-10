/**
 * The consent sweep (ADR 0035 rule 6): consent is drawn in two places only, the write button that
 * asked and this sweep. One component, a countdown that sweeps down, mounted in the topbar on web
 * and as the card in the tray shell. Each open window is one row: the thread, the verb that will
 * write, the seconds left, and Reject (the host's `stop_writes` answer, the same `thread.permission`
 * door the write button answers). Auto-approve off is a row with no deadline and no sweep.
 *
 * Scaffold (slice 6, seam b): props are the contract; the drawing and its swatch specimen land
 * with the first real consumer (house law 10).
 */
import type { ReactNode } from "react";

export interface ConsentWindow {
  readonly requestId: string;
  readonly threadId: string;
  /** The thread's title, never its id (I1). */
  readonly thread: string;
  /** What will write when the window closes: a verb label, or "Pea writes" for run consent. */
  readonly verb: string;
  /** ISO instant the host auto-approves at; absent while auto-approve is off. */
  readonly deadline?: string;
  /** Null when the window offers no reject option, so the row says why. */
  readonly reject: { readonly optionId: string } | null;
}

export interface ConsentSweepProps {
  readonly windows: readonly ConsentWindow[];
  /** Answers the host once per press; the row leaves when the feed drops the window. */
  readonly onReject: (window: ConsentWindow) => void;
  /** `topbar` is one line; `card` is the tray's stacked card with the thread's words. */
  readonly shell: "topbar" | "card";
}

// ponytail: no drawing until the fill; a stub that refuses is honest, a stub that draws nothing is a blank (house law 9).
export function ConsentSweep(_props: ConsentSweepProps): ReactNode {
  throw new Error("kernel gap: ConsentSweep is not drawn yet (ADR 0035 rule 6, slice 6 seam b)");
}
