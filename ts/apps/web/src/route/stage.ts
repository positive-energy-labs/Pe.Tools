/**
 * A stage, declared in one place: the stage verbs its Situation row draws, the chords they bind,
 * and the panes it shows. A pane declares what it draws and its own verbs — never a focus policy:
 * focus re-reads exactly when the document carries a change mark (`host/changed.ts`). Panes reach
 * the world only through these Readings and verbs (Shape B, stage-pane-verb-exploration.md §4).
 * ASSUME(kai): the Reading is the cache, shared by every pane that draws it (Chat's too) (Q4) |
 * alt: each pane holds its own snapshot
 */
import type { UseHotkeyDefinition } from "@tanstack/react-hotkeys";

export interface PaneDecl<R extends string, A extends string> {
  /** The Readings this pane draws. */
  readonly draws: readonly R[];
  /** The edits this pane owns (cell transitions, a filter); never a read. */
  readonly verbs: readonly string[];
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
