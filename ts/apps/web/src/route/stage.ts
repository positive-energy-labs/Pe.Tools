/**
 * A stage, declared in one place: the stage verbs its Situation row draws, the chords they bind,
 * and the panes it shows. A pane declares what it draws and its own verbs — never a focus policy:
 * focus re-reads exactly when the Reading envelope carries the host's change mark. Panes reach
 * the world only through these Readings and verbs (Shape B, stage-pane-verb-exploration.md §4).
 * The Reading is the cache, shared by every pane that draws it, Chat's too; the host stamps its
 * taken-at and its change mark once for all of them (ruled 2026-09-22).
 */
import type { Chord } from "#/route/keys";

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
}

export interface StageDecl<R extends string, A extends string, N extends string = string> {
  /** The stage verbs: effects that belong to the stage (push, plan, commit), drawn on the row. */
  readonly verbs: readonly A[];
  /** The stage node's chords, by verb; the chord grammar only, so a row can draw the word. */
  readonly keys: Partial<Readonly<Record<A, Extract<Chord, string>>>>;
  /** The panes this stage shows; a pane it omits is hidden. */
  readonly panes: Partial<Readonly<Record<N, PaneDecl<R, A>>>>;
  /** False: the row draws no Work meter beside the verbs (the Ledger keeps the revision). */
  readonly meter?: false;
}
