/**
 * A stage, declared in one place: the stage verbs its Situation row draws, the chords they bind,
 * and the panes it shows. A pane declares what it draws, its own verbs, and what its focus edge
 * does. Panes reach the world only through these Readings and verbs (Shape B,
 * stage-pane-verb-exploration.md §4).
 */
import type { UseHotkeyDefinition } from "@tanstack/react-hotkeys";

/**
 * What a pane's focus edge does to what it draws. `fresh` re-reads on every focus from outside;
 * `maxAgeS` only when the read is older (the performance exception); `as-is` never.
 */
export type OnFocus = "fresh" | { readonly maxAgeS: number } | "as-is";

export interface PaneDecl<R extends string, A extends string> {
  /** The Readings this pane draws. */
  readonly draws: readonly R[];
  /** The edits this pane owns (cell transitions, a filter); never a read. */
  readonly verbs: readonly string[];
  readonly onFocus: OnFocus;
  /**
   * How focus re-reads: absent = re-acquire `draws`; a verb when the read files a new observation
   * (a schedule read files a capture, so it is a verb the pane runs, never a button).
   */
  readonly reads?: A;
  /** Pane-tier keys: chord → the pane's read or verb. */
  readonly keys?: Readonly<Record<string, string>>;
}

export interface StageDecl<R extends string, A extends string, N extends string = string> {
  /** The stage verbs: effects that belong to the stage (push, plan, commit), drawn on the row. */
  readonly verbs: readonly A[];
  /** Stage-tier chords, by verb. */
  readonly keys: Partial<Readonly<Record<A, UseHotkeyDefinition["hotkey"]>>>;
  /** The panes this stage shows; a pane it omits is hidden. */
  readonly panes: Partial<Readonly<Record<N, PaneDecl<R, A>>>>;
}

/** Whether a pane's focus edge should re-read, given when its drawn read was taken. */
export const dueOnFocus = (policy: OnFocus, takenAt: string | null | undefined, now = Date.now()) =>
  policy === "fresh"
    ? true
    : policy === "as-is"
      ? false
      : !takenAt || now - Date.parse(takenAt) > policy.maxAgeS * 1000;
